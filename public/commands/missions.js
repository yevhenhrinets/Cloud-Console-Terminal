// commands/missions.js — консольные команды для поручений и списка заданий

(function() {
    // 0. Быстрый переход на страницу поручений missions.html
    CommandRegistry.register({
        names: ['go to missions', 'missions.html', 'open missions', 'go missions', 'todo', 'go to todo', 'go todo', 'open todo', 'список дел', 'страница заданий', 'страница поручений', 'missions page'],
        description: 'Быстрый переход на страницу поручений missions.html',
        category: '📋 Задания',
        usage: 'go to missions | missions.html | todo',
        handler: async (parameters, options = {}) => {
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
        description: 'Список активных поручений из таблицы или переход на страницу',
        category: '📋 Задания',
        usage: 'missions | go to missions | show missions | Add mission ТЕКСТ',
        handler: async (parameters, options = {}) => {
            const rawArgs = parameters && parameters.args ? parameters.args.join(' ').toLowerCase() : '';
            if (rawArgs.includes('go') || rawArgs.includes('open') || rawArgs.includes('page') || rawArgs.includes('html') || rawArgs.includes('страниц')) {
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

            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const activeMissions = window.MissionsStore.getActiveMissions();
            const pendingCount = typeof window.MissionsStore.getPendingOpsCount === 'function' ? window.MissionsStore.getPendingOpsCount() : 0;
            const pendingNote = pendingCount > 0 ? `\n📡 В очереди синхронизации с БД: ${pendingCount}` : '';

            if (!activeMissions || activeMissions.length === 0) {
                return {
                    response: `📋 В активном списке нет невыполненных поручений.${pendingNote}\n💡 Добавьте новое дело: \`Add mission Развесить стирку\`\n🔗 Открыть страницу: введите \`go to missions\` или \`missions.html\``,
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
            text += `💡 Выполнить из консоли: \`done mission 1\` или \`Add mission <текст>\``;

            return { response: text, style: 'output-info' };
        }
    });

    // 2. Прямая команда Add mission (строго в 2 этапа)
    CommandRegistry.register({
        names: ['add mission', 'добавить задание', 'додати завдання', 'добавить поручение', 'додати доручення', 'add task mission'],
        description: 'Добавление поручения в список дел (строго в 2 этапа)',
        category: '📋 Задания',
        usage: 'Add mission (затем ввести текст в поле)',
        handler: async (parameters, options = {}) => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const cleanText = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim();
            const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'add mission';

            if (cleanText && !(options && options.fromTwoStepBar)) {
                return {
                    response: `⚠️ Команда \`${prefix}\` работает только в 2 этапа — текст нельзя вводить сразу в команде!\n1) Введите \`add mission\` без текста\n2) После появления команды под строкой ввода напишите текст поручения.`,
                    style: 'output-error'
                };
            }

            if (!cleanText) {
                return {
                    response: '📋 Режим создания поручения активирован. Введите текст поручения и нажмите Enter (или ✕ для отмены).',
                    style: 'output-info',
                    commandPrefix: 'add mission',
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
                    editedEntity: 'mission'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка добавления поручения: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 3. Команда выполнения поручения из консоли (done mission 1)
    CommandRegistry.register({
        names: ['done mission', 'complete mission', 'выполнить поручение', 'виконати завдання'],
        description: 'Отметить поручение как выполненное с сохранением времени и таймзоны',
        category: '📋 Задания',
        usage: 'done mission [номер_в_списке]',
        handler: async (parameters) => {
            if (!window.MissionsStore) {
                return { response: '❌ Ошибка: модуль MissionsStore не загружен.', style: 'output-error' };
            }

            const target = parameters.args[0];
            if (!target) {
                return {
                    response: '❌ Укажите номер поручения для завершения.\nПример: `done mission 1`',
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
                const offlineHint = (typeof navigator !== 'undefined' && navigator.onLine === false)
                    ? '\n📡 Офлайн-режим: отметка сохранена локально и уйдёт в базу при подключении.'
                    : '';
                return {
                    response: `✅ Поручение выполнено!\n🎯 "${completed.title}"\n⏰ Отметка выполнения: ${completed.completed_display}\n🗄️ Задание убрано из активного списка и зафиксировано в таблице архива.${offlineHint}`,
                    style: 'output-success',
                    editedEntity: 'mission'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка выполнения: ${err.message}`,
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
