// commands/show.js — списки и обзоры (show notes, show history)

CommandRegistry.register({
    names: ['show notes', 'notes', 'заметки', 'нотатки'],
    
    description: 'Notes showing',
    category: 'CRUD',
    usage: 'Show note [note_id] | show notes',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        try {
            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .is('deleted_at', null)
                .eq('created_by', effectiveUserId);

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            if (!data || data.length === 0) {
                return { response: 'Список заметок пуст.', style: 'output-info' };
            }

            // Группируем по inner_id и оставляем только самую последнюю версию
            const latestNotesMap = new Map();
            data.forEach(note => {
                if (!latestNotesMap.has(note.inner_id) || note.version > latestNotesMap.get(note.inner_id).version) {
                    latestNotesMap.set(note.inner_id, note);
                }
            });
            
            // новые - в конце - чтоюы сразу их видеть, после автоматического скролла вниз к полю ввода
            const activeNotes = Array.from(latestNotesMap.values()).sort((a, b) => b.inner_id - a.inner_id);
            
            const response = "Ваши активные заметки:\n" + 
                activeNotes.map(row => {
                    const pinMark = row.is_pinned ? ' 📌' : '';
                    const timeStr = formatDate(row.updated_at || row.created_at);
                    const versionStr = row.version > 1 ? ` (v${row.version})` : '';
                    return `[ID: ${row.inner_id}] [${timeStr}]${versionStr} ${row.content}${pinMark}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки заметок: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['show history', 'history', 'история', 'історія'],
    
    description: 'Showing history',
    category: 'CRUD',
    usage: 'Show history',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        // Если пользователь передал ID в команде history (например, "history 5" или "history last"), 
        // перенаправляем на логику чтения конкретной истории
        const hasIdOrLast = parameters.args.length > 0 && (extractNumericIds(parameters.args).length > 0 || parameters.args.some(a => ['last', 'последняя', 'остання'].includes(a.toLowerCase())));
        if (hasIdOrLast) {
            // Передаем управление логике чтения из read.js через вызов обработчика или дублированием безопасного поиска
            // Но проще сделать вызов глобальной функции или обработать здесь:
            return await readHistoryHandler(parameters, currentUser);
        }

        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        try {
            let query = window.supabaseClient
                .from('commands_history')
                .select('inner_id, raw_text, command, parameters, created_at, updated_at, status, output, created_by')
                .is('deleted_at', null)
                .eq('created_by', effectiveUserId);

            const { data, error } = await query.order('created_at', { ascending: false }).limit(10);
            if (error) throw error;

            if (!data || data.length === 0) {
                return { response: 'История команд пуста.', style: 'output-info' };
            }

            const response = "Последние команды из облака:\n" + 
                data.map(row => {
                    const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                    const cmdDisplay = row.raw_text || `${row.command}`;
                    const statusMark = row.status === 'failure' ? ' ❌' : ' ✔️';
                    const firstLineOutput = row.output ? ' ➔ ' + row.output.split('\n')[0] : '';
                    return `[ID: ${row.inner_id}] [${timeStr}] ${cmdDisplay}${statusMark}${firstLineOutput}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки истории: ' + err.message, style: 'output-error' };
        }
    }
});
