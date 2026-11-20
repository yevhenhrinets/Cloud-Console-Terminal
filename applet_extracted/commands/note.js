
CommandRegistry.register({
    names: ['note', 'show note', 'show single note', 'id'],
    
    description: 'Show 1 note by id',
    category: 'CRUD',
    usage: 'Note [id] | show note [id1] | show last note',
    
    handler: async (parameters) => {
        // Поддержка note id 10 / show note 10 / id 10
        const ids = extractNumericIds(parameters.args);
        if (!isNaN(parameters.args[0])) ids.unshift(Number(parameters.args[0]));

        if (ids.length === 0) {
            return { response: 'Ошибка: укажите ID заметки. Пример: note id 10', style: 'output-error' };
        }

        try {
            const { data, error } = await window.supabaseClient
                .from('notes')
                .select('*')
                .eq('inner_id', ids[0])
                .is('deleted_at', null)
                .maybeSingle();

            if (error) throw error;
            if (!data) {
                return { response: `Заметка с ID [${ids[0]}] не найдена или удалена.`, style: 'output-error' };
            }

            const timeStr = data.updated_at ? `ред: ${formatDate(data.updated_at)}` : formatDate(data.created_at);
            const pinMark = data.is_pinned ? '📌 ' : '';
            return { response: `Просмотр заметки [ID: ${data.inner_id}]:\n${pinMark}[${timeStr}] ${data.content}`, style: 'output-info' };
        } catch (err) {
            return { response: 'Ошибка поиска заметки: ' + err.message, style: 'output-error' };
        }
    }
});


