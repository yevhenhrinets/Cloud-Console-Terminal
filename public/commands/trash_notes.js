// commands/trash_notes.js — просмотр удаленных заметок (корзина)

CommandRegistry.register({
    names: ['notes trash', 'show trash', 'show trash of notes', 'trash of notes', 'show notes trash', 'trash notes', 'trash', 'корзина заметок', 'видалені нотатки', 'lost notes'],
    
    description: 'Notes trash',
    category: 'Notes',
    usage: 'Show trash | Show trash of notes | Notes trash',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const targetUserId = parseTargetUser(parameters.args);

        try {
            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .not('deleted_at', 'is', null); // Берем только то, что помечено как удаленное

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
                return { response: '🗑️ Корзина заметок пуста.', style: 'output-info' };
            }
            
            // 🧠 ГРУППИРУЕМ ПО inner_id И ОСТАВЛЯЕМ ТОЛЬКО ПОСЛЕДНЮЮ ВЕРСИЮ
            const deletedNotesMap = new Map();
            data.forEach(note => {
                // Если такого inner_id еще нет в карте или версия текущей заметки выше — обновляем
                if (!deletedNotesMap.has(note.inner_id) || note.version > deletedNotesMap.get(note.inner_id).version) {
                    deletedNotesMap.set(note.inner_id, note);
                }
            });

            // Превращаем карту обратно в массив и сортируем по inner_id (или дате) от новых к старым
            const removedNotes = Array.from(deletedNotesMap.values()).sort((a, b) => b.inner_id - a.inner_id);

            const response = "🗑️ Корзина заметок (удаленные):\n" +
                removedNotes.map(row => {
                    const timeStr = row.deleted_at ? formatDate(row.deleted_at) : 'неизвестно';
                    return `[ID: ${row.inner_id}] [удалено: ${timeStr}] ${row.content}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки корзины заметок: ' + err.message, style: 'output-error' };
        }
    }
});


