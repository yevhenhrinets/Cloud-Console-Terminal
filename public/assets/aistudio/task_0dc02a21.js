// commands/task.js — защищенный обработчик задач с автосозданием таймера при запуске

CommandRegistry.register({
    names: ['task', 'tasks', 'задача', 'задачи', 'завдання'],
    description: 'Управление задачами в постройках (Add task, Del task)',
    usage: 'Add task Печь Жареные яйца 5м | Del task Печь Жареные яйца',
    category: '🏭 Постройки',
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        const rawArgs = parameters.args;

        // 1. УДАЛЕНИЕ ЗАДАЧИ: Del task Печь Жареные яйца
        const isDelete = rawArgs.some(w => ['del', 'delete', 'удалить', 'удали', 'видалити', 'rm'].includes(w.toLowerCase()));
        if (isDelete) {
            const cleanWords = rawArgs.filter(w => !['del', 'delete', 'удалить', 'удали', 'видалити', 'rm', 'task', 'tasks', 'задача', 'задачи', 'из', 'в'].includes(w.toLowerCase()));
            const buildingQuery = cleanWords[0];
            const taskName = cleanWords.slice(1).join(' ');

            if (!buildingQuery || !taskName) {
                return { response: '❌ Укажите постройку и задачу для удаления.\nПример: `Del task Печь Жареные яйца`', style: 'output-error' };
            }

            return await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, null, 'del');
        }

        // 2. ДОБАВЛЕНИЕ ЗАДАЧИ: Add task Печь Жареные яйца 5м
        const cleanArgs = rawArgs.filter(w => !['add', 'task', 'tasks', 'задача', 'задачи', 'завдання', 'в', 'на'].includes(w.toLowerCase()));
        
        if (cleanArgs.length < 3) {
            return { response: '❓ Формат команды добавления задачи:\n  • `Add task <Постройка> <Задача> <Время>`\nПример: `Add task Печь Жареные яйца 5м`', style: 'output-error' };
        }

        const buildingQuery = cleanArgs[0];                           
        const durationStr = cleanArgs[cleanArgs.length - 1];          
        const taskName = cleanArgs.slice(1, cleanArgs.length - 1).join(' '); 

        if (!buildingQuery || !taskName || !durationStr) {
            return { response: '❌ Неверный формат. Пример: `Add task Печь Жареные яйца 5м`', style: 'output-error' };
        }

        return await modifyTaskInBuilding(currentUser.id, buildingQuery, taskName, durationStr, 'add');
    }
});

// Безопасная функция привязки задач к конкретной постройке без ложных срабатываний
async function modifyTaskInBuilding(userId, buildingQuery, taskName, durationStr, action) {
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
        // 💡 Точный поиск постройки по ее имени (без случайных совпадений)
        const { data: buildings, error: fetchErr } = await window.supabaseClient
            .from('terminal_buildings')
            .select('*')
            .eq('created_by', userId)
            .ilike('building_name', buildingQuery.trim());

        if (fetchErr) throw fetchErr;
        
        if (!buildings || buildings.length === 0) {
            return { 
                response: `❌ Ошибка: Постройка с именем "${buildingQuery}" не найдена в базе!\nПроверьте точное название через команду \`Show buildings\`.`, 
                style: 'output-error' 
            };
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

                // Обновляем задачи строго у найденной постройки
                const { error: updateErr } = await window.supabaseClient
                    .from('terminal_buildings')
                    .update({ tasks: tasks, updated_at: new Date().toISOString() })
                    .eq('id', building.id);

                if (updateErr) throw updateErr;

                // 💡 Автоматически создаем шаблон таймера, чтобы он не падал с ошибкой "Неизвестный таймер" при запуске очереди
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
