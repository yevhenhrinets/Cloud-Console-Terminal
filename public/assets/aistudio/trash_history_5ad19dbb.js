// commands/trash_history.js — просмотр удаленной истории команд (корзина)

CommandRegistry.register({
    names: ['history trash', 'корзина истории', 'видалена історія'],
    
    description: 'History trash',
    category: 'History',
    usage: 'History trash',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const targetUserId = parseTargetUser(parameters.args);

        try {
            let query = window.supabaseClient
                .from('commands_history')
                .select('*')
                .not('deleted_at', 'is', null); // Берем только удаленные записи истории

            if (['root', 'support'].includes(currentUser.role)) {
                if (targetUserId) {
                    query = query.eq('created_by', targetUserId);
                }
            } else {
                query = query.eq('created_by', currentUser.id);
            }

            const { data, error } = await query.order('deleted_at', { ascending: false }).limit(20);
            if (error) throw error;

            if (!data || data.length === 0) {
                return { response: '🗑️ Корзина истории пуста.', style: 'output-info' };
            }
            
            // 🧠 ГРУППИРУЕМ ПО inner_id И ОСТАВЛЯЕМ ТОЛЬКО ПОСЛЕДНЮЮ ВЕРСИЮ
            const deletedHistoryMap = new Map();
            data.forEach(history => {
                // Если такого inner_id еще нет в карте или версия текущей заметки выше — обновляем
                if (!deletedHistoryMap.has(history.inner_id) || history.version > deletedHistoryMap.get(history.inner_id).version) {
                    deletedHistoryMap.set(history.inner_id, history);
                }
            });
        
            // Превращаем карту обратно в массив и сортируем по inner_id (или дате) от новых к старым
            const removedHistory = Array.from(latestHistoryMap.values()).sort((a, b) => b.inner_id - a.inner_id);
            
            const response = "🗑️ Корзина истории (удаленные):\n" +
                removedHistory.map(row => {
                    const timeStr = row.deleted_at ? formatDate(row.deleted_at) : 'неизвестно';
                    const cmdDisplay = row.raw_text || `${row.command} ${row.parameters?.raw_args || ''}`.trim();
                    return `[ID: ${row.id}] [удалено: ${timeStr}] ${cmdDisplay}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки корзины истории: ' + err.message, style: 'output-error' };
        }
    }
});


