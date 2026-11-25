// commands/task.js — обработчик задач (Add task, Del task, Filter tasks — строго в 2 этапа; Show tasks — без параметров)

function parseTaskDuration(str) {
    if (!str) return 60;
    const lowerStr = String(str).toLowerCase();
    const num = parseInt(str, 10) || 1;
    if (lowerStr.includes('м') || lowerStr.includes('m')) return num * 60;
    if (lowerStr.includes('ч') || lowerStr.includes('h')) return num * 3600;
    if (lowerStr.includes('с') || lowerStr.includes('s')) return num;
    return num;
}

// 1. Добавление задачи: Add task (строго в 2 этапа)
async function handleAddTask(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

    const rawArgs = parameters.args || [];
    const cleanArgs = rawArgs.filter(w => !['add', 'create', 'task', 'tasks', 'задача', 'задачи', 'завдання', 'добавить', 'создать', 'додати', 'в', 'на'].includes(w.toLowerCase()));

    if (cleanArgs.length > 0 && !(options && options.fromTwoStepBar)) {
        return rejectInlineParamsError('add task', 'Печь Пирог 10м');
    }

    if (cleanArgs.length === 0) {
        return {
            response: '📋 Режим добавления задачи активирован. Введите `<Постройка> <Задача> <Время>` (например: `Печь Пирог 10м`) и нажмите Enter (или ✕ для отмены).',
            style: 'output-info',
            commandPrefix: 'add task',
            inputValue: '',
            inputPlaceholder: 'Постройка Задача Время (напр: Печь Пирог 10м)...'
        };
    }

    if (cleanArgs.length < 3) {
        return {
            response: '❓ Формат данных после `add task`:\n  • `<Постройка> <Задача> <Время>`\nПример: `Печь Макароны 10м`',
            style: 'output-error'
        };
    }

    const buildingQuery = cleanArgs[0];
    const durationStr = cleanArgs[cleanArgs.length - 1];
    const taskName = cleanArgs.slice(1, cleanArgs.length - 1).join(' ');

    if (!buildingQuery || !taskName || !durationStr) {
        return { response: '❌ Неверный формат. Пример: `Печь Макароны 10м`', style: 'output-error' };
    }

    return await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, durationStr, 'add');
}

// 2. Удаление задачи: Del task (строго в 2 этапа)
async function handleDeleteTask(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

    const rawArgs = parameters.args || [];
    const cleanWords = rawArgs.filter(w => !['del', 'delete', 'remove', 'task', 'tasks', 'задача', 'задачи', 'завдання', 'удалить', 'удали', 'видалити', 'rm', 'из', 'в', 'з'].includes(w.toLowerCase()));

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
            const targetBuilding = buildings.find(b => b.building_name.toLowerCase().includes(buildingQuery.toLowerCase()));
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

        if (action === 'add') {
            const durationSeconds = parseTaskDuration(durationStr);

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

                await window.supabaseClient
                    .from('timer_templates')
                    .upsert([{
                        name: taskName,
                        duration_seconds: durationSeconds,
                        created_by: userId
                    }], { onConflict: 'name,created_by' });
            }

            return { response: `🟢 Задача "${taskName}" (${durationStr}) успешно закреплена за постройкой "${buildings[0].building_name}" (Очередь #${buildings[0].queue_group_id})!`, style: 'output-success' };
        } else if (action === 'del') {
            for (const building of buildings) {
                let tasks = building.tasks || [];
                tasks = tasks.filter(t => t.name.toLowerCase() !== taskName.toLowerCase());

                const { error: updateErr } = await window.supabaseClient
                    .from('terminal_buildings')
                    .update({ tasks: tasks, updated_at: new Date().toISOString() })
                    .eq('id', building.id);

                if (updateErr) throw updateErr;
            }

            return { response: `🗑️ Задача "${taskName}" удалена из постройки "${buildingQuery}".`, style: 'output-success' };
        }
    } catch (err) {
        return { response: '❌ Ошибка: ' + err.message, style: 'output-error' };
    }
}

CommandRegistry.register({
    names: ['add task', 'create task', 'task add', 'tasks add', 'добавить задачу', 'создать задачу', 'додати завдання', 'створити завдання'],
    description: 'Закрепить задачу за постройкой с указанием времени (строго в 2 этапа)',
    usage: 'add task -> <Постройка> <Задача> <Время>',
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
