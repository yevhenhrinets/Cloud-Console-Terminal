// commands/note_history.js — просмотр истории версий (логов) конкретной заметки

CommandRegistry.register({
    names: ['note history', 'история заметки', 'історія нотатки', 'logs'],
    
    description: 'Show edition history of 1 note by id',
    category: 'CRUD',
    usage: 'Note history [id] | logs [id]',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const ids = extractNumericIds(parameters.args);
        if (ids.length === 0) {
            return { response: '❌ Укажите ID заметки для просмотра истории (например: `note history 2` или `logs 2`)', style: 'output-error' };
        }

        const targetInnerId = ids[0];
        const isAdmin = ['root', 'support'].includes(currentUser.role);

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
            return { response: '📡 Офлайн-режим: история версий заметки доступна при подключении к интернету.', style: 'output-info' };
        }

        try {
            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .eq('inner_id', targetInnerId)
                .order('version', { ascending: true }); // От первой версии к последней

            if (!isAdmin) {
                query = query.eq('created_by', currentUser.id);
            }

            const { data: versions, error } = await query;
            if (error) throw error;

            if (!versions || versions.length === 0) {
                return { response: `❌ История для заметки [${targetInnerId}] не найдена.`, style: 'output-error' };
            }

            const response = `📜 История изменений заметки [ID: ${targetInnerId}]:\n` +
                versions.map(v => {
                    const timeStr = formatDate(v.updated_at || v.created_at);
                    const statusMark = v.version === versions.length ? ' ⭐ (актуальная)' : '';
                    return `  • [v${v.version}] [${timeStr}] ${v.content}${statusMark}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка получения истории заметки: ' + err.message, style: 'output-error' };
        }
    }
});


