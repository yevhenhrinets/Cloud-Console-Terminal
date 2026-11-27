// commands/missions.js — консольные команды для поручений и списка заданий

(function() {
    // 0. Быстрый переход на страницу поручений missions.html
    CommandRegistry.register({
        names: ['go to missions', 'missions.html', 'open missions', 'go missions', 'todo', 'go to todo', 'go todo', 'open todo', 'список дел', 'страница заданий', 'страница поручений', 'missions page'],
        description: 'Быстрый переход на страницу поручений missions.html',
        category: '📋 Задания',
        usage: 'go to missions | missions.html | todo',
        handler: async (parameters, options = {}) => {
            if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
                return rejectInlineParamsError(parameters.matchedCmd || 'go to missions', '');
            }
            if (options && options.skipRedirect) {
                return {
                    response: '🆕 Открываю страницу поручений в новой вкладке: /missions.html',
                    style: 'output-info'
                };
            }
            setTimeout(() => {
                window.location.href = '/missions.html';
            }, 250);
            return {
                response: '🚀 Открываю страницу поручений: missions.html...',
                style: 'output-info'
            };
        }
    });

    // 1. Команда просмотра активных поручений
    CommandRegistry.register({
        names: ['missions', 'show missions', 'поручения', 'поручення', 'задания', 'завдання'],
        description: 'Список активных поручений из таблицы',
        category: '📋 Задания',
        usage: 'missions | show missions | add mission | done mission',
        handler: async (parameters, options = {}) => {
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            if (!(options && options.fromTwoStepBar) && rawArgs) {
                return rejectInlineParamsError(
                    'done mission',
                    '1',
                    '💡 Для списка поручений введите просто `missions`, для добавления — `add mission`, для перехода — `go to missions`.'
                );
            }

            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const activeMissions = window.MissionsStore.getActiveMissions();
            const pendingCount = typeof window.MissionsStore.getPendingOpsCount === 'function' ? window.MissionsStore.getPendingOpsCount() : 0;
            const pendingNote = pendingCount > 0 ? `\n📡 В очереди синхронизации с БД: ${pendingCount}` : '';

            if (!activeMissions || activeMissions.length === 0) {
                return {
                    response: `📋 В активном списке нет невыполненных поручений.${pendingNote}\n💡 Добавьте новое дело: \`add mission\` (в 2 этапа)\n🔗 Открыть страницу: введите \`go to missions\` или \`missions.html\``,
                    style: 'output-info'
                };
            }

            let text = `📋 Активные поручения (${activeMissions.length} в очереди):${pendingNote}\n`;
            text += `-----------------------------------------\n`;

            activeMissions.forEach((m, idx) => {
                const pos = m.position || (idx + 1);
                text += `[#${pos}] ⏳ ${m.title}\n    Создано: ${m.created_display || m.created_at}\n`;
            });

            text += `-----------------------------------------\n`;
            text += `💡 Быстрый переход на страницу: введите \`go to missions\` или \`missions.html\`\n`;
            text += `💡 Выполнить из консоли (2 этапа): \`done mission\` ➔ номер | \`add mission\` ➔ текст | \`completed missions\``;

            return { response: text, style: 'output-info' };
        }
    });

    // 1.1. Команда просмотра выполненных поручений с точным временем и сквозной нумерацией после активных
    CommandRegistry.register({
        names: ['completed missions', 'done missions', 'выполненные поручения', 'виконані завдання'],
        description: 'Список выполненных поручений с точным временем выполнения и нумерацией после активных',
        category: '📋 Задания',
        usage: 'completed missions',
        handler: async (parameters, options = {}) => {
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            if (!(options && options.fromTwoStepBar) && rawArgs) {
                return rejectInlineParamsError(parameters.matchedCmd || 'completed missions', '');
            }
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }
            const activeCount = window.MissionsStore.getActiveMissions().length;
            const completed = window.MissionsStore.getCompletedMissions();
            if (!completed || completed.length === 0) {
                return { response: '🗄️ Выполненных поручений пока нет.', style: 'output-info' };
            }
            let text = `🗄️ Выполненные и отменённые поручения (${completed.length}, от новых к старым):\n`;
            text += `-----------------------------------------\n`;
            completed.slice(0, 20).forEach((m, idx) => {
                const num = activeCount + idx + 1;
                const isCancelled = m.status === 'cancelled';
                const d = m.completed_at ? new Date(m.completed_at) : null;
                const timeStr = (d && !isNaN(d.getTime()))
                    ? `${d.toLocaleDateString('ru-RU')} в ${d.toLocaleTimeString('ru-RU')}`
                    : (m.completed_display || m.completed_at || '—');
                text += `[#${num}] ${isCancelled ? '🚫' : '✅'} ${m.title}\n    ${isCancelled ? 'Отменено' : 'Выполнено'}: ${timeStr}\n`;
            });
            if (completed.length > 20) {
                text += `... и ещё ${completed.length - 20} (откройте \`go to missions\` для полного списка).\n`;
            }
            return { response: text.trim(), style: 'output-info' };
        }
    });

    // 2. Прямая команда Add mission (строго в 2 этапа)
    CommandRegistry.register({
        names: ['add mission', 'добавить задание', 'додати завдання', 'добавить поручение', 'додати доручення', 'add task mission'],
        description: 'Добавление поручения в список дел (строго в 2 этапа)',
        category: '📋 Задания',
        usage: 'add mission -> <текст>',
        handler: async (parameters, options = {}) => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const cleanText = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim();
            const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'add mission';

            if (cleanText && !(options && options.fromTwoStepBar)) {
                return rejectInlineParamsError(prefix, 'Развесить стирку');
            }

            if (!cleanText) {
                return {
                    response: '📋 Режим создания поручения активирован. Введите текст поручения и нажмите Enter (или ✕ для отмены).',
                    style: 'output-info',
                    commandPrefix: prefix,
                    inputValue: '',
                    inputPlaceholder: 'Введите текст нового поручения...'
                };
            }

            const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            const userId = currentUser ? currentUser.id : 'guest';

            try {
                const newMission = await window.MissionsStore.addMission(cleanText, userId);
                const offlineHint = (typeof navigator !== 'undefined' && navigator.onLine === false)
                    ? '\n📡 Офлайн-режим: поручение сохранено локально и отправится в базу при появлении сети.'
                    : '';
                return {
                    response: `🟢 Поручение успешно создано!\n📋 [#${newMission.position}] "${newMission.title}"\n⏱️ Время фиксации: ${newMission.created_display}${offlineHint}\n🔗 Открыть страницу заданий: /missions.html`,
                    style: 'output-success',
                    editedEntity: 'mission',
                    undoAction: newMission && newMission.id ? {
                        type: 'missions_delete',
                        missionId: newMission.id,
                        description: `добавление поручения "${newMission.title}"`
                    } : undefined
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка добавления поручения: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 3. Команда выполнения поручения из консоли (строго в 2 этапа: done mission -> 1)
    CommandRegistry.register({
        names: ['done mission', 'complete mission', 'выполнить поручение', 'виконати завдання'],
        description: 'Отметить поручение как выполненное (строго в 2 этапа)',
        category: '📋 Задания',
        usage: 'done mission -> <номер>',
        handler: async (parameters, options = {}) => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const matchedCmd = String((parameters && parameters.matchedCmd) || 'done mission').trim().toLowerCase();
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!(options && options.fromTwoStepBar)) {
                if (rawArgs) {
                    return rejectInlineParamsError(matchedCmd, '1');
                }
                return {
                    response: `✅ Режим завершения поручения (\`${matchedCmd}\`) активирован. Введите номер поручения (например: 1) и нажмите Enter (или ✕ для отмены).`,
                    style: 'output-info',
                    commandPrefix: matchedCmd,
                    inputValue: '',
                    inputPlaceholder: 'Введите номер поручения (напр: 1)...'
                };
            }

            const target = parameters.args && parameters.args[0];
            if (!target) {
                return {
                    response: '❌ Укажите номер поручения для завершения (например: `1`).',
                    style: 'output-error'
                };
            }

            const activeMissions = window.MissionsStore.getActiveMissions();
            const posNum = parseInt(target, 10);
            let mission = null;

            if (!isNaN(posNum)) {
                mission = activeMissions.find(m => m.position === posNum) || activeMissions[posNum - 1];
            } else {
                mission = activeMissions.find(m => String(m.id) === String(target));
            }

            if (!mission) {
                return {
                    response: `❌ Поручение под номером или ID "${target}" не найдено в активном списке.`,
                    style: 'output-error'
                };
            }

            try {
                const completed = await window.MissionsStore.completeMission(mission.id);
                const agoText = typeof window.MissionsStore.formatTimeAgo === 'function'
                    ? window.MissionsStore.formatTimeAgo(completed.completed_at)
                    : '';
                const agoPart = agoText ? ` (${agoText})` : '';
                const offlineHint = (typeof navigator !== 'undefined' && navigator.onLine === false)
                    ? '\n📡 Офлайн-режим: отметка сохранена локально и уйдёт в базу при подключении.'
                    : '';
                return {
                    response: `✅ Поручение выполнено!\n🎯 "${completed.title}"\n⏰ Отметка выполнения: ${completed.completed_display}${agoPart}\n🗄️ Задание убрано из активного списка и зафиксировано в таблице архива.${offlineHint}`,
                    style: 'output-success',
                    editedEntity: 'mission',
                    undoAction: {
                        type: 'missions_reopen',
                        missionId: mission.id,
                        description: `выполнение поручения "${completed.title}"`
                    }
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка выполнения: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 3.1. Команда отмены поручения из консоли (строго в 2 этапа: cancel mission -> 1)
    CommandRegistry.register({
        names: ['cancel mission', 'отменить поручение', 'отменить задание', 'скасувати завдання'],
        description: 'Отменить поручение (строго в 2 этапа)',
        category: '📋 Задания',
        usage: 'cancel mission -> <номер>',
        handler: async (parameters, options = {}) => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const matchedCmd = String((parameters && parameters.matchedCmd) || 'cancel mission').trim().toLowerCase();
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!(options && options.fromTwoStepBar)) {
                if (rawArgs) {
                    return rejectInlineParamsError(matchedCmd, '1');
                }
                return {
                    response: `🚫 Режим отмены поручения (\`${matchedCmd}\`) активирован. Введите номер поручения (например: 1) и нажмите Enter (или ✕ для отмены).`,
                    style: 'output-info',
                    commandPrefix: matchedCmd,
                    inputValue: '',
                    inputPlaceholder: 'Введите номер поручения (напр: 1)...'
                };
            }

            const target = parameters.args && parameters.args[0];
            if (!target) {
                return {
                    response: '❌ Укажите номер поручения для отмены (например: `1`).',
                    style: 'output-error'
                };
            }

            const activeMissions = window.MissionsStore.getActiveMissions();
            const posNum = parseInt(target, 10);
            let mission = null;

            if (!isNaN(posNum)) {
                mission = activeMissions.find(m => m.position === posNum) || activeMissions[posNum - 1];
            } else {
                mission = activeMissions.find(m => String(m.id) === String(target));
            }

            if (!mission) {
                return {
                    response: `❌ Поручение под номером или ID "${target}" не найдено в активном списке.`,
                    style: 'output-error'
                };
            }

            try {
                const cancelled = await window.MissionsStore.cancelMission(mission.id);
                const offlineHint = (typeof navigator !== 'undefined' && navigator.onLine === false)
                    ? '\n📡 Офлайн-режим: отметка сохранена локально и уйдёт в базу при подключении.'
                    : '';
                return {
                    response: `🚫 Поручение отменено!\n🎯 "${cancelled.title}"\n⏰ Время отмены: ${cancelled.completed_display}\n🗄️ Задание убрано из активного списка и зафиксировано как отменённое в таблице.${offlineHint}`,
                    style: 'output-success',
                    editedEntity: 'mission',
                    undoAction: {
                        type: 'missions_reopen',
                        missionId: mission.id,
                        description: `отмена поручения "${cancelled.title}"`
                    }
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка отмены: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 4. Команда синхронизации с базой данных Supabase
    CommandRegistry.register({
        names: ['sync missions', 'синхронизировать задания', 'sync supabase', 'ping supabase'],
        description: 'Принудительная синхронизация и проверка связи с Supabase',
        category: '📋 Задания',
        usage: 'sync missions | ping supabase',
        handler: async () => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                const pendingCount = typeof window.MissionsStore.getPendingOpsCount === 'function' ? window.MissionsStore.getPendingOpsCount() : 0;
                return {
                    response: `📡 Нет подключения к интернету.\nЛокальные изменения (в очереди: ${pendingCount}) автоматически синхронизируются при восстановлении сети.`,
                    style: 'output-info'
                };
            }

            try {
                if (typeof window.flushAllOfflineConsoleQueues === 'function') {
                    await window.flushAllOfflineConsoleQueues();
                }

                if (typeof window.testSupabaseConnection === 'function') {
                    const ping = await window.testSupabaseConnection();
                    if (!ping.ok) {
                        return {
                            response: `🚨 Ошибка базы данных Supabase!\nКод: ${ping.error.code} (HTTP ${ping.error.status})\nСообщение: ${ping.error.message}\n${ping.error.details ? 'Детали: ' + ping.error.details + '\n' : ''}${ping.error.hint ? 'Подсказка: ' + ping.error.hint + '\n' : ''}💡 Проверьте настройки RLS в Supabase SQL.`,
                            style: 'output-error'
                        };
                    }
                }

                const res = await window.MissionsStore.trySyncSupabase(true);
                const count = window.MissionsStore.getAllMissions().length;
                const remoteStr = res && res.remoteCount !== undefined ? ` (в базе Supabase: ${res.remoteCount})` : '';
                return {
                    response: `🟢 Двусторонняя синхронизация с Supabase выполнена успешно!\n📦 Поручений: ${count}${remoteStr}\n🔗 Страница поручений: /missions.html`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `🚨 Ошибка синхронизации с Supabase:\n${err.message}\nКод: ${err.code || err.status || 'N/A'}\n${err.details ? 'Детали: ' + err.details : ''}`,
                    style: 'output-error'
                };
            }
        }
    });
})();
