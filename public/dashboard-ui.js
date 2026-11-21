// dashboard-ui.js — отрисовка, инициализация и события

async function initDashboard() {
    currentUser = await fetchCurrentUser();
    if (!currentUser) {
        currentUser = {
            id: 'guest',
            name: 'Гость (Демо-режим)',
            email: 'guest@cloud',
            role: 'user'
        };
        showError('ℹ️ Гостевой режим. Для синхронизации с Supabase используйте команду "login" в консоли.');
    }

    // 💡 Проверяем наличие параметра queue в URL для управления кнопкой в шапке
    const urlParams = new URLSearchParams(window.location.search);
    const queueParam = urlParams.get('queue');
    const headerBtn = document.getElementById('header-action-btn');

    if (!queueParam && headerBtn) {
        // Если параметров нет — оставляем кнопку "В консоль"
        headerBtn.href = 'index.html';
        headerBtn.className = 'btn-console';
        headerBtn.innerHTML = '💻 В консоль';
    } else if (headerBtn) {
        // Если параметр есть — превращаем кнопку в "Ко всем постройкам" или скрываем/меняем по вашему вкусу
        headerBtn.href = 'dashboard.html';
        headerBtn.className = 'btn-console';
        headerBtn.style.backgroundColor = '#64748b';
        headerBtn.innerHTML = '⬅️ Все постройки';
    }

    loadFromLocalStorage();

    if (!localBuildingsData || localBuildingsData.length === 0) {
        localBuildingsData = [
            { queue_group_id: 1, building_name: 'Печь', icon: '🍳', tasks: [{ name: 'Сосиски', duration: 60 }, { name: 'Кипяток', duration: 120 }, { name: 'Яйца', duration: 180 }] },
            { queue_group_id: 2, building_name: 'Уход', icon: '👶', tasks: [{ name: 'Памперс', duration: 60 }] },
            { queue_group_id: 3, building_name: 'Стиральная машина', icon: '🧺', tasks: [{ name: 'Стирка', duration: 180 }] },
            { queue_group_id: 4, building_name: 'Кресло', icon: '🪑', tasks: [{ name: 'Отдых', duration: 120 }] },
            { queue_group_id: 6, building_name: 'Телевизор', icon: '📺', tasks: [{ name: 'Сериал', duration: 300 }] },
            { queue_group_id: 8, building_name: 'Мультиварка', icon: '🍲', tasks: [{ name: 'Плов', duration: 240 }, { name: 'Каша', duration: 180 }] },
            { queue_group_id: 10, building_name: 'Роутер', icon: '📡', tasks: [{ name: 'Перезагрузка', duration: 30 }] }
        ];
    }
    
    // Применяем фильтр к локальным данным сразу, если они загрузились из localStorage
    if (targetQueueId !== null) {
        localBuildingsData = localBuildingsData.filter(b => Number(b.queue_group_id) === targetQueueId);
        localTimersData = localTimersData.filter(t => Number(t.queue_group_id) === targetQueueId);
        const allowedInitNames = localBuildingsData.flatMap(b => (b.tasks || []).map(t => t.name.toLowerCase()));
        localInventoryData = (allInventoryData.length > 0 ? allInventoryData : localInventoryData).filter(item => {
            const lower = String(item.name || '').trim().toLowerCase();
            return allowedInitNames.includes(lower) || lower === 'ускорители';
        });
    }

    renderUI();

    // Запись перехода в дашборд в историю
    try {
        if (typeof window.recordCommandAction === 'function') {
            const cmdText = targetQueueId !== null ? `select building ${targetQueueId}` : 'go to dashboard';
            const desc = targetQueueId !== null ? `Открыта постройка [Очередь #${targetQueueId}]` : 'Открыт дашборд построек';
            window.recordCommandAction(cmdText, desc);
        }
    } catch (e) {
        console.warn('Ошибка записи перехода в дашборд:', e);
    }

    await forceSyncWithDB();

    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(localTick, 1000);
    
    initNotifications();
}

function initNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Разрешение на уведомления получено');
            }
        });
    }
}

function renderUI() {
    renderBuildingControls(); // 👈 Динамические кнопки запуска
    renderQueues();           // 👈 Активные очереди
    renderInventory();        // 👈 Готовый склад
}

// РЕНДЕР ДИНАМИЧЕСКИХ ПОСТРОЕК И КНОПОК
function renderBuildingControls() {
    const container = document.getElementById('buildings-controls');
    if (!container) return;

    if (!localBuildingsData || localBuildingsData.length === 0) {
        if (container.dataset.ctrlSig !== 'empty') {
            container.dataset.ctrlSig = 'empty';
            container.innerHTML = '<div style="color: var(--text-muted, #94a3b8); font-size: 13px;">Построек нет. Создайте их из консоли командой `add building <Название> <Очередь>`</div>';
        }
        return;
    }

    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : 'guest';
    const hasCooldownHelper = Boolean(window.TaskCooldowns && typeof window.TaskCooldowns.getRule === 'function');
    const structParts = [];
    const timerUpdates = [];
    const stripParts = [];
    const seenStripKeys = new Set();

    localBuildingsData.forEach(b => {
        const taskSigs = [];
        if (b.tasks && b.tasks.length > 0) {
            b.tasks.forEach((t, idx) => {
                const rule = hasCooldownHelper ? window.TaskCooldowns.getRule(t.name) : null;
                let mode = 'ready';
                if (rule) {
                    const inQueue = (localTimersData || []).some(item => {
                        const r = window.TaskCooldowns.getRule(item.name);
                        return r && r.key === rule.key;
                    });
                    if (inQueue) {
                        mode = 'queued';
                    } else {
                        const cd = window.TaskCooldowns.getState(t.name, uid);
                        if (cd && cd.active) {
                            mode = 'cooldown';
                            const domKey = `${rule.key}_${b.queue_group_id}_${idx}`;
                            timerUpdates.push({ domId: `cooldown-timer-${domKey}`, text: `⏳ ${cd.formatted}` });
                            if (!seenStripKeys.has(rule.key)) {
                                seenStripKeys.add(rule.key);
                                stripParts.push({
                                    key: rule.key,
                                    label: `${getItemEmoji(rule.label)} ${rule.label}`,
                                    formatted: cd.formatted
                                });
                            }
                        }
                    }
                }
                taskSigs.push(`${t.name}:${t.duration}:${mode}`);
            });
        }
        structParts.push(`${b.queue_group_id}:${b.building_name}:${taskSigs.join(',')}`);
    });

    const activeStripAll = hasCooldownHelper && typeof window.TaskCooldowns.getAllActive === 'function'
        ? window.TaskCooldowns.getAllActive(uid)
        : [];
    activeStripAll.forEach(item => {
        if (!seenStripKeys.has(item.key)) {
            seenStripKeys.add(item.key);
            stripParts.push({
                key: item.key,
                label: `${getItemEmoji(item.label)} ${item.label}`,
                formatted: item.formatted
            });
        }
    });

    const nextCtrlSig = `${structParts.join('|')}||strip:${stripParts.map(s => s.key).join(',')}`;

    if (container.dataset.ctrlSig === nextCtrlSig) {
        timerUpdates.forEach(u => {
            const el = document.getElementById(u.domId);
            if (el) el.textContent = u.text;
        });
        stripParts.forEach(s => {
            const stripEl = document.getElementById(`cooldown-strip-${s.key}`);
            if (stripEl) stripEl.textContent = s.formatted;
        });
        return;
    }

    let html = '';
    if (stripParts.length > 0) {
        const stripBadges = stripParts.map(s =>
            `<span class="cooldown-strip-item">${s.label}: <strong id="cooldown-strip-${s.key}">${s.formatted}</strong></span>`
        ).join('');
        html += `<div class="cooldown-strip">⏳ Кулдаун: ${stripBadges}</div>`;
    }

    localBuildingsData.forEach(b => {
        const icon = b.icon || '🏭';
        html += `<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span class="building-label">
                ${icon} ${b.building_name}:
            </span>`;

        if (b.tasks && b.tasks.length > 0) {
            b.tasks.forEach((t, idx) => {
                const taskIcon = t.icon || getItemEmoji(t.name);
                const safeName = String(t.name || '').replace(/'/g, "\\'");
                const rule = hasCooldownHelper ? window.TaskCooldowns.getRule(t.name) : null;
                let btnClass = 'btn-action';
                let btnExtra = '';
                let btnTitle = '';

                if (rule) {
                    const inQueue = (localTimersData || []).some(item => {
                        const r = window.TaskCooldowns.getRule(item.name);
                        return r && r.key === rule.key;
                    });
                    if (inQueue) {
                        btnClass = 'btn-action btn-in-queue';
                        btnExtra = ` <span class="cooldown-chip">🔄 В очереди</span>`;
                        btnTitle = `Задача «${t.name}» уже в очереди или выполняется`;
                    } else {
                        const cd = window.TaskCooldowns.getState(t.name, uid);
                        if (cd && cd.active) {
                            const domKey = `${rule.key}_${b.queue_group_id}_${idx}`;
                            btnClass = 'btn-action btn-cooldown';
                            btnExtra = ` <span id="cooldown-timer-${domKey}" class="cooldown-chip">⏳ ${cd.formatted}</span>`;
                            btnTitle = `Перезарядка ${rule.label}: осталось ${cd.formatted}`;
                        }
                    }
                }

                html += `<button type="button" class="${btnClass}" style="font-size: 11px; padding: 6px 8px;" title="${btnTitle}" onclick="quickAddTimer('${safeName}', ${b.queue_group_id}, ${t.duration})">
                    ${taskIcon} ${t.name}${btnExtra}
                </button>`;
            });
        } else {
            html += `<span style="font-size: 11px; color: #64748b;">(нет задач)</span>`;
        }

        html += `</div>`;
    });

    container.dataset.ctrlSig = nextCtrlSig;
    container.innerHTML = html;
}

// Вспомогательный выбор эмодзи по названию (для обратной совместимости)
function getItemEmoji(name) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('памперс')) return '👶';
    if (lowerName.includes('сосиск')) return '🌭';
    if (lowerName.includes('кипяток')) return '🔥';
    if (lowerName.includes('яйц')) return '🥚';
    if (lowerName.includes('макарон')) return '🍝';
    if (lowerName.includes('каша')) return '🥣';
    if (lowerName.includes('пельмен')) return '🥟';
    if (lowerName.includes('стирк')) return '🫧';
    if (lowerName.includes('дезик')) return '🧴';
    if (lowerName.includes('побрить')) return '🪒';
    if (lowerName.includes('руки')) return '🧼';
    if (lowerName.includes('код')) return '💻';
    if (lowerName.includes('дуолинго')) return '🦉';
    if (lowerName.includes('плов')) return '🍚';
    if (lowerName.includes('ускорит')) return '💊';
    return '📦';
}

function formatRemainingCountdown(rem) {
    if (rem >= 3600) {
        const hours = Math.floor(rem / 3600);
        const mins = Math.floor((rem % 3600) / 60);
        return `${hours}ч ${mins}м`;
    }
    const mins = Math.floor(rem / 60);
    const secs = rem % 60;
    return `${mins}м ${secs < 10 ? '0' : ''}${secs}с`;
}

function renderQueues() {
    const container = document.getElementById('queues-container');
    if (!container) return;

    if (!localTimersData || localTimersData.length === 0) {
        if (container.dataset.structSig !== 'empty') {
            container.dataset.structSig = 'empty';
            container.innerHTML = '<div class="card">Все постройки и кастрюли свободны.</div>';
        }
        return;
    }

    const queues = {};
    const now = Date.now();
    localTimersData.forEach(t => {
        if (!queues[t.queue_group_id]) queues[t.queue_group_id] = [];
        queues[t.queue_group_id].push(t);
    });
    Object.values(queues).forEach(items => {
        items.sort((a, b) => {
            const ta = a && a.ends_at ? new Date(a.ends_at).getTime() : 0;
            const tb = b && b.ends_at ? new Date(b.ends_at).getTime() : 0;
            return ta - tb;
        });
    });

    const availBoosters = typeof getAvailableAcceleratorsCount === 'function' ? getAvailableAcceleratorsCount() : 0;
    const structParts = [];
    const timeUpdates = [];

    for (const [qId, items] of Object.entries(queues)) {
        const buildingObj = localBuildingsData.find(b => Number(b.queue_group_id) === Number(qId));
        const buildingTitle = buildingObj ? `${buildingObj.icon || '🏭'} ${buildingObj.building_name}` : `🏭 Производство #${qId}`;
        const slotSigs = [];
        for (let i = 0; i < 4; i++) {
            const item = items[i];
            if (!item) {
                slotSigs.push('empty');
                continue;
            }
            const isRunning = item.status === 'running';
            let rem = 0;
            let pillsNeeded = 0;
            let canAfford = 0;
            if (isRunning && item.ends_at) {
                const endTime = new Date(item.ends_at).getTime();
                rem = Math.max(0, Math.floor((endTime - now) / 1000));
                pillsNeeded = typeof calculateBoosterPills === 'function' ? calculateBoosterPills(rem) : Math.max(1, Math.ceil(Math.max(1, rem) / 900));
                canAfford = availBoosters >= pillsNeeded ? 1 : 0;
                timeUpdates.push({ id: item.id, text: formatRemainingCountdown(rem) });
            }
            slotSigs.push(`${item.id}:${item.name}:${item.status}:${pillsNeeded}:${canAfford}`);
        }
        structParts.push(`${qId}|${buildingTitle}|${items.length}|${slotSigs.join(',')}`);
    }

    const nextSig = structParts.join('||');
    if (container.dataset.structSig === nextSig) {
        for (const upd of timeUpdates) {
            const timeEl = document.getElementById(`slot-time-${upd.id}`);
            if (timeEl) timeEl.textContent = upd.text;
        }
        return;
    }

    let html = '';
    for (const [qId, items] of Object.entries(queues)) {
        const buildingObj = localBuildingsData.find(b => Number(b.queue_group_id) === Number(qId));
        const buildingTitle = buildingObj ? `${buildingObj.icon || '🏭'} ${buildingObj.building_name}` : `🏭 Производство #${qId}`;
        
        html += `<div class="card">
            <div class="card-header">
                <span>${buildingTitle}</span>
                <span>${items.length}/4</span>
            </div>
            <div style="display: flex; gap: 8px; overflow-x: auto; padding-top: 4px;">`;

        for (let i = 0; i < 4; i++) {
            const item = items[i];
            if (item) {
                const isRunning = item.status === 'running';
                let timeStr = '';
                let pillsNeeded = 0;
                
                if (isRunning && item.ends_at) {
                    const endTime = new Date(item.ends_at).getTime();
                    const rem = Math.max(0, Math.floor((endTime - now) / 1000));
                    timeStr = formatRemainingCountdown(rem);
                    pillsNeeded = typeof calculateBoosterPills === 'function' ? calculateBoosterPills(rem) : Math.max(1, Math.ceil(Math.max(1, rem) / 900));
                }

                const canAfford = availBoosters >= pillsNeeded;
                const emoji = getItemEmoji(item.name);
                const pillHtml = (isRunning && item.ends_at)
                    ? `<button type="button" class="booster-pill-btn ${canAfford ? '' : 'is-insufficient'}" onclick="accelerateRunningTimer('${item.id}')" title="Мгновенно завершить (нужно ${pillsNeeded} шт. из склада «Ускорители», доступно: ${availBoosters} шт.)">💊 ${pillsNeeded}</button>`
                    : '';
                
                html += `<div class="timer-slot" style="flex: 1; min-width: 70px; border: 2px solid ${isRunning ? '#22c55e' : '#eab308'}; border-radius: 10px; padding: 8px 4px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
                    <div style="font-size: 22px; margin-bottom: 2px;">${emoji}</div>
                    <div style="font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${item.name}</div>
                    <div id="${isRunning ? `slot-time-${item.id}` : ''}" style="font-size: 10px; color: ${isRunning ? '#16a34a' : '#d97706'}; margin-top: 4px; font-weight: 600;">
                        ${isRunning ? timeStr : '⏳ В очереди'}
                    </div>
                    ${pillHtml}
                </div>`;
            } else {
                html += `<div class="timer-slot-empty" style="flex: 1; min-width: 70px; border-radius: 10px; padding: 8px; height: 75px; display: flex; align-items: center; justify-content: center; font-size: 18px;">+</div>`;
            }
        }
        html += `</div></div>`;
    }
    container.dataset.structSig = nextSig;
    container.innerHTML = html;
}

function renderInventory() {
    const container = document.getElementById('inventory-container');
    if (!localInventoryData || localInventoryData.length === 0) {
        container.innerHTML = '<div class="badge">Склад пуст</div>';
        return;
    }

    const aggregatedMap = {};
    localInventoryData.forEach(item => {
        let name = item.name;
        if (name === 'Прогулка 10 м') name = 'Прогулка';

        const count = Number(item.count);
        const safeCount = isNaN(count) ? 1 : count;
        if (!aggregatedMap[name]) {
            aggregatedMap[name] = 0;
        }
        aggregatedMap[name] += safeCount;
    });

    const visibleEntries = Object.entries(aggregatedMap).filter(([name, count]) => count > 0 || name.toLowerCase() === 'ускорители');
    if (visibleEntries.length === 0) {
        container.innerHTML = '<div class="badge">Склад пуст</div>';
        return;
    }

    container.innerHTML = visibleEntries.map(([name, count]) => {
        const emoji = getItemEmoji(name);
        return `<div class="badge">${emoji} ${name}: <strong>${count} шт.</strong></div>`;
    }).join('');
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        forceSyncWithDB();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    initDashboard();
}
