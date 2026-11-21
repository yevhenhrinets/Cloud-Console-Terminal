// commands/add.js — добавление заметок, задач в постройки и таймеров

// Общий обработчик создания заметки (add note / write note / write a note — ТОЛЬКО в 2 этапа)
async function createNoteCommandHandler(currentUser, rawContent, matchedCmd = 'write note', options = {}) {
    const content = String(rawContent || '').trim();
    const prefix = (matchedCmd === 'write a note' || matchedCmd === 'add note') ? matchedCmd : 'write note';

    if (content && !(options && options.fromTwoStepBar)) {
        return {
            response: `⚠️ Команда \`${prefix}\` работает только в 2 этапа — произвольный текст нельзя вводить сразу в команде!\n1) Введите \`${prefix}\` без текста\n2) После появления команды под строкой ввода напишите текст заметки.`,
            style: 'output-error'
        };
    }

    if (!content) {
        return {
            response: `📝 Режим создания заметки активирован. Введите текст заметки и нажмите Enter (или ✕ для отмены).`,
            style: 'output-info',
            commandPrefix: prefix,
            inputValue: '',
            inputPlaceholder: 'Введите текст новой заметки...'
        };
    }

    const isOnline = (typeof navigator === 'undefined' || navigator.onLine !== false) && Boolean(window.supabaseClient);
    if (!isOnline || currentUser.isGuest) {
        if (window.OfflineNotesSync) {
            const localNote = window.OfflineNotesSync.queueAddNoteOffline(currentUser.id, content);
            return {
                response: `🟢 Заметка сохранена локально [ID: ${localNote.inner_id}] (офлайн-очередь — отправится в БД при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        }
        return { response: '❌ Нет подключения к сети.', style: 'output-error' };
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('notes')
            .insert([{ content, created_by: currentUser.id }])
            .select('*');

        if (error) throw error;
        if (data && data[0] && window.OfflineNotesSync) {
            const cache = window.OfflineNotesSync.getNotesCache(currentUser.id);
            cache.push(data[0]);
            window.OfflineNotesSync.saveNotesCache(currentUser.id, cache);
        }
        return { response: `🟢 Заметка успешно сохранена!`, style: 'output-success', editedEntity: 'note' };
    } catch (err) {
        if (window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
            const localNote = window.OfflineNotesSync.queueAddNoteOffline(currentUser.id, content);
            return {
                response: `🟢 Заметка сохранена локально [ID: ${localNote.inner_id}] (офлайн-очередь — отправится в БД при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        }
        return { response: '❌ Ошибка сохранения заметки: ' + err.message, style: 'output-error' };
    }
}

CommandRegistry.register({
    names: ['add note', 'write note', 'write a note', 'написать заметку', 'написати нотатку'],
    description: 'Создать новую заметку (строго в 2 этапа)',
    category: 'Add',
    usage: 'add note | write note | write a note',
    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }
        const content = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim();
        return await createNoteCommandHandler(currentUser, content, parameters.matchedCmd || 'write note', options);
    }
});

CommandRegistry.register({
    names: ['add', 'добавить', 'додати', 'timer', 'таймер'],
    description: 'Adding new item',
    category: 'Add',
    usage: 'add note | write note | add mission | add building | add task',
    
    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const args = parameters.args;
        const subCmd = args[0] ? args[0].toLowerCase() : '';

        // 1. Добавление заметки
        if (subCmd === 'note' || subCmd === 'заметка' || subCmd === 'нотатка') {
            const content = args.slice(1).join(' ').trim();
            return await createNoteCommandHandler(currentUser, content, 'add note', options);
        }

        // 1.5. Добавление поручения / миссии (строго 2 этапа)
        if (['mission', 'missions', 'миссия', 'миссию', 'задание', 'поручение', 'поручення', 'дело'].includes(subCmd)) {
            const addMissionHandler = window.CommandRegistry.getHandler('add mission');
            const strippedParams = {
                ...parameters,
                args: args.slice(1),
                raw_args: args.slice(1).join(' ').trim(),
                matchedCmd: 'add mission'
            };
            if (addMissionHandler) {
                return await addMissionHandler(strippedParams, options);
            }
        }

        // 1.8. Добавление постройки (строго 2 этапа)
        if (['building', 'buildings', 'постройка', 'постройки', 'здание', 'будівля', 'споруда'].includes(subCmd)) {
            const addBuildingHandler = window.CommandRegistry.getHandler('add building');
            if (addBuildingHandler) {
                return await addBuildingHandler(parameters, options);
            }
        }

        // 2. Добавление задачи в постройку (строго 2 этапа)
        if (['task', 'tasks', 'задача', 'задачи', 'завдання'].includes(subCmd)) {
            const addTaskHandler = window.CommandRegistry.getHandler('add task');
            if (addTaskHandler) {
                return await addTaskHandler(parameters, options);
            }
        }

        // 2.5. Добавление псевдонимов (Add alias / Add aliases — 3 этапа)
        if (['alias', 'aliases', 'алиас', 'алиасы', 'псевдоним', 'псевдонимы'].includes(subCmd) || (subCmd === 'an' && args[1] && args[1].toLowerCase() === 'alias')) {
            const isPlural = ['aliases', 'алиасы', 'псевдонимы'].includes(subCmd);
            const aliasHandler = window.CommandRegistry.getHandler(isPlural ? 'add aliases' : 'add alias');
            if (aliasHandler) {
                const startIdx = subCmd === 'an' ? 2 : 1;
                const restArgs = args.slice(startIdx);
                const restLower = restArgs.join(' ').toLowerCase().trim();
                const filteredArgs = ['for the command', 'for command', 'for a command', 'для команды'].includes(restLower) ? [] : restArgs;
                return await aliasHandler({
                    ...parameters,
                    args: filteredArgs,
                    raw_args: filteredArgs.join(' '),
                    matchedCmd: isPlural ? 'add aliases' : 'add alias'
                }, options);
            }
        }

        // 3. Добавление таймера
        let timerNameIndex = 0;
        if (['timer', 'таймер', 'add'].includes(subCmd)) {
            timerNameIndex = 1;
            if (args[1] && ['timer', 'таймер', 'note', 'заметка'].includes(args[1].toLowerCase())) {
                timerNameIndex = 2;
            }
        }

        const rawTimerName = args[timerNameIndex];
        if (!rawTimerName) {
            return { response: '❌ Неверный формат команды. Примеры:\n  • `add note Текст`\n  • `timer Сосиска 1`\n  • `add timer Мультиварка 2`', style: 'output-error' };
        }

        let queueGroupId = 1;
        const possibleQueue = args[timerNameIndex + 1];
        if (possibleQueue && !isNaN(possibleQueue)) {
            queueGroupId = parseInt(possibleQueue, 10);
        }

        const timerQueryName = rawTimerName.charAt(0).toUpperCase() + rawTimerName.slice(1).toLowerCase();

        try {
            const { data: templates, error: tError } = await window.supabaseClient
                .from('timer_templates')
                .select('*')
                .ilike('name', timerQueryName)
                .limit(1);

            if (tError) throw tError;
            
            const template = templates && templates.length > 0 ? templates[0] : null;

            if (!template) {
                return { response: `❌ Неизвестный таймер "${rawTimerName}".`, style: 'output-error' };
            }

            // Проверка кулдауна (Памперс — 3 часа, Кипяток — 1 час) и запрет дубля в очереди
            if (window.TaskCooldowns) {
                const rule = window.TaskCooldowns.getRule(template.name);
                if (rule) {
                    await window.TaskCooldowns.syncFromSupabase(currentUser.id);
                    const cdState = window.TaskCooldowns.getState(template.name, currentUser.id);
                    if (cdState && cdState.active) {
                        return {
                            response: `⛔ Нельзя запустить «${rule.label}» раньше времени! Идёт кулдаун — осталось ${cdState.formatted}.`,
                            style: 'output-error'
                        };
                    }
                    const { data: userActive } = await window.supabaseClient
                        .from('active_timers')
                        .select('id, name, status')
                        .eq('created_by', currentUser.id);
                    const duplicate = (userActive || []).find(t => {
                        const r = window.TaskCooldowns.getRule(t.name);
                        return r && r.key === rule.key;
                    });
                    if (duplicate) {
                        return {
                            response: `⏳ Задача «${rule.label}» уже выполняется или стоит в очереди! Повторный запуск будет доступен после завершения и окончания кулдауна.`,
                            style: 'output-error'
                        };
                    }
                }
            }

            const { data: existingTimers, error: qError } = await window.supabaseClient
                .from('active_timers')
                .select('*')
                .eq('created_by', currentUser.id)
                .eq('queue_group_id', queueGroupId)
                .order('ends_at', { ascending: false });

            if (qError) throw qError;

            const MAX_QUEUE_LIMIT = 5;
            if (existingTimers && existingTimers.length >= MAX_QUEUE_LIMIT) {
                return { response: `❌ Очередь заполнена (лимит очереди #${queueGroupId} исчерпан).`, style: 'output-error' };
            }

            let baseTime = Date.now();
            if (existingTimers && existingTimers.length > 0) {
                const validEnds = existingTimers
                    .map(t => t.ends_at ? new Date(t.ends_at).getTime() : 0)
                    .filter(t => t > baseTime);
                
                if (validEnds.length > 0) {
                    baseTime = Math.max(...validEnds);
                }
            }

            const durationMs = template.duration_seconds * 1000;
            const endsAt = new Date(baseTime + durationMs).toISOString();
            const status = (!existingTimers || existingTimers.length === 0) ? 'running' : 'queued';

            const { data: maxIdData } = await window.supabaseClient
                .from('active_timers')
                .select('inner_id')
                .eq('created_by', currentUser.id)
                .order('inner_id', { ascending: false })
                .limit(1);

            const nextInnerId = (maxIdData && maxIdData.length > 0 && maxIdData[0].inner_id) ? maxIdData[0].inner_id + 1 : 1;

            const { error: insertError } = await window.supabaseClient
                .from('active_timers')
                .insert([{
                    inner_id: nextInnerId,
                    name: template.name,
                    queue_group_id: queueGroupId,
                    total_seconds: template.duration_seconds,
                    remaining_seconds: template.duration_seconds,
                    ends_at: endsAt,
                    status: status,
                    created_by: currentUser.id
                }]);

            if (insertError) throw insertError;

            const statusMsg = status === 'running' ? '🟢 Запущен в работу!' : '⏳ Встал в очередь (время суммировано).';
            return { 
                response: `⏱️ Таймер "${template.name}" добавлен в очередь #${queueGroupId}. ${statusMsg}`, 
                style: 'output-success' 
            };

        } catch (err) {
            return { response: '❌ Ошибка добавления таймера: ' + err.message, style: 'output-error' };
        }
    }
});

// Глобальная вспомогательная функция для работы с задачами в постройках
async function modifyTaskInBuildingGlobal(userId, buildingQuery, taskName, durationStr, action) {
    const parseDurationSeconds = (str) => {
        if (!str) return 60;
        const lowerStr = str.toLowerCase();
        const num = parseInt(str, 10) || 1;
        if (lowerStr.includes('м') || lowerStr.includes('m')) return num * 60;
        if (lowerStr.includes('ч') || lowerStr.includes('h')) return num * 3600;
        if (lowerStr.includes('с') || lowerStr.includes('s')) return num;
        return num;
    };

    try {
        const { data: buildings, error: fetchErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', userId)
            .ilike('building_name', buildingQuery);

        if (fetchErr) throw fetchErr;
        if (!buildings || buildings.length === 0) {
            return { response: `❌ Постройка "${buildingQuery}" не найдена.`, style: 'output-error' };
        }

        if (action === 'add') {
            const durationSeconds = parseDurationSeconds(durationStr);

            for (const building of buildings) {
                let tasks = building.tasks || [];
                const existingIdx = tasks.findIndex(t => t.name.toLowerCase() === taskName.toLowerCase());
                
                if (existingIdx !== -1) {
                    tasks[existingIdx].duration = durationSeconds;
                } else {
                    tasks.push({ name: taskName, duration: durationSeconds });
                }

                const { error: updateErr } = await window.supabaseClient
                    .from('terminal_buildings')
                    .update({ tasks: tasks, updated_at: new Date().toISOString() })
                    .eq('id', building.id);

                if (updateErr) throw updateErr;
            }

            return { response: `🟢 Задача "${taskName}" (${durationStr}) добавлена во все постройки "${buildingQuery}" (${buildings.length} шт.)!`, style: 'output-success' };
        }
    } catch (err) {
        return { response: '❌ Ошибка: ' + err.message, style: 'output-error' };
    }
}
