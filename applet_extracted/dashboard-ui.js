// dashboard-ui.js — отрисовка, инициализация и события

async function initDashboard() {
    currentUser = await fetchCurrentUser();
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
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
    
    // Применяем фильтр к локальным данным сразу, если они загрузились из localStorage
    if (targetQueueId !== null) {
        localBuildingsData = localBuildingsData.filter(b => Number(b.queue_group_id) === targetQueueId);
        localTimersData = localTimersData.filter(t => Number(t.queue_group_id) === targetQueueId);
    }

    renderUI();

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
        container.innerHTML = '<div style="color: #94a3b8; font-size: 13px;">Построек нет. Создайте их из консоли командой `building add <Название> <Очередь>`</div>';
        return;
    }

    let html = '';
    localBuildingsData.forEach(b => {
        const icon = b.icon || '🏭';
        html += `<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 13px; color: #38bdf8; font-weight: bold; width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${icon} ${b.building_name}:
            </span>`;

        if (b.tasks && b.tasks.length > 0) {
            b.tasks.forEach(t => {
                const taskIcon = t.icon || getItemEmoji(t.name);
                html += `<button class="btn-action" style="font-size: 11px; padding: 6px 8px; background: #22c55e;" onclick="quickAddTimer('${t.name}', ${b.queue_group_id}, ${t.duration})">
                    ${taskIcon} ${t.name}
                </button>`;
            });
        } else {
            html += `<span style="font-size: 11px; color: #64748b;">(нет задач)</span>`;
        }

        html += `</div>`;
    });

    container.innerHTML = html;
}

// Вспомогательный выбор эмодзи по названию (для обратной совместимости)
function getItemEmoji(name) {
    const lowerName = name.toLowerCase();
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
    return '📦';
}

function renderQueues() {
    const container = document.getElementById('queues-container');
    if (!localTimersData || localTimersData.length === 0) {
        container.innerHTML = '<div class="card">Все постройки и кастрюли свободны.</div>';
        return;
    }

    const queues = {};
    const now = Date.now();
    localTimersData.forEach(t => {
        if (!queues[t.queue_group_id]) queues[t.queue_group_id] = [];
        queues[t.queue_group_id].push(t);
    });

    let html = '';
    for (const [qId, items] of Object.entries(queues)) {
        // Название постройки берем из загруженных динамических данных
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
                
                if (isRunning && item.ends_at) {
                    const endTime = new Date(item.ends_at).getTime();
                    const rem = Math.max(0, Math.floor((endTime - now) / 1000));
                    
                    if (rem >= 3600) {
                        const hours = Math.floor(rem / 3600);
                        const mins = Math.floor((rem % 3600) / 60);
                        timeStr = `${hours}ч ${mins}м`;
                    } else {
                        const mins = Math.floor(rem / 60);
                        const secs = rem % 60;
                        timeStr = `${mins}м ${secs < 10 ? '0' : ''}${secs}с`;
                    }
                }

                const emoji = getItemEmoji(item.name);
                
                html += `<div style="flex: 1; min-width: 70px; background: #0f172a; border: 2px solid ${isRunning ? '#22c55e' : '#eab308'}; border-radius: 10px; padding: 8px 4px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
                    <div style="font-size: 22px; margin-bottom: 2px;">${emoji}</div>
                    <div style="font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${item.name}</div>
                    <div style="font-size: 10px; color: ${isRunning ? '#4ade80' : '#94a3b8'}; margin-top: 4px;">
                        ${isRunning ? timeStr : '⏳ В очереди'}
                    </div>
                </div>`;
            } else {
                html += `<div style="flex: 1; min-width: 70px; background: #0f172a; border: 2px dashed #334155; border-radius: 10px; padding: 8px; height: 75px; display: flex; align-items: center; justify-content: center; color: #475569; font-size: 18px;">+</div>`;
            }
        }
        html += `</div></div>`;
    }
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

        const count = Number(item.count) || 1;
        if (!aggregatedMap[name]) {
            aggregatedMap[name] = 0;
        }
        aggregatedMap[name] += count;
    });

    container.innerHTML = Object.entries(aggregatedMap).map(([name, count]) => {
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
