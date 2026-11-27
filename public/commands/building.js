const DEMO_BUILDINGS_KEY = 'terminal_demo_buildings_store';

function getDemoBuildings() {
    let saved = localStorage.getItem(DEMO_BUILDINGS_KEY);
    if (!saved) {
        const initial = [
            { queue_group_id: 1, building_name: 'Печь', tasks: [{ name: 'Выплавка железа', duration: 180 }, { name: 'Закалка стали', duration: 300 }] },
            { queue_group_id: 2, building_name: 'Лесопилка', tasks: [{ name: 'Распил дуба', duration: 120 }] },
            { queue_group_id: 3, building_name: 'Кухня', tasks: [{ name: 'Приготовление супа', duration: 60 }] }
        ];
        localStorage.setItem(DEMO_BUILDINGS_KEY, JSON.stringify(initial));
        return initial;
    }
    try {
        return JSON.parse(saved);
    } catch (e) {
        return [];
    }
}

function saveDemoBuildings(b) {
    localStorage.setItem(DEMO_BUILDINGS_KEY, JSON.stringify(b));
}

// 1. Создание постройки (Add building — строго в 2 этапа)
async function handleAddBuilding(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: 'Помилка: користувач не визначений.', style: 'output-error' };

    const rawArgs = parameters.args || [];
    const cleanWords = rawArgs.filter(w => !['add', 'create', 'building', 'buildings', 'здание', 'постройка', 'постройки', 'будівля', 'споруда', 'добавить', 'создай', 'создать', 'створи', 'створити', 'додай', 'додати'].includes(w.toLowerCase()));
    const buildingName = cleanWords.join(' ').trim();
    const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'add building';

    if (buildingName && !(options && options.fromTwoStepBar)) {
        return rejectInlineParamsError(prefix, 'Печь');
    }

    if (!buildingName) {
        return {
            response: '🏭 Режим создания постройки активирован. Введите название постройки и нажмите Enter (или ✕ для отмены).',
            style: 'output-info',
            commandPrefix: 'add building',
            inputValue: '',
            inputPlaceholder: 'Введите название новой постройки...'
        };
    }

    if (currentUser.isGuest) {
        const buildings = getDemoBuildings();
        const exists = buildings.some(b => b.building_name.toLowerCase() === buildingName.toLowerCase());
        if (exists) {
            return { response: `⚠️ Постройка "${buildingName}" уже существует.`, style: 'output-error' };
        }
        const usedIds = buildings.map(b => Number(b.queue_group_id) || 0);
        let nextId = 1;
        while (usedIds.includes(nextId)) nextId++;
        buildings.push({
            queue_group_id: nextId,
            building_name: buildingName,
            tasks: []
        });
        saveDemoBuildings(buildings);
        return { response: `🟢 Постройка "${buildingName}" успешно создана (Демо/Offline, очередь #${nextId})!`, style: 'output-success' };
    }

    try {
        const { data: existing, error: fetchErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('queue_group_id')
            .eq('created_by', currentUser.id);

        if (fetchErr) throw fetchErr;

        const usedIds = existing ? existing.map(e => e.queue_group_id) : [];
        let nextId = 1;
        while (usedIds.includes(nextId)) {
            nextId++;
        }

        const { data: insertedRows, error } = await window.supabaseClient
            .from('terminal_buildings')
            .insert([{
                building_key: buildingName.toLowerCase().replace(/[^a-z0-9а-яєіїё]/g, '_'),
                building_name: buildingName,
                queue_group_id: nextId,
                tasks: [],
                created_by: currentUser.id
            }])
            .select('*');

        if (error) throw error;
        const createdBuilding = insertedRows && insertedRows[0] ? insertedRows[0] : null;
        return {
            response: `🟢 Постройка "${buildingName}" успешно создана (очередь #${nextId})!`,
            style: 'output-success',
            undoAction: createdBuilding ? {
                type: 'supabase_delete_building',
                buildingId: createdBuilding.id,
                description: `создание постройки "${buildingName}"`
            } : undefined
        };
    } catch (err) {
        return { response: '❌ Ошибка создания постройки: ' + err.message, style: 'output-error' };
    }
}

// 2. Список построек (Show buildings)
async function handleShowBuildings(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: 'Помилка: користувач не визначений.', style: 'output-error' };

    const rawArgsStr = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
    if (!(options && options.fromTwoStepBar) && rawArgsStr) {
        return rejectInlineParamsError(parameters.matchedCmd || 'show buildings', '');
    }

    if (currentUser.isGuest) {
        const buildings = getDemoBuildings();
        let response = '🏭 Ваши постройки (Демо/Offline):\n';
        buildings.forEach(b => {
            response += `\n[Очередь #${b.queue_group_id}] **${b.building_name}**\n`;
            if (b.tasks && b.tasks.length > 0) {
                b.tasks.forEach(t => {
                    response += `  └─ ${t.name} (${t.duration} сек)\n`;
                });
            } else {
                response += `  └─ (нет задач — добавьте через \`add task\` в 2 этапа)\n`;
            }
        });
        return { response, style: 'output-info', isHtml: true };
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', currentUser.id)
            .order('queue_group_id', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) {
            return { response: '🏭 У вас пока нет построек. Создайте первую: `add building` (в 2 этапа).', style: 'output-info' };
        }

        let response = '🏭 Ваши постройки:\n';
        data.forEach(b => {
            response += `\n[Очередь #${b.queue_group_id}] **${b.building_name}**\n`;
            if (b.tasks && b.tasks.length > 0) {
                b.tasks.forEach(t => {
                    response += `  └─ ${t.name} (${t.duration} сек)\n`;
                });
            } else {
                response += `  └─ (нет задач — добавьте через \`add task\` в 2 этапа)\n`;
            }
        });

        return { response, style: 'output-info', isHtml: true };
    } catch (err) {
        return { response: '❌ Ошибка загрузки: ' + err.message, style: 'output-error' };
    }
}

// 3. Удаление постройки (Del building — строго в 2 этапа)
async function handleDeleteBuilding(parameters, options = {}) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) return { response: 'Помилка: користувач не визначений.', style: 'output-error' };

    const rawArgs = parameters.args || [];
    const cleanWords = rawArgs.filter(w => !['del', 'delete', 'remove', 'building', 'buildings', 'здание', 'постройка', 'постройки', 'будівля', 'споруда', 'удалить', 'удали', 'видалити', 'rm'].includes(w.toLowerCase()));
    const buildingName = cleanWords.join(' ').trim();
    const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'del building';

    if (!(options && options.fromTwoStepBar)) {
        if (buildingName) {
            return rejectInlineParamsError('del building', 'Печь');
        }
        return {
            response: `🗑️ Режим удаления постройки (\`${prefix}\`) активирован. Введите название постройки и нажмите Enter (или ✕ для отмены).`,
            style: 'output-info',
            commandPrefix: 'del building',
            inputValue: '',
            inputPlaceholder: 'Введите название постройки для удаления...'
        };
    }

    if (!buildingName) {
        return {
            response: '❌ Укажите название постройки для удаления (например: `Печь`).',
            style: 'output-error'
        };
    }

    if (currentUser.isGuest) {
        let buildings = getDemoBuildings();
        const initialLen = buildings.length;
        buildings = buildings.filter(b => b.building_name.toLowerCase() !== buildingName.toLowerCase());
        if (buildings.length === initialLen) {
            return { response: `❌ Постройка "${buildingName}" не найдена.`, style: 'output-error' };
        }
        saveDemoBuildings(buildings);
        return { response: `🗑️ Постройка "${buildingName}" удалена (Демо/Offline).`, style: 'output-success' };
    }

    try {
        const { data: existingRows, error: selectErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', currentUser.id)
            .ilike('building_name', buildingName);

        if (selectErr) throw selectErr;
        if (!existingRows || existingRows.length === 0) {
            return { response: `❌ Постройка "${buildingName}" не найдена.`, style: 'output-error' };
        }

        const { error } = await window.supabaseClient
            .from('terminal_buildings')
            .delete()
            .eq('created_by', currentUser.id)
            .ilike('building_name', buildingName);

        if (error) throw error;
        return {
            response: `🗑️ Постройка "${buildingName}" удалена.`,
            style: 'output-success',
            undoAction: {
                type: 'supabase_restore_building',
                buildings: existingRows,
                description: `удаление постройки "${buildingName}"`
            }
        };
    } catch (err) {
        return { response: '❌ Ошибка удаления: ' + err.message, style: 'output-error' };
    }
}

CommandRegistry.register({
    names: ['add building', 'create building', 'building add', 'buildings add', 'добавить постройку', 'создать постройку', 'додати будівлю', 'створити споруду'],
    description: 'Создать новую постройку (строго в 2 этапа)',
    category: '🏭 Постройки',
    usage: 'add building -> <Название>',
    handler: handleAddBuilding
});

CommandRegistry.register({
    names: ['show buildings', 'list buildings', 'building show', 'buildings show', 'buildings', 'building', 'постройки', 'постройка', 'здания', 'споруди', 'будівлі', 'показать постройки', 'список построек', 'показати споруди'],
    description: 'Список построек и закрепленных за ними задач',
    category: '🏭 Постройки',
    usage: 'show buildings | list buildings',
    handler: async (parameters, options = {}) => {
        const fullText = (parameters.args || []).join(' ').toLowerCase();
        if (fullText.includes('add') || fullText.includes('добавить') || fullText.includes('создай')) {
            return await handleAddBuilding(parameters, options);
        }
        if (fullText.includes('del') || fullText.includes('delete') || fullText.includes('удалить') || fullText.includes('rm')) {
            return await handleDeleteBuilding(parameters, options);
        }
        return await handleShowBuildings(parameters, options);
    }
});

CommandRegistry.register({
    names: ['del building', 'delete building', 'remove building', 'building del', 'buildings del', 'building delete', 'удалить постройку', 'видалити будівлю'],
    description: 'Удалить постройку (строго в 2 этапа)',
    category: '🏭 Постройки',
    usage: 'del building -> <Название>',
    handler: handleDeleteBuilding
});

// 4. Команда выбора постройки / техники (строго в 2 этапа: select -> 1 | Печь)
CommandRegistry.register({
    names: ['select', 'выбрать', 'обрати', 'select building', 'выбрать постройку'],
    description: 'Выбор постройки и переход к ней на дашборде (строго в 2 этапа)',
    category: '🏭 Постройки',
    usage: 'select -> <номер или название>',
    handler: async (parameters, options = {}) => {
        const matchedCmd = String((parameters && parameters.matchedCmd) || 'select').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, '1');
            }
            return {
                response: `🏭 Режим выбора постройки (\`${matchedCmd}\`) активирован. Введите номер очереди (напр: 1, 7) или название (напр: Печь) и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: 'Номер очереди или название (напр: 1 или Печь)...'
            };
        }

        const argsStr = (parameters.args || []).join(' ').trim();
        if (!argsStr) {
            return { response: '❌ Укажите номер очереди (напр: `1`) или название постройки (напр: `Печь`).', style: 'output-error' };
        }

        const numbers = argsStr.match(/\d+/g);
        let queueId = numbers ? parseInt(numbers[numbers.length - 1], 10) : null;

        if (!queueId) {
            const lower = argsStr.toLowerCase();
            if (lower.includes('печь') || lower.includes('плит')) queueId = 1;
            else if (lower.includes('лесопил')) queueId = 2;
            else if (lower.includes('стирал') || lower.includes('машин')) queueId = 3;
            else if (lower.includes('кресл')) queueId = 4;
            else if (lower.includes('телевизор') || lower.includes('тв')) queueId = 6;
            else if (lower.includes('стол')) queueId = 7;
            else if (lower.includes('мультивар')) queueId = 8;
            else if (lower.includes('роутер') || lower.includes('вайфай')) queueId = 10;
        }

        if (!queueId) queueId = 1;

        if (options && options.skipRedirect) {
            return {
                response: `🆕 Открываю постройку [Очередь #${queueId}] в дашборде (/dashboard.html?queue=${queueId}).`,
                style: 'output-info'
            };
        }

        setTimeout(() => {
            window.location.href = `/dashboard.html?queue=${queueId}`;
        }, 250);

        return {
            response: `🚀 Открыта постройка [Очередь #${queueId}]. Переход в дашборд...`,
            style: 'output-info'
        };
    }
});
