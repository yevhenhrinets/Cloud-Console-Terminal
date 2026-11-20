// dashboard-logic.js — логика, хранилище, синхронизация и таймеры
let currentUser = {
    id: 'guest',
    name: 'Гость (Демо-режим)',
    email: 'guest@cloud',
    role: 'user',
    isGuest: true
};
let localTimersData = [];
let localInventoryData = [];
let localBuildingsData = []; // 👈 Хранение динамических построек из БД
let tickerInterval = null;
let pendingTimerOps = 0;
let localMutationEpoch = 0;
let timerWriteQueue = Promise.resolve();
let syncInFlightPromise = null;

function getStorageKeys() {
    const uid = currentUser ? currentUser.id : 'guest';
    return {
        timers: `terminal_timers_${uid}`,
        inventory: `terminal_inventory_${uid}`,
        buildings: `terminal_buildings_${uid}`
    };
}

function saveToLocalStorage() {
    if (!currentUser) {
        currentUser = { id: 'guest', name: 'Гость', role: 'user', isGuest: true };
    }
    const keys = getStorageKeys();
    localStorage.setItem(keys.timers, JSON.stringify(localTimersData));
    localStorage.setItem(keys.inventory, JSON.stringify(localInventoryData));
    localStorage.setItem(keys.buildings, JSON.stringify(localBuildingsData));
}

function loadFromLocalStorage() {
    if (!currentUser) {
        currentUser = { id: 'guest', name: 'Гость', role: 'user', isGuest: true };
    }
    const keys = getStorageKeys();
    const savedTimers = localStorage.getItem(keys.timers);
    const savedInv = localStorage.getItem(keys.inventory);
    const savedBuildings = localStorage.getItem(keys.buildings);
    
    if (savedTimers) localTimersData = JSON.parse(savedTimers);
    if (savedInv) localInventoryData = JSON.parse(savedInv);
    if (savedBuildings) localBuildingsData = JSON.parse(savedBuildings);
    
    checkExpiredLocalTimers();
    
    return savedTimers !== null;
}

function checkExpiredLocalTimers() {
    const now = Date.now();
    let changed = false;

    const queueGroups = {};
    localTimersData.forEach(t => {
        if (!queueGroups[t.queue_group_id]) queueGroups[t.queue_group_id] = [];
        queueGroups[t.queue_group_id].push(t);
    });

    for (const [qId, items] of Object.entries(queueGroups)) {
        items.sort((a, b) => {
            const ta = a && a.ends_at ? new Date(a.ends_at).getTime() : 0;
            const tb = b && b.ends_at ? new Date(b.ends_at).getTime() : 0;
            return ta - tb;
        });

        while (items.length > 0 && items[0].ends_at && now >= new Date(items[0].ends_at).getTime()) {
            const finishedItem = items.shift();
            
            showTimerNotification(finishedItem.name);
            
            let invItemName = finishedItem.name;
            if (invItemName === 'Вытереть') invItemName = 'Вытерто';

            const invItem = localInventoryData.find(i => i.name === invItemName);
            if (invItem) {
                invItem.count += 1;
            } else {
                localInventoryData.push({ name: invItemName, count: 1, created_by: currentUser.id });
            }

            if (items.length > 0) {
                items[0].status = 'running';
            }
            changed = true;
        }
    }

    if (changed) {
        localTimersData = [].concat(...Object.values(queueGroups));
        saveToLocalStorage();
    }
}

function showError(text) {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    banner.style.display = 'block';
    banner.textContent = text;
    setTimeout(() => banner.style.display = 'none', 4000);
}

// Получаем параметр queue из URL один раз при загрузке
const urlParams = new URLSearchParams(window.location.search);
const queueParam = urlParams.get('queue');
const targetQueueId = queueParam ? parseInt(queueParam, 10) : null;

async function forceSyncWithDB() {
    if (!currentUser || currentUser.id === 'guest') return;
    // Не перезаписываем локальную очередь, пока есть незавершённые добавления в БД
    if (pendingTimerOps > 0) return;

    if (syncInFlightPromise) {
        return syncInFlightPromise;
    }

    syncInFlightPromise = (async () => {
        const startEpoch = localMutationEpoch;
        try {
            const now = Date.now();

            // Загружаем таймеры, склад И постройки из БД
            const [timersRes, invRes, buildingsRes] = await Promise.all([
                window.supabaseClient.from('active_timers').select('*').eq('created_by', currentUser.id).order('ends_at', { ascending: true }),
                window.supabaseClient.from('completed_items').select('*').eq('created_by', currentUser.id),
                window.supabaseClient.from('terminal_buildings').select('*').eq('created_by', currentUser.id).order('queue_group_id', { ascending: true })
            ]);

            if (timersRes.error || invRes.error) throw new Error('Ошибка загрузки с сервера');

            // Если во время запроса пользователь успел добавить новый таймер — не затираем локальное состояние устаревшим ответом
            if (pendingTimerOps > 0 || localMutationEpoch !== startEpoch) {
                return;
            }

            let serverTimers = timersRes.data || [];
            let serverInv = invRes.data || [];
            let allBuildings = buildingsRes.data || [];

            // 💡 Фильтруем постройки, если передан параметр queue в URL
            if (targetQueueId !== null) {
                localBuildingsData = allBuildings.filter(b => Number(b.queue_group_id) === targetQueueId);
            } else {
                localBuildingsData = allBuildings;
            }

            for (const timer of serverTimers) {
                if (timer.ends_at && now >= new Date(timer.ends_at).getTime()) {
                    await window.supabaseClient.from('active_timers').delete().eq('id', timer.id);
                    
                    let invItemName = timer.name;
                    if (invItemName === 'Вытереть') invItemName = 'Вытерто';

                    const existing = serverInv.find(i => i.name === invItemName);
                    if (existing) {
                        existing.count += 1;
                        await window.supabaseClient.from('completed_items').update({ count: existing.count, updated_at: new Date().toISOString() }).eq('id', existing.id);
                    } else {
                        const { data: insData } = await window.supabaseClient.from('completed_items').insert([{ name: invItemName, count: 1, created_by: currentUser.id }]).select();
                        if (insData && insData[0]) serverInv.push(insData[0]);
                    }
                }
            }

            const cleanTimersRes = await window.supabaseClient.from('active_timers').select('*').eq('created_by', currentUser.id).order('ends_at', { ascending: true });
            let activeTimers = cleanTimersRes.data || [];

            // Повторная проверка перед записью результата в localTimersData
            if (pendingTimerOps > 0 || localMutationEpoch !== startEpoch) {
                return;
            }

            // 💡 Фильтруем таймеры по очереди, если включен изолированный режим
            if (targetQueueId !== null) {
                activeTimers = activeTimers.filter(t => Number(t.queue_group_id) === targetQueueId);
            }

            const groups = {};
            activeTimers.forEach(t => {
                if (!groups[t.queue_group_id]) groups[t.queue_group_id] = [];
                groups[t.queue_group_id].push(t);
            });

            for (const [qId, items] of Object.entries(groups)) {
                for (let i = 0; i < items.length; i++) {
                    const expectedStatus = i === 0 ? 'running' : 'queued';
                    if (items[i].status !== expectedStatus) {
                        await window.supabaseClient.from('active_timers').update({ status: expectedStatus }).eq('id', items[i].id);
                        items[i].status = expectedStatus;
                    }
                }
            }

            if (pendingTimerOps > 0 || localMutationEpoch !== startEpoch) {
                return;
            }

            localTimersData = activeTimers;
            
            // 💡 Фильтруем инвентарь по продукции разрешенных задач для этой постройки
            if (targetQueueId !== null) {
                const allowedTaskNames = localBuildingsData.flatMap(b => (b.tasks || []).map(t => t.name.toLowerCase()));
                localInventoryData = serverInv.filter(item => allowedTaskNames.includes(item.name.toLowerCase()));
            } else {
                localInventoryData = serverInv;
            }

            saveToLocalStorage();
            renderUI();

        } catch (err) {
            console.error('Ошибка синхронизации:', err);
        } finally {
            syncInFlightPromise = null;
        }
    })();

    return syncInFlightPromise;
}

function localTick() {
    checkExpiredLocalTimers();
    renderUI();
}

async function quickAddTimer(name, queueId, overrideDuration = null) {
    if (!currentUser) {
        currentUser = { id: 'guest', name: 'Гость', role: 'user', isGuest: true };
    }

    let duration = overrideDuration || 60;

    // Если время не передано напрямую, ищем в сохраненных постройках
    if (!overrideDuration) {
        for (const b of localBuildingsData) {
            if (b.tasks) {
                const foundTask = b.tasks.find(t => t.name.toLowerCase() === name.toLowerCase());
                if (foundTask && foundTask.duration) {
                    duration = foundTask.duration;
                    break;
                }
            }
        }
    }

    const buildingItems = localTimersData.filter(t => Number(t.queue_group_id) === Number(queueId));
    if (buildingItems.length >= 4) {
        showError('❌ В здании уже заняты все 4 слота!');
        return;
    }

    const hasRunning = buildingItems.length > 0;
    const status = hasRunning ? 'queued' : 'running';

    const maxExistingEnd = buildingItems.reduce((max, item) => {
        const ts = item && item.ends_at ? new Date(item.ends_at).getTime() : 0;
        return ts > max ? ts : max;
    }, 0);
    const baseTime = Math.max(Date.now(), maxExistingEnd);
    const durationMs = Math.max(1000, Number(duration) * 1000 || 60000);
    const endsAt = new Date(baseTime + durationMs).toISOString();

    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newItem = {
        id: tempId,
        name: name,
        queue_group_id: queueId,
        total_seconds: duration,
        remaining_seconds: duration,
        ends_at: endsAt,
        status: status,
        created_by: currentUser.id
    };

    localMutationEpoch++;
    localTimersData.push(newItem);
    saveToLocalStorage();
    renderUI();

    // Запись действия в историю команд (например, Task add Печь Кипяток 2м)
    try {
        let bName = 'Постройка';
        const foundB = (localBuildingsData || []).find(b => Number(b.queue_group_id) === Number(queueId));
        if (foundB && foundB.building_name) {
            bName = foundB.building_name;
        } else if (Number(queueId) === 1) bName = 'Печь';
        else if (Number(queueId) === 3) bName = 'Стиральная машина';
        else if (Number(queueId) === 4) bName = 'Кресло';
        else if (Number(queueId) === 6) bName = 'Телевизор';
        else if (Number(queueId) === 8) bName = 'Мультиварка';
        else if (Number(queueId) === 10) bName = 'Роутер';

        const durStr = duration >= 60 ? `${Math.round(duration / 60)}м` : `${duration}с`;
        const cmdStr = `Task add ${bName} ${name} ${durStr}`;
        const descStr = `Запущен таймер "${name}" в постройке "${bName}" (${durStr})`;

        if (typeof window.recordCommandAction === 'function') {
            window.recordCommandAction(cmdStr, descStr);
        } else {
            try {
                const hist = JSON.parse(localStorage.getItem('terminal_actions_history') || '[]');
                hist.unshift({
                    id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    raw_text: cmdStr,
                    command: 'Task',
                    parameters: { raw_args: `add ${bName} ${name} ${durStr}` },
                    output: descStr,
                    status: 'success',
                    created_at: new Date().toISOString(),
                    created_by: currentUser.id || 'guest'
                });
                if (hist.length > 200) hist.length = 200;
                localStorage.setItem('terminal_actions_history', JSON.stringify(hist));
            } catch (storageErr) {
                console.warn('localStorage hist error:', storageErr);
            }
        }
    } catch (e) {
        console.warn('Ошибка записи Task add в историю:', e);
    }

    if (currentUser.id === 'guest' || currentUser.isGuest) {
        return;
    }

    const userIdSnapshot = currentUser.id;
    pendingTimerOps++;
    timerWriteQueue = timerWriteQueue
        .catch(() => {})
        .then(async () => {
            try {
                const { error } = await window.supabaseClient.from('active_timers').insert([{
                    name: name,
                    queue_group_id: queueId,
                    total_seconds: duration,
                    remaining_seconds: duration,
                    ends_at: endsAt,
                    status: status,
                    created_by: userIdSnapshot
                }]);
                if (error) {
                    console.error('Ошибка записи в БД:', error);
                    showError('⚠️ Ошибка синхронизации с сервером');
                }
            } catch (err) {
                console.error('Ошибка записи в БД:', err);
                showError('⚠️ Ошибка синхронизации с сервером');
            } finally {
                pendingTimerOps = Math.max(0, pendingTimerOps - 1);
                if (pendingTimerOps === 0) {
                    await forceSyncWithDB();
                }
            }
        });
}

function showTimerNotification(timerName) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    let title = '⏱️ Таймер завершен!';
    let body = `Задача "${timerName}" выполнена.`;

    if (timerName === 'Кипяток') {
        title = '🔥 Кипяток готов!';
        body = 'Вода закипела, пора заваривать чай или кофе!';
    }

    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
                body: body,
                icon: '/icon-512.png',
                badge: '/badge.png',
                vibrate: [300, 100, 300, 100, 300],
                tag: 'terminal-timer',
                renotify: true
            });
        });
    } else {
        new Notification(title, { body, icon: '/icon-512.png' });
    }
}
