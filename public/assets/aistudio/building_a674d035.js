// commands/building.js — естественный язык для управления постройками

// Регистрация команд для работы с постройками (Show / Add / Del building)
CommandRegistry.register({
    names: ['building', 'buildings', 'здание', 'постройка', 'постройки', 'будівля'],
    description: 'Управление постройками (Add building, Show buildings, Del building)',
    usage: 'Add building Печь | Show buildings | Del building Печь',
    category: '🏭 Постройки',
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        const rawArgs = parameters.args;
        const fullText = rawArgs.join(' ').toLowerCase();

        // 1.1 ПОКАЗАТЬ ВСЕ ПОСТРОЙКИ (show / покажи / список)
        if (fullText.includes('show') || fullText.includes('покаж') || fullText.includes('список') || rawArgs.length === 0) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('terminal_buildings')
                    .select('*')
                    .eq('created_by', currentUser.id)
                    .order('queue_group_id', { ascending: true });

                if (error) throw error;
                if (!data || data.length === 0) {
                    return { response: '🏭 У вас пока нет построек. Создайте первую: `Add building Печь`', style: 'output-info' };
                }

                let response = '🏭 Ваши постройки:\n';
                data.forEach(b => {
                    response += `\n[Очередь #${b.queue_group_id}] **${b.building_name}**\n`;
                    if (b.tasks && b.tasks.length > 0) {
                        b.tasks.forEach(t => {
                            response += `  └─ ${t.name} (${t.duration} сек)\n`;
                        });
                    } else {
                        response += `  └─ (нет задач — добавьте: \`Add task ${b.building_name} Имя Время\`)\n`;
                    }
                });

                return { response, style: 'output-info', isHtml: true };
            } catch (err) {
                return { response: '❌ Ошибка загрузки: ' + err.message, style: 'output-error' };
            }
        }

        // 1.2 УДАЛЕНИЕ ПОСТРОЙКИ (del / delete / удалить / удали / видалити)
        const isDelete = rawArgs.some(w => ['del', 'delete', 'удалить', 'удали', 'видалити', 'rm'].includes(w.toLowerCase()));
        if (isDelete) {
            const buildingName = rawArgs.filter(w => !['building', 'buildings', 'здание', 'постройка', 'постройки', 'del', 'delete', 'удалить', 'удали', 'видалити', 'rm'].includes(w.toLowerCase())).join(' ');
            if (!buildingName) {
                return { response: '❌ Укажите название постройки для удаления.\nПример: `Del building Печь`', style: 'output-error' };
            }

            try {
                const { error } = await window.supabaseClient
                    .from('terminal_buildings')
                    .delete()
                    .eq('created_by', currentUser.id)
                    .ilike('building_name', buildingName);

                if (error) throw error;
                return { response: `🗑️ Постройка "${buildingName}" удалена.`, style: 'output-success' };
            } catch (err) {
                return { response: '❌ Ошибка удаления: ' + err.message, style: 'output-error' };
            }
        }

        // 1.3 ДОБАВЛЕНИЕ ПОСТРОЙКИ (add building ... / создай постройку ...)
        const buildingName = rawArgs.filter(w => !['add', 'building', 'buildings', 'здание', 'постройка', 'постройки', 'будівля', 'добавить', 'создай', 'створи', 'додай'].includes(w.toLowerCase())).join(' ');
        
        if (!buildingName) {
            return { response: '❌ Укажите название постройки. Пример: `Add building Печь`', style: 'output-error' };
        }

        try {
            // Автоматически определяем следующий свободный queue_group_id
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

            const { error } = await window.supabaseClient
                .from('terminal_buildings')
                .insert([{
                    building_key: buildingName.toLowerCase().replace(/[^a-z0-9а-яєіїё]/g, '_'),
                    building_name: buildingName,
                    queue_group_id: nextId,
                    tasks: [],
                    created_by: currentUser.id
                }]);

            if (error) throw error;
            return { response: `🟢 Постройка "${buildingName}" успешно создана (очередь #${nextId})!`, style: 'output-success' };
        } catch (err) {
            return { response: '❌ Ошибка создания постройки: ' + err.message, style: 'output-error' };
        }
    }
});
