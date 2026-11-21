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
let allInventoryData = [];
let localBuildingsData = []; // 👈 Хранение динамических построек из БД
let tickerInterval = null;
let pendingTimerOps = 0;
let localMutationEpoch = 0;
let timerWriteQueue = Promise.resolve();
let syncInFlightPromise = null;
const acceleratingTimerIds = new Set();

function getStorageKeys() {
    const uid = currentUser ? currentUser.id : 'guest';
    return {
        timers: `terminal_timers_${uid}`,
        inventory: `terminal_inventory_${uid}`,
        buildings: `terminal_buildings_${uid}`
    };
}

function calculateBoosterPills(seconds) {
    const sec = Math.max(0, Number(seconds) || 0);
    if (sec <= 0) return 1;
    return Math.max(1, Math.ceil(sec / 900));
}

function getAvailableAcceleratorsCount() {
    const source = (Array.isArray(allInventoryData) && allInventoryData.length > 0)
        ? allInventoryData
        : localInventoryData;
    return (source || []).reduce((sum, item) => {
        if (String(item && item.name || '').trim().toLowerCase() === 'ускорители') {
            return sum + Math.max(0, Number(item.count) || 0);
        }
        return sum;
    }, 0);
}

function addOrIncrementLocalInventory(invList, itemName, delta = 1) {
    if (!Array.isArray(invList)) return;
    const cleanTarget = String(itemName || '').trim();
    const targetLower = cleanTarget.toLowerCase();
    const existing = invList.find(i => String(i.name || '').trim().toLowerCase() === targetLower);
    if (existing) {
        existing.count = Math.max(0, (Number(existing.count) || 0) + delta);
    } else if (delta > 0) {
        invList.push({
            name: cleanTarget,
            count: delta,
            created_by: currentUser ? currentUser.id : 'guest'
        });
    }
}

function deductLocalAccelerators(invList, amount) {
    if (!Array.isArray(invList) || amount <= 0) return;
    let remaining = amount;
    for (const item of invList) {
        if (remaining <= 0) break;
        if (String(item.name || '').trim().toLowerCase() === 'ускорители') {
            const avail = Math.max(0, Number(item.count) || 0);
            const take = Math.min(avail, remaining);
            item.count = avail - take;
            remaining -= take;
        }
    }
}

function saveToLocalStorage() {
    if (!currentUser) {
        currentUser = { id: 'guest', name: 'Гость', role: 'user', isGuest: true };
    }
    const keys = getStorageKeys();
    if (targetQueueId === null) {
        localStorage.setItem(keys.timers, JSON.stringify(localTimersData));
        localStorage.setItem(keys.buildings, JSON.stringify(localBuildingsData));
        localStorage.setItem(keys.inventory, JSON.stringify(allInventoryData.length > 0 ? allInventoryData : localInventoryData));
    } else {
        if (allInventoryData.length > 0) {
            localStorage.setItem(keys.inventory, JSON.stringify(allInventoryData));
        }
    }
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
    if (savedInv) {
        allInventoryData = JSON.parse(savedInv);
        localInventoryData = JSON.parse(savedInv);
    }
    if (savedBuildings) localBuildingsData = JSON.parse(savedBuildings);

    if (currentUser.isGuest && !allInventoryData.some(i => String(i.name || '').trim().toLowerCase() === 'ускорители')) {
        const starter = { name: 'Ускорители', count: 10, created_by: currentUser.id };
        allInventoryData.push({ ...starter });
        localInventoryData.push({ ...starter });
        localStorage.setItem(keys.inventory, JSON.stringify(allInventoryData));
    }
    
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

            addOrIncrementLocalInventory(localInventoryData, invItemName, 1);
            if (allInventoryData !== localInventoryData) {
                addOrIncrementLocalInventory(allInventoryData, invItemName, 1);
            }

            if (window.TaskCooldowns && typeof window.TaskCooldowns.recordCompletion === 'function') {
                window.TaskCooldowns.recordCompletion(finishedItem.name, finishedItem.ends_at || now, currentUser ? currentUser.id : 'guest');
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

let errorBannerHideTimer = null;
let floatingToastHideTimer = null;

function showDashboardToast(text, mode = 'error') {
    if (typeof document === 'undefined' || !document.body) return;
    let toast = document.getElementById('dashboard-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dashboard-toast';
        toast.className = 'dashboard-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.toggle('is-ready', mode === 'ready');
    toast.classList.add('is-visible');
    if (floatingToastHideTimer) clearTimeout(floatingToastHideTimer);
    floatingToastHideTimer = setTimeout(() => {
        toast.classList.remove('is-visible');
    }, 4000);
}

function showError(text, mode = 'error') {
    const banner = document.getElementById('error-banner');
    if (banner) {
        banner.style.display = 'block';
        banner.textContent = text;
        if (mode === 'ready') {
            banner.style.background = '#064e3b';
            banner.style.borderColor = '#10b981';
            banner.style.color = '#a7f3d0';
        } else {
            banner.style.background = '#7f1d1d';
            banner.style.borderColor = '#ef4444';
            banner.style.color = '#fca5a5';
        }
        if (errorBannerHideTimer) clearTimeout(errorBannerHideTimer);
        errorBannerHideTimer = setTimeout(() => { banner.style.display = 'none'; }, 4500);
    }
    showDashboardToast(text, mode);
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

            // Загружаем таймеры, склад, постройки и кулдауны из БД
            const [timersRes, invRes, buildingsRes] = await Promise.all([
                window.supabaseClient.from('active_timers').select('*').eq('created_by', currentUser.id).order('ends_at', { ascending: true }),
                window.supabaseClient.from('completed_items').select('*').eq('created_by', currentUser.id),
                window.supabaseClient.from('terminal_buildings').select('*').eq('created_by', currentUser.id).order('queue_group_id', { ascending: true }),
                (window.TaskCooldowns && typeof window.TaskCooldowns.syncFromSupabase === 'function')
                    ? window.TaskCooldowns.syncFromSupabase(currentUser.id).catch(() => null)
                    : Promise.resolve(null)
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

                    if (window.TaskCooldowns && typeof window.TaskCooldowns.recordCompletion === 'function') {
                        window.TaskCooldowns.recordCompletion(timer.name, timer.ends_at || now, currentUser.id);
                    }
                    
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
            allInventoryData = serverInv;
            
            // 💡 Фильтруем инвентарь по продукции разрешенных задач для этой постройки (+ Ускорители)
            if (targetQueueId !== null) {
                const allowedTaskNames = localBuildingsData.flatMap(b => (b.tasks || []).map(t => t.name.toLowerCase()));
                localInventoryData = serverInv.filter(item => {
                    const lower = String(item.name || '').trim().toLowerCase();
                    return allowedTaskNames.includes(lower) || lower === 'ускорители';
                });
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
    if (window.TaskCooldowns && typeof window.TaskCooldowns.checkTransitions === 'function') {
        window.TaskCooldowns.checkTransitions(currentUser ? currentUser.id : 'guest', (rule) => {
            showCooldownReadyNotification(rule);
            showError(rule.readyText, 'ready');
        });
    }
    renderUI();
}

async function quickAddTimer(name, queueId, overrideDuration = null) {
    if (!currentUser) {
        currentUser = { id: 'guest', name: 'Гость', role: 'user', isGuest: true };
    }

    if (window.TaskCooldowns && typeof window.TaskCooldowns.getRule === 'function') {
        const cdRule = window.TaskCooldowns.getRule(name);
        if (cdRule) {
            const activeDup = (localTimersData || []).find(t => {
                const r = window.TaskCooldowns.getRule(t.name);
                return r && r.key === cdRule.key;
            });
            if (activeDup) {
                showError(`⏳ Задача «${cdRule.label}» уже ${activeDup.status === 'running' ? 'выполняется' : 'стоит в очереди'}! Повторный запуск запрещён до завершения и окончания кулдауна.`);
                return false;
            }
            const cdState = window.TaskCooldowns.getState(name, currentUser.id);
            if (cdState && cdState.active) {
                showError(`⛔ Нельзя запустить «${cdRule.label}» раньше времени! Идёт кулдаун — осталось ${cdState.formatted}.`);
                return false;
            }
        }
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

async function accelerateRunningTimer(timerId) {
    const keyId = String(timerId || '');
    if (!keyId || acceleratingTimerIds.has(keyId)) return;

    const timer = (localTimersData || []).find(t => String(t.id) === keyId);
    if (!timer || timer.status !== 'running') {
        return;
    }

    const now = Date.now();
    const endTime = timer.ends_at ? new Date(timer.ends_at).getTime() : now;
    const remSeconds = Math.max(1, Math.floor((endTime - now) / 1000) || Number(timer.total_seconds) || 60);
    const pillsNeeded = calculateBoosterPills(remSeconds);
    const availablePills = getAvailableAcceleratorsCount();

    if (availablePills < pillsNeeded) {
        showError(`💊 Недостаточно ускорителей! Нужно: ${pillsNeeded} шт., на складе «Ускорители»: ${availablePills} шт.`);
        return;
    }

    acceleratingTimerIds.add(keyId);
    localMutationEpoch++;

    try {
        // 1. Списываем ускорители из инвентаря
        deductLocalAccelerators(allInventoryData, pillsNeeded);
        if (allInventoryData !== localInventoryData) {
            deductLocalAccelerators(localInventoryData, pillsNeeded);
        }

        // 2. Удаляем ускоренный таймер из очереди и выдаём готовый предмет
        const queueGroupId = timer.queue_group_id;
        localTimersData = localTimersData.filter(t => String(t.id) !== keyId);

        let invItemName = timer.name;
        if (invItemName === 'Вытереть') invItemName = 'Вытерто';
        addOrIncrementLocalInventory(allInventoryData, invItemName, 1);
        if (allInventoryData !== localInventoryData) {
            addOrIncrementLocalInventory(localInventoryData, invItemName, 1);
        }

        // 3. Продвигаем следующий таймер в этой очереди и сдвигаем ends_at на текущее время
        const sameQueue = localTimersData
            .filter(t => Number(t.queue_group_id) === Number(queueGroupId))
            .sort((a, b) => new Date(a.ends_at || 0).getTime() - new Date(b.ends_at || 0).getTime());

        let cursorMs = now;
        const shiftedTimers = [];
        sameQueue.forEach((qt, idx) => {
            const durSec = Math.max(1, Number(qt.total_seconds || qt.remaining_seconds) || 60);
            cursorMs += durSec * 1000;
            qt.status = idx === 0 ? 'running' : 'queued';
            qt.ends_at = new Date(cursorMs).toISOString();
            shiftedTimers.push({ id: qt.id, name: qt.name, status: qt.status, ends_at: qt.ends_at });
        });

        saveToLocalStorage();
        if (window.TaskCooldowns && typeof window.TaskCooldowns.recordCompletion === 'function') {
            window.TaskCooldowns.recordCompletion(timer.name, now, currentUser ? currentUser.id : 'guest');
        }
        showTimerNotification(timer.name);
        if (typeof renderUI === 'function') renderUI();

        try {
            if (typeof window.recordCommandAction === 'function') {
                window.recordCommandAction(
                    `Accelerate ${timer.name}`,
                    `Ускорен таймер "${timer.name}" за ${pillsNeeded} шт. «Ускорители» (получено: ${invItemName})`
                );
            }
        } catch (e) {}

        if (currentUser && !currentUser.isGuest && currentUser.id !== 'guest' && window.supabaseClient) {
            const userIdSnapshot = currentUser.id;
            const timerSnapshot = { ...timer };
            pendingTimerOps++;
            timerWriteQueue = timerWriteQueue
                .catch(() => {})
                .then(async () => {
                    try {
                        // A. Списание ускорителей в completed_items
                        const { data: boosterRows } = await window.supabaseClient
                            .from('completed_items')
                            .select('*')
                            .eq('created_by', userIdSnapshot)
                            .ilike('name', 'Ускорители');

                        let leftToDeduct = pillsNeeded;
                        if (Array.isArray(boosterRows)) {
                            for (const row of boosterRows) {
                                if (leftToDeduct <= 0) break;
                                const curCount = Math.max(0, Number(row.count) || 0);
                                if (curCount <= 0) continue;
                                const take = Math.min(curCount, leftToDeduct);
                                await window.supabaseClient
                                    .from('completed_items')
                                    .update({ count: curCount - take, updated_at: new Date().toISOString() })
                                    .eq('id', row.id);
                                leftToDeduct -= take;
                            }
                        }

                        // B. Удаление завершённого таймера из active_timers
                        if (String(timerSnapshot.id).startsWith('temp_')) {
                            const { data: tempMatches } = await window.supabaseClient
                                .from('active_timers')
                                .select('id')
                                .eq('created_by', userIdSnapshot)
                                .eq('queue_group_id', timerSnapshot.queue_group_id)
                                .eq('name', timerSnapshot.name)
                                .order('id', { ascending: true })
                                .limit(1);
                            if (tempMatches && tempMatches[0]) {
                                await window.supabaseClient.from('active_timers').delete().eq('id', tempMatches[0].id);
                            }
                        } else {
                            await window.supabaseClient.from('active_timers').delete().eq('id', timerSnapshot.id);
                        }

                        // C. Начисление готового предмета в completed_items
                        const { data: existingProdRows } = await window.supabaseClient
                            .from('completed_items')
                            .select('*')
                            .eq('created_by', userIdSnapshot)
                            .eq('name', invItemName)
                            .limit(1);

                        if (existingProdRows && existingProdRows[0]) {
                            await window.supabaseClient
                                .from('completed_items')
                                .update({ count: (Number(existingProdRows[0].count) || 0) + 1, updated_at: new Date().toISOString() })
                                .eq('id', existingProdRows[0].id);
                        } else {
                            await window.supabaseClient
                                .from('completed_items')
                                .insert([{ name: invItemName, count: 1, created_by: userIdSnapshot }]);
                        }

                        // D. Обновление статусов и ends_at оставшейся очереди
                        for (const st of shiftedTimers) {
                            if (!String(st.id).startsWith('temp_')) {
                                await window.supabaseClient
                                    .from('active_timers')
                                    .update({ status: st.status, ends_at: st.ends_at })
                                    .eq('id', st.id);
                            }
                        }
                    } catch (err) {
                        console.error('Ошибка ускорения таймера в БД:', err);
                        showError('⚠️ Ошибка синхронизации ускорения с сервером');
                    } finally {
                        pendingTimerOps = Math.max(0, pendingTimerOps - 1);
                        if (pendingTimerOps === 0) {
                            await forceSyncWithDB();
                        }
                    }
                });
        }
    } finally {
        acceleratingTimerIds.delete(keyId);
    }
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

function showCooldownReadyNotification(rule) {
    if (!rule || !('Notification' in window) || Notification.permission !== 'granted') return;
    const title = rule.key === 'памперс' ? '👶 Пора менять памперс!' : '🔥 Кипяток снова готов!';
    const body = rule.readyText;

    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
                body,
                icon: '/icon-512.png',
                badge: '/badge.png',
                vibrate: [250, 100, 250],
                tag: `cooldown-ready-${rule.key}`,
                renotify: true
            });
        }).catch(() => {});
    } else {
        try {
            new Notification(title, { body, icon: '/icon-512.png' });
        } catch (e) {}
    }
}
