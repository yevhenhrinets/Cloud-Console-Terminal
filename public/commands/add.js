// commands/add.js — добавление заметок, задач в постройки и таймеров (строго в 2 этапа)

async function createNoteCommandHandler(currentUser, rawContent, matchedCmd = 'write note', options = {}) {
    const content = String(rawContent || '').trim();
    const prefix = (matchedCmd === 'write a note' || matchedCmd === 'add note') ? matchedCmd : 'write note';

    if (content && !(options && options.fromTwoStepBar)) {
        return rejectInlineParamsError(prefix, 'Купить молоко');
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
        const createdNote = data && data[0] ? data[0] : null;
        if (createdNote && window.OfflineNotesSync) {
            const cache = window.OfflineNotesSync.getNotesCache(currentUser.id);
            cache.push(createdNote);
            window.OfflineNotesSync.saveNotesCache(currentUser.id, cache);
        }
        return {
            response: `🟢 Заметка успешно сохранена!`,
            style: 'output-success',
            editedEntity: 'note',
            undoAction: createdNote ? {
                type: 'supabase_delete_note',
                id: createdNote.id,
                inner_id: createdNote.inner_id,
                description: `создание заметки "${content}"`
            } : undefined
        };
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

async function addTimerHandler(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: t('not_authorized'), style: 'output-error' };
    }

    const matchedCmd = String((parameters && parameters.matchedCmd) || 'add timer').trim().toLowerCase();
    const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

    if (!(options && options.fromTwoStepBar)) {
        if (rawArgs) {
            return rejectInlineParamsError(matchedCmd, 'Сосиска 1');
        }
        return {
            response: `⏱️ Режим запуска таймера (\`${matchedCmd}\`) активирован. Введите \`<Название таймера> [очередь]\` (например: \`Сосиска 1\`) и нажмите Enter (или ✕ для отмены).`,
            style: 'output-info',
            commandPrefix: matchedCmd,
            inputValue: '',
            inputPlaceholder: 'Название таймера и номер очереди (напр: Сосиска 1)...'
        };
    }

    const args = (parameters.args || []).filter(w => !['timer', 'таймер', 'add'].includes(String(w).toLowerCase()));
    const rawTimerName = args[0];
    if (!rawTimerName) {
        return { response: '❌ Укажите название таймера и при необходимости номер очереди (напр: `Сосиска 1`).', style: 'output-error' };
    }

    let queueGroupId = 1;
    const possibleQueue = args[1];
    if (possibleQueue && !isNaN(possibleQueue)) {
        queueGroupId = parseInt(possibleQueue, 10);
    }

    const timerQueryName = rawTimerName.charAt(0).toUpperCase() + rawTimerName.slice(1).toLowerCase();

    if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
        return { response: '📡 Добавление облачных таймеров из терминала доступно при входе и подключении к интернету (или используйте Дашборд).', style: 'output-info' };
    }

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

        let consumedSuffix = '';
        const launchCostRule = (window.TaskLaunchCosts && typeof window.TaskLaunchCosts.getRule === 'function')
            ? window.TaskLaunchCosts.getRule(template.name, null)
            : null;

        if (launchCostRule) {
            const { data: invRows, error: invErr } = await window.supabaseClient
                .from('completed_items')
                .select('*')
                .eq('created_by', currentUser.id);
            if (invErr) throw invErr;

            const invCheck = window.TaskLaunchCosts.checkAvailability(launchCostRule, invRows || []);
            if (!invCheck.ok) {
                return {
                    response: window.TaskLaunchCosts.formatMissingError(launchCostRule, invCheck),
                    style: 'output-error'
                };
            }

            const nowIso = new Date().toISOString();
            for (const cost of launchCostRule.costs) {
                let leftToDeduct = Math.max(1, Number(cost.amount) || 1);
                for (const row of (invRows || [])) {
                    if (leftToDeduct <= 0) break;
                    if (!window.TaskLaunchCosts.matchesInventoryItem(row.name, cost)) continue;
                    const curCount = Math.max(0, Number(row.count) || 0);
                    if (curCount <= 0) continue;
                    const take = Math.min(curCount, leftToDeduct);
                    const { error: updInvErr } = await window.supabaseClient
                        .from('completed_items')
                        .update({ count: curCount - take, updated_at: nowIso })
                        .eq('id', row.id);
                    if (updInvErr) throw updInvErr;
                    row.count = curCount - take;
                    leftToDeduct -= take;
                }
            }

            try {
                const invCacheKey = `terminal_inventory_${currentUser.id}`;
                const cachedInv = JSON.parse(localStorage.getItem(invCacheKey) || '[]');
                if (Array.isArray(cachedInv) && cachedInv.length > 0) {
                    window.TaskLaunchCosts.deductFromList(cachedInv, launchCostRule);
                    localStorage.setItem(invCacheKey, JSON.stringify(cachedInv));
                }
            } catch (e) {}

            consumedSuffix = `\n📦 Списано со склада: ${window.TaskLaunchCosts.formatCostText(launchCostRule)}`;
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
            response: `⏱️ Таймер "${template.name}" добавлен в очередь #${queueGroupId}. ${statusMsg}${consumedSuffix}`,
            style: 'output-success',
            undoAction: {
                type: 'supabase_delete_timer',
                innerId: nextInnerId,
                description: `запуск таймера "${template.name}"`
            }
        };
    } catch (err) {
        return { response: '❌ Ошибка добавления таймера: ' + err.message, style: 'output-error' };
    }
}

CommandRegistry.register({
    names: ['add note', 'write note', 'write a note', 'написать заметку', 'написати нотатку'],
    description: 'Создать новую заметку (строго в 2 этапа)',
    category: 'Add',
    usage: 'add note -> <текст> | write note -> <текст>',
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
    names: ['add timer', 'create timer', 'start timer', 'timer', 'таймер', 'добавить таймер'],
    description: 'Добавить таймер в очередь (строго в 2 этапа)',
    category: 'Add',
    usage: 'add timer -> <Название> [очередь] | timer -> <Название> [очередь]',
    handler: addTimerHandler
});

CommandRegistry.register({
    names: ['add', 'добавить', 'додати'],
    description: 'Создание заметок, таймеров, поручений, построек и задач (строго в 2 этапа)',
    category: 'Add',
    usage: 'add note | add timer | add mission | add building | add task | add alias',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const args = parameters.args || [];
        let subIdx = 0;
        let subCmd = args[0] ? String(args[0]).toLowerCase() : '';
        if (['a', 'an', 'the'].includes(subCmd) && args[1]) {
            const nextSub = String(args[1]).toLowerCase();
            const isValid = typeof window.isValidEnglishArticlePair === 'function'
                ? window.isValidEnglishArticlePair(subCmd, nextSub, args.slice(2))
                : true;
            if (!isValid) {
                return {
                    response: `❌ Лексически некорректный артикль "${subCmd}" перед "${args[1]}".`,
                    style: 'output-error'
                };
            }
            subIdx = 1;
            subCmd = nextSub;
        }

        if (!subCmd) {
            return {
                response: '➕ Выберите словесную команду (все параметры вводятся поэтапно):\n  • `add note` / `write note` — новая заметка\n  • `add timer` / `timer` — запуск таймера\n  • `add mission` — новое поручение\n  • `add building` — новая постройка\n  • `add task` — новая задача в постройку\n  • `add alias` — новый псевдоним команды\n  • `Add house` — создать новый дом\n  • `Add room` — добавить комнату в дом\n  • `add thing` — добавить предмет в комнату',
                style: 'output-info'
            };
        }

        const tailArgs = args.slice(subIdx + 1);

        if (['house', 'home', 'дом', 'дім', 'будинок'].includes(subCmd)) {
            const hHandler = window.CommandRegistry.getHandler('add house');
            if (hHandler) {
                return await hHandler({
                    ...parameters,
                    args: tailArgs,
                    raw_args: tailArgs.join(' ').trim(),
                    matchedCmd: subCmd === 'home' ? 'add home' : 'Add house'
                }, options);
            }
        }

        if (['room', 'комната', 'комнату', 'кімната', 'кімнату'].includes(subCmd)) {
            const rHandler = window.CommandRegistry.getHandler('add room');
            if (rHandler) {
                return await rHandler({
                    ...parameters,
                    args: tailArgs,
                    raw_args: tailArgs.join(' ').trim(),
                    matchedCmd: 'Add room'
                }, options);
            }
        }

        if (['thing', 'item', 'предмет', 'вещь', 'річ'].includes(subCmd)) {
            const tHandler = window.CommandRegistry.getHandler('add thing');
            if (tHandler) {
                return await tHandler({
                    ...parameters,
                    args: tailArgs,
                    raw_args: tailArgs.join(' ').trim(),
                    matchedCmd: 'add thing'
                }, options);
            }
        }

        if (subCmd === 'note' || subCmd === 'заметка' || subCmd === 'нотатка' || subCmd === 'заметку' || subCmd === 'нотатку') {
            const content = tailArgs.join(' ').trim();
            return await createNoteCommandHandler(currentUser, content, 'add note', options);
        }

        if (['mission', 'missions', 'миссия', 'миссию', 'задание', 'поручение', 'поручення', 'дело'].includes(subCmd)) {
            const addMissionHandler = window.CommandRegistry.getHandler('add mission');
            const strippedParams = {
                ...parameters,
                args: tailArgs,
                raw_args: tailArgs.join(' ').trim(),
                matchedCmd: 'add mission'
            };
            if (addMissionHandler) {
                return await addMissionHandler(strippedParams, options);
            }
        }

        if (['building', 'buildings', 'постройка', 'постройки', 'здание', 'будівля', 'споруда'].includes(subCmd)) {
            const addBuildingHandler = window.CommandRegistry.getHandler('add building');
            if (addBuildingHandler) {
                return await addBuildingHandler(parameters, options);
            }
        }

        if (['task', 'tasks', 'задача', 'задачи', 'завдання'].includes(subCmd)) {
            const addTaskHandler = window.CommandRegistry.getHandler('add task');
            if (addTaskHandler) {
                return await addTaskHandler(parameters, options);
            }
        }

        if (['alias', 'aliases', 'алиас', 'алиасы', 'псевдоним', 'псевдонимы'].includes(subCmd)) {
            const isPlural = ['aliases', 'алиасы', 'псевдонимы'].includes(subCmd);
            const aliasHandler = window.CommandRegistry.getHandler(isPlural ? 'add aliases' : 'add alias');
            if (aliasHandler) {
                const restLower = tailArgs.join(' ').toLowerCase().trim();
                const filteredArgs = ['for the command', 'for command', 'for a command', 'для команды'].includes(restLower) ? [] : tailArgs;
                return await aliasHandler({
                    ...parameters,
                    args: filteredArgs,
                    raw_args: filteredArgs.join(' '),
                    matchedCmd: isPlural ? 'add aliases' : 'add alias'
                }, options);
            }
        }

        if (subCmd === 'timer' || subCmd === 'таймер') {
            return await addTimerHandler({
                ...parameters,
                args: args.slice(1),
                raw_args: args.slice(1).join(' ').trim(),
                matchedCmd: 'add timer'
            }, options);
        }

        if (!(options && options.fromTwoStepBar)) {
            return rejectInlineParamsError('add timer', 'Сосиска 1', '💡 Или используйте: `add note`, `add mission`, `add building`, `add task`, `add alias`, `Add house`, `Add room`, `add thing`.');
        }

        return await addTimerHandler(parameters, options);
    }
});

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
