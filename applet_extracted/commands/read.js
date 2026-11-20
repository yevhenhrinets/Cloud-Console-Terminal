// commands/read.js — чтение конкретных объектов по ID (note [ID], history [ID])

CommandRegistry.register({
    names: ['read note', 'note', 'заметка', 'нотатка'],
    
    description: 'Reading notes or history',
    category: 'CRUD',
    usage: 'Read note [id] | read history [id]',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        const targetId = await resolveTargetId(parameters.args, 'notes', effectiveUserId);
        if (!targetId) {
            return { response: '❌ Укажите ID заметки (например: `note 3` или `note last`)', style: 'output-error' };
        }

        try {
            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .eq('inner_id', targetId)
                .eq('created_by', effectiveUserId)
                .is('deleted_at', null)
                .order('version', { ascending: false })
                .limit(1);

            const { data, error } = await query;
            if (error) throw error;

            if (!data || data.length === 0) {
                return { response: `❌ Заметка с ID [${targetId}] не найдена.`, style: 'output-error' };
            }

            const note = data[0];
            const pinMark = note.is_pinned ? ' 📌 (закреплена)' : '';
            const timeStr = formatDate(note.updated_at || note.created_at);
            const versionStr = note.version > 1 ? ` (версия v${note.version})` : '';

            const response = `📄 Заметка [ID: ${note.inner_id}]${versionStr}${pinMark}:\n` +
                `Создана: ${timeStr}\n\n${note.content}`;

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка чтения заметки: ' + err.message, style: 'output-error' };
        }
    }
});

// Вспомогательный обработчик детального чтения истории (вызывается из show.js при наличии ID)
async function readHistoryHandler(parameters, currentUser) {
    const targetUserId = parseTargetUser(parameters.args);
    const isAdmin = ['root', 'support'].includes(currentUser.role);
    const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

    const targetId = await resolveTargetId(parameters.args, 'commands_history', effectiveUserId);
    if (!targetId) {
        return { response: '❌ Укажите ID истории (например: `history 5` или `history last`)', style: 'output-error' };
    }

    try {
        let query = window.supabaseClient
            .from('commands_history')
            .select('*')
            .eq('inner_id', targetId)
            .eq('created_by', effectiveUserId)
            .is('deleted_at', null)
            .order('version', { ascending: false })
            .limit(1);

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            return { response: `❌ Запись истории с ID [${targetId}] не найдена.`, style: 'output-error' };
        }

        const row = data[0];
        const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
        const cmdDisplay = row.raw_text || row.command;
        const statusMark = row.status === 'failure' ? ' ❌ (ошибка)' : ' ✔️ (успешно)';
        const outputText = row.output ? `\n\n[Результат]:\n${row.output}` : '';

        const response = `📜 Детали истории [ID: ${row.inner_id}] [${timeStr}]:\n` +
            `Команда: ${cmdDisplay}${statusMark}${outputText}`;

        return { response, style: 'output-info' };
    } catch (err) {
        return { response: '❌ Ошибка чтения истории: ' + err.message, style: 'output-error' };
    }
}

// Регистрируем альтернативные синонимы чтения истории
CommandRegistry.register({
    names: ['read history', 'читать историю', 'читати історію'],
    
    description: 'Reading (for ex. note(s) or history)',
    category: 'CRUD',
    usage: 'Read history',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };
        return await readHistoryHandler(parameters, currentUser);
    }
});
