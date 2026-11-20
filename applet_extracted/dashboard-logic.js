// dashboard-logic.js — логика, хранилище, синхронизация и таймеры
let currentUser = null;
let localTimersData = [];
let localInventoryData = [];
let localBuildingsData = []; // 👈 Хранение динамических построек из БД
let tickerInterval = null;

function getStorageKeys() {
    const uid = currentUser ? currentUser.id : 'guest';
    return {
        timers: `terminal_timers_${uid}`,
        inventory: `terminal_inventory_${uid}`,
        buildings: `terminal_buildings_${uid}`
    };
}

function saveToLocalStorage() {
    if (!currentUser) return;
    const keys = getStorageKeys();
    localStorage.setItem(keys.timers, JSON.stringify(localTimersData));
    localStorage.setItem(keys.inventory, JSON.stringify(localInventoryData));
    localStorage.setItem(keys.buildings, JSON.stringify(localBuildingsData));
}

function loadFromLocalStorage() {
    if (!currentUser) return false;
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
    if (!currentUser) return;
    try {
        const now = Date.now();

        // Загружаем таймеры, склад И постройки из БД
        const [timersRes, invRes, buildingsRes] = await Promise.all([
            window.supabaseClient.from('active_timers').select('*').eq('created_by', currentUser.id).order('ends_at', { ascending: true }),
            window.supabaseClient.from('completed_items').select('*').eq('created_by', currentUser.id),
            window.supabaseClient.from('terminal_buildings').select('*').eq('created_by', currentUser.id).order('queue_group_id', { ascending: true })
        ]);

        if (timersRes.error || invRes.error) throw new Error('Ошибка загрузки с сервера');

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
    }
}

function localTick() {
    checkExpiredLocalTimers();
    renderUI();
}

async function quickAddTimer(name, queueId, overrideDuration = null) {
    if (!currentUser) return;

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

    const buildingItems = localTimersData.filter(t => t.queue_group_id === queueId);
    if (buildingItems.length >= 4) {
        showError('❌ В здании уже заняты все 4 слота!');
        return;
    }

    const hasRunning = buildingItems.some(e => e.status === 'running');
    let status = hasRunning ? 'queued' : 'running';
    
    let endsAt;
    if (hasRunning) {
        const lastItem = buildingItems[buildingItems.length - 1];
        const baseTime = lastItem && lastItem.ends_at ? new Date(lastItem.ends_at).getTime() : Date.now();
        endsAt = new Date(baseTime + duration * 1000).toISOString();
    } else {
        endsAt = new Date(Date.now() + duration * 1000).toISOString();
    }

    const tempId = 'temp_' + Date.now();
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

    localTimersData.push(newItem);
    saveToLocalStorage();
    renderUI();

    window.supabaseClient.from('active_timers').insert([{
        name: name,
        queue_group_id: queueId,
        total_seconds: duration,
        remaining_seconds: duration,
        ends_at: endsAt,
        status: status,
        created_by: currentUser.id
    }]).then(({ error }) => {
        if (error) {
            console.error('Ошибка записи в БД:', error);
            showError('⚠️ Ошибка синхронизации с сервером');
        } else {
            forceSyncWithDB();
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
