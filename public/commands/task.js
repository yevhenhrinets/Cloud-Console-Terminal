// commands/task.js — обработчик задач (Add task: пошагово building -> task -> time с сохранением совместимости; Del task / Show tasks)

function isExplicitDurationWithUnit(str) {
    return /^\d+\s*(?:ч|час(?:а|ов)?|h|hr|hrs|м|мин(?:ут(?:а|ы)?)?|m|min|mins|с|сек(?:унд(?:а|ы)?)?|s|sec|secs)$/i.test(String(str || '').trim());
}

function isValidTaskDuration(str) {
    const clean = String(str || '').trim().toLowerCase();
    if (!clean) return false;
    if (/^(?:\d+\s*(?:ч|час(?:а|ов)?|h|hr|hrs|м|мин(?:ут(?:а|ы)?)?|m|min|mins|с|сек(?:унд(?:а|ы)?)?|s|sec|secs)\s*)+$/i.test(clean)) {
        return parseTaskDuration(clean) > 0;
    }
    if (/^\d+$/.test(clean)) {
        return parseInt(clean, 10) > 0;
    }
    return false;
}

function parseTaskDuration(str) {
    if (!str) return 60;
    const clean = String(str).trim().toLowerCase();
    const compoundMatches = [...clean.matchAll(/(\d+)\s*(ч|час(?:а|ов)?|h|hr|hrs|м|мин(?:ут(?:а|ы)?)?|m|min|mins|с|сек(?:унд(?:а|ы)?)?|s|sec|secs)/gi)];
    if (compoundMatches.length > 0) {
        let total = 0;
        for (const m of compoundMatches) {
            const n = parseInt(m[1], 10) || 0;
            const unit = m[2].toLowerCase();
            if (unit.startsWith('ч') || unit.startsWith('h')) total += n * 3600;
            else if (unit.startsWith('м') || unit.startsWith('m')) total += n * 60;
            else total += n;
        }
        return total > 0 ? total : 60;
    }
    const num = parseInt(clean, 10) || 1;
    if (clean.includes('м') || clean.includes('m')) return num * 60;
    if (clean.includes('ч') || clean.includes('h')) return num * 3600;
    if (clean.includes('с') || clean.includes('s')) return num;
    return num;
}

function tokenizeTaskPayload(str) {
    const tokens = [];
    const regex = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
    let match;
    while ((match = regex.exec(String(str || ''))) !== null) {
        tokens.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]));
    }
    return tokens;
}

function stripLeadingWords(words, stopList) {
    let idx = 0;
    while (idx < words.length && stopList.includes(String(words[idx]).toLowerCase())) {
        idx++;
    }
    return words.slice(idx);
}

async function findBuildingMatch(userId, buildingQuery) {
    const q = String(buildingQuery || '').trim();
    if (!q) return { ok: false, error: '❌ Укажите название постройки.' };

    if (userId === 'guest') {
        const buildings = typeof getDemoBuildings === 'function' ? getDemoBuildings() : [];
        const qLower = q.toLowerCase();
        const target = buildings.find(b => b.building_name.trim().toLowerCase() === qLower)
            || buildings.find(b => b.building_name.toLowerCase().includes(qLower));
        if (!target) {
            return {
                ok: false,
                error: `❌ Постройка "${q}" не найдена. Доступны: Печь, Кухня, Лесопилка.`
            };
        }
        return { ok: true, buildingName: target.building_name };
    }

    try {
        const { data: buildings, error: fetchErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('id, building_name, queue_group_id')
            .eq('created_by', userId)
            .ilike('building_name', q);

        if (fetchErr) throw fetchErr;
        if (!buildings || buildings.length === 0) {
            return {
                ok: false,
                error: `❌ Ошибка: Постройка с именем "${q}" не найдена в базе!\nПроверьте точное название через команду \`show buildings\`.`
            };
        }
        return { ok: true, buildingName: buildings[0].building_name };
    } catch (err) {
        return { ok: false, error: '❌ Ошибка проверки постройки: ' + (err && err.message ? err.message : err) };
    }
}

// 1. Добавление задачи: Add task (пошагово: building -> task -> time; совместимость со строкой <Постройка> <Задача> <Время>)
async function handleAddTask(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

    const rawArgs = parameters.args || [];
    const leadStop = ['add', 'create', 'task', 'tasks', 'задача', 'задачи', 'завдання', 'добавить', 'создать', 'додати'];
    const cleanLeadArgs = stripLeadingWords(rawArgs, leadStop);

    if (!(options && options.fromTwoStepBar)) {
        if (cleanLeadArgs.length > 0) {
            return rejectInlineParamsError('add task', 'Таблетки');
        }
        return {
            response: '📋 Режим добавления задачи (Шаг 1/3 — Постройка).\nВведите название постройки (например: `Таблетки` или `Печь`) — либо для совместимости `<Постройка> <Задача> <Время>` — и нажмите Enter (или ✕ для отмены).',
            style: 'output-info',
            commandSteps: ['add task'],
            nextStepLabel: 'building',
            inputValue: '',
            inputPlaceholder: 'building: название постройки (напр: Таблетки или Печь)...'
        };
    }

    const steps = (Array.isArray(options.pendingSteps) && options.pendingSteps.length > 0)
        ? options.pendingSteps
        : ['add task'];
    const baseCmd = steps[0] || 'add task';
    const payload = String(options.stepPayload !== undefined ? options.stepPayload : (parameters.raw_args || '')).trim();

    // Шаг 2: ввод постройки (или обратная совместимость "<Постройка> <Задача> <Время>")
    if (steps.length === 1) {
        if (!payload) {
            return {
                response: '⚠️ Введите название постройки (например: `Таблетки` или `Печь`).',
                style: 'output-error',
                commandSteps: [baseCmd],
                nextStepLabel: 'building',
                inputValue: '',
                inputPlaceholder: 'building: название постройки (напр: Таблетки или Печь)...'
            };
        }

        // Обратная совместимость: если ввели в 1 строку "<Постройка> <Задача> <Время>" (минимум 3 токена и последний — время с единицей измерения)
        const tokens = tokenizeTaskPayload(payload);
        if (tokens.length >= 3 && isExplicitDurationWithUnit(tokens[tokens.length - 1])) {
            const buildingQuery = tokens[0];
            const durationStr = tokens[tokens.length - 1];
            const taskName = tokens.slice(1, tokens.length - 1).join(' ').trim();

            if (!buildingQuery || !taskName || !durationStr) {
                return { response: '❌ Неверный формат. Пример: `Печь Макароны 10м`', style: 'output-error' };
            }

            const res = await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, durationStr, 'add');
            res.stepEchoText = `last command:~$ ${payload}`;
            return res;
        }

        const lookup = await findBuildingMatch(currentUser.id, payload);
        if (!lookup.ok) {
            return {
                response: lookup.error,
                style: 'output-error',
                commandSteps: [baseCmd],
                nextStepLabel: 'building',
                inputValue: '',
                inputPlaceholder: 'building: название постройки (напр: Таблетки или Печь)...'
            };
        }

        const matchedBuildingName = lookup.buildingName || payload;
        return {
            response: `🏭 Постройка: **${matchedBuildingName}** (Шаг 2/3 — Задача).\nВведите название задачи (например: \`Отнести на кухню\`) и нажмите Enter (или ✕ для отмены).`,
            style: 'output-info',
            isHtml: true,
            commandSteps: [baseCmd, matchedBuildingName],
            nextStepLabel: 'task',
            inputValue: '',
            inputPlaceholder: 'task: название задачи (напр: Отнести на кухню)...'
        };
    }

    // Шаг 3: ввод названия задачи (без вырезания предлогов "в", "на" и т.д.)
    if (steps.length === 2) {
        const buildingQuery = steps[1];
        const taskName = payload;

        if (!taskName) {
            return {
                response: '⚠️ Введите название задачи (например: `Отнести на кухню`).',
                style: 'output-error',
                commandSteps: [baseCmd, buildingQuery],
                nextStepLabel: 'task',
                inputValue: '',
                inputPlaceholder: 'task: название задачи (напр: Отнести на кухню)...'
            };
        }

        return {
            response: `📝 Задача: **${taskName}** (Шаг 3/3 — Время).\nВведите длительность (например: \`45м\`, \`10m\`, \`1ч\`, \`30с\`) и нажмите Enter (или ✕ для отмены).`,
            style: 'output-info',
            isHtml: true,
            commandSteps: [baseCmd, buildingQuery, taskName],
            nextStepLabel: 'time',
            inputValue: '',
            inputPlaceholder: 'time: длительность (напр: 45м, 10m, 1ч, 30с)...'
        };
    }

    // Шаг 4: ввод времени и сохранение задачи
    const buildingQuery = steps[1];
    const taskName = steps[2];
    const durationStr = payload;

    if (!durationStr || !isValidTaskDuration(durationStr)) {
        return {
            response: `❌ Неверный формат времени${durationStr ? ` "${durationStr}"` : ''}. Введите длительность (например: \`45м\`, \`10m\`, \`1ч\`, \`30с\`).`,
            style: 'output-error',
            commandSteps: [baseCmd, buildingQuery, taskName],
            nextStepLabel: 'time',
            inputValue: '',
            inputPlaceholder: 'time: длительность (напр: 45м, 10m, 1ч, 30с)...'
        };
    }

    return await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, durationStr, 'add');
}

// 2. Удаление задачи: Del task (строго в 2 этапа, с сохранением предлогов внутри названия задачи)
async function handleDeleteTask(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

    const rawArgs = parameters.args || [];
    const delLeadStop = ['del', 'delete', 'remove', 'task', 'tasks', 'задача', 'задачи', 'завдання', 'удалить', 'удали', 'видалити', 'rm', 'из', 'в', 'з'];
    const cleanWords = stripLeadingWords(rawArgs, delLeadStop);

    if (!(options && options.fromTwoStepBar)) {
        if (cleanWords.length > 0) {
            return rejectInlineParamsError('del task', 'Печь Жареные яйца');
        }
        return {
            response: '🗑️ Режим удаления задачи активирован. Введите `<Постройка> <Задача>` (например: `Печь Жареные яйца`) и нажмите Enter (или ✕ для отмены).',
            style: 'output-info',
            commandPrefix: 'del task',
            inputValue: '',
            inputPlaceholder: 'Постройка Задача (напр: Печь Жареные яйца)...'
        };
    }

    const buildingQuery = cleanWords[0];
    const taskName = cleanWords.slice(1).join(' ');

    if (!buildingQuery || !taskName) {
        return {
            response: '❌ Укажите постройку и задачу для удаления (например: `Печь Жареные яйца`).',
            style: 'output-error'
        };
    }

    return await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, null, 'del');
}

// 3. Список задач: Show tasks (0 параметров) или Show building tasks (2 этапа)
async function handleShowTasks(parameters, options = {}, forceFilterMode = false) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

    const rawArgs = parameters.args || [];
    const filterBuilding = rawArgs.filter(w => !['show', 'list', 'task', 'tasks', 'building', 'for', 'задачи', 'задача', 'завдання', 'показать', 'filter', 'find'].includes(w.toLowerCase())).join(' ').trim();

    if (!(options && options.fromTwoStepBar)) {
        if (filterBuilding) {
            return rejectInlineParamsError('show building tasks', 'Печь', '💡 Для просмотра всех задач без фильтра введите просто `show tasks`.');
        }
        if (forceFilterMode) {
            return {
                response: '📋 Фильтр задач по постройке: введите название постройки (например: `Печь`) и нажмите Enter (или ✕ для отмены).',
                style: 'output-info',
                commandPrefix: 'show building tasks',
                inputValue: '',
                inputPlaceholder: 'Название постройки (напр: Печь)...'
            };
        }
    }

    if (forceFilterMode && !filterBuilding) {
        return { response: '❌ Укажите название постройки для фильтрации (например: `Печь`).', style: 'output-error' };
    }

    if (currentUser.isGuest) {
        const buildings = typeof getDemoBuildings === 'function' ? getDemoBuildings() : [];
        let list = buildings;
        if (filterBuilding) {
            list = buildings.filter(b => b.building_name.toLowerCase().includes(filterBuilding.toLowerCase()));
        }

        if (list.length === 0) {
            return { response: `❌ Постройка "${filterBuilding}" не найдена.`, style: 'output-error' };
        }

        let resp = '📋 Задачи в постройках (Демо/Offline):\n';
        list.forEach(b => {
            resp += `\n[Очередь #${b.queue_group_id}] **${b.building_name}**:\n`;
            if (b.tasks && b.tasks.length > 0) {
                b.tasks.forEach(t => {
                    const cRule = (window.TaskLaunchCosts && typeof window.TaskLaunchCosts.getRule === 'function')
                        ? window.TaskLaunchCosts.getRule(t.name, b.building_name)
                        : null;
                    const costText = cRule ? ` [при запуске: ${window.TaskLaunchCosts.formatCostText(cRule)}]` : '';
                    resp += `  • ${t.name} (${t.duration} сек)${costText}\n`;
                });
            } else {
                resp += `  • (нет задач — добавьте через \`add task\` в 2 этапа)\n`;
            }
        });
        return { response: resp, style: 'output-info', isHtml: true };
    }

    try {
        let query = window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', currentUser.id)
            .order('queue_group_id', { ascending: true });

        if (filterBuilding) {
            query = query.ilike('building_name', `%${filterBuilding}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            return { response: '📋 Задачи не найдены. Создайте первую: `add task` (в 2 этапа).', style: 'output-info' };
        }

        let resp = '📋 Задачи в ваших постройках:\n';
        data.forEach(b => {
            resp += `\n[Очередь #${b.queue_group_id}] **${b.building_name}**:\n`;
            if (b.tasks && b.tasks.length > 0) {
                b.tasks.forEach(t => {
                    const cRule = (window.TaskLaunchCosts && typeof window.TaskLaunchCosts.getRule === 'function')
                        ? window.TaskLaunchCosts.getRule(t.name, b.building_name)
                        : null;
                    const costText = cRule ? ` [при запуске: ${window.TaskLaunchCosts.formatCostText(cRule)}]` : '';
                    resp += `  • ${t.name} (${t.duration} сек)${costText}\n`;
                });
            } else {
                resp += `  • (нет задач — добавьте через \`add task\` в 2 этапа)\n`;
            }
        });
        return { response: resp, style: 'output-info', isHtml: true };
    } catch (err) {
        return { response: '❌ Ошибка загрузки задач: ' + err.message, style: 'output-error' };
    }
}

async function modifyTaskInBuilding(userId, buildingQuery, taskName, durationStr, action) {
    try {
        if (userId === 'guest') {
            const buildings = typeof getDemoBuildings === 'function' ? getDemoBuildings() : [];
            const qLower = buildingQuery.trim().toLowerCase();
            const targetBuilding = buildings.find(b => b.building_name.trim().toLowerCase() === qLower)
                || buildings.find(b => b.building_name.toLowerCase().includes(qLower));
            if (!targetBuilding) {
                return { response: `❌ Постройка "${buildingQuery}" не найдена. Доступны: Печь, Кухня, Лесопилка.`, style: 'output-error' };
            }
            if (action === 'add') {
                const durationSeconds = parseTaskDuration(durationStr);
                targetBuilding.tasks = targetBuilding.tasks || [];
                const exist = targetBuilding.tasks.find(t => t.name.toLowerCase() === taskName.toLowerCase());
                if (exist) {
                    exist.duration = durationSeconds;
                } else {
                    targetBuilding.tasks.push({ name: taskName, duration: durationSeconds });
                }
                if (typeof saveDemoBuildings === 'function') saveDemoBuildings(buildings);
                return { response: `🟢 Задача "${taskName}" (${durationStr}) добавлена в "${targetBuilding.building_name}"!`, style: 'output-success' };
            } else if (action === 'del') {
                targetBuilding.tasks = (targetBuilding.tasks || []).filter(t => t.name.toLowerCase() !== taskName.toLowerCase());
                if (typeof saveDemoBuildings === 'function') saveDemoBuildings(buildings);
                return { response: `🗑️ Задача "${taskName}" удалена из постройки "${targetBuilding.building_name}".`, style: 'output-success' };
            }
        }

        const { data: buildings, error: fetchErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', userId)
            .ilike('building_name', buildingQuery.trim());

        if (fetchErr) throw fetchErr;

        if (!buildings || buildings.length === 0) {
            return {
                response: `❌ Ошибка: Постройка с именем "${buildingQuery}" не найдена в базе!\nПроверьте точное название через команду \`show buildings\`.`,
                style: 'output-error'
            };
        }

        const prevSnapshots = buildings.map(b => ({
            id: b.id,
            tasks: JSON.parse(JSON.stringify(b.tasks || []))
        }));

        if (action === 'add') {
            const durationSeconds = parseTaskDuration(durationStr);

            for (const building of buildings) {
                let tasks = JSON.parse(JSON.stringify(building.tasks || []));
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

                await window.supabaseClient
                    .from('timer_templates')
                    .upsert([{
                        name: taskName,
                        duration_seconds: durationSeconds,
                        created_by: userId
                    }], { onConflict: 'name,created_by' });
            }

            return {
                response: `🟢 Задача "${taskName}" (${durationStr}) успешно закреплена за постройкой "${buildings[0].building_name}" (Очередь #${buildings[0].queue_group_id})!`,
                style: 'output-success',
                undoAction: {
                    type: 'supabase_restore_building_tasks',
                    snapshots: prevSnapshots,
                    description: `добавление задачи "${taskName}" в "${buildings[0].building_name}"`
                }
            };
        } else if (action === 'del') {
            for (const building of buildings) {
                let tasks = JSON.parse(JSON.stringify(building.tasks || []));
                tasks = tasks.filter(t => t.name.toLowerCase() !== taskName.toLowerCase());

                const { error: updateErr } = await window.supabaseClient
                    .from('terminal_buildings')
                    .update({ tasks: tasks, updated_at: new Date().toISOString() })
                    .eq('id', building.id);

                if (updateErr) throw updateErr;
            }

            return {
                response: `🗑️ Задача "${taskName}" удалена из постройки "${buildingQuery}".`,
                style: 'output-success',
                undoAction: {
                    type: 'supabase_restore_building_tasks',
                    snapshots: prevSnapshots,
                    description: `удаление задачи "${taskName}" из "${buildings[0].building_name}"`
                }
            };
        }
    } catch (err) {
        return { response: '❌ Ошибка: ' + err.message, style: 'output-error' };
    }
}

CommandRegistry.register({
    names: ['add task', 'create task', 'task add', 'tasks add', 'добавить задачу', 'создать задачу', 'додати завдання', 'створити завдання'],
    description: 'Закрепить задачу за постройкой (пошагово: building ➔ task ➔ time)',
    usage: 'add task -> <Постройка> -> <Задача> -> <Время>',
    category: '🏭 Постройки',
    handler: handleAddTask
});

CommandRegistry.register({
    names: ['show tasks', 'list tasks', 'tasks', 'task', 'task show', 'tasks show', 'задачи', 'задача', 'завдання', 'показать задачи', 'список задач'],
    description: 'Список задач во всех постройках',
    usage: 'show tasks | show building tasks -> <Постройка>',
    category: '🏭 Постройки',
    handler: async (parameters, options = {}) => {
        const fullText = (parameters.args || []).join(' ').toLowerCase();
        if (fullText.includes('add') || fullText.includes('добавить') || fullText.includes('создать')) {
            return await handleAddTask(parameters, options);
        }
        if (fullText.includes('del') || fullText.includes('delete') || fullText.includes('удалить') || fullText.includes('rm')) {
            return await handleDeleteTask(parameters, options);
        }
        return await handleShowTasks(parameters, options, false);
    }
});

CommandRegistry.register({
    names: ['show building tasks', 'filter tasks', 'find tasks', 'задачи постройки'],
    description: 'Задачи конкретной постройки (строго в 2 этапа)',
    usage: 'show building tasks -> <Постройка>',
    category: '🏭 Постройки',
    handler: async (parameters, options = {}) => {
        return await handleShowTasks(parameters, options, true);
    }
});

CommandRegistry.register({
    names: ['del task', 'delete task', 'remove task', 'task del', 'tasks del', 'task delete', 'удалить задачу', 'видалити завдання'],
    description: 'Удалить задачу из постройки (строго в 2 этапа)',
    usage: 'del task -> <Постройка> <Задача>',
    category: '🏭 Постройки',
    handler: handleDeleteTask
});
