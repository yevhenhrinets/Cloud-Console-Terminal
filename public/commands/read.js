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

        const readCachedNote = () => {
            if (!window.OfflineNotesSync) return null;
            const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
            return cached.find(n => Number(n.inner_id) === Number(targetId)) || null;
        };

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            const note = readCachedNote();
            if (!note) return { response: `❌ Заметка с ID [${targetId}] не найдена в оффлайн-кэше.`, style: 'output-error' };
            const pinMark = note.is_pinned ? ' 📌 (закреплена)' : '';
            const timeStr = formatDate(note.updated_at || note.created_at);
            const versionStr = (note.version && note.version > 1) ? ` (версия v${note.version})` : '';
            return {
                response: `📄 Заметка [ID: ${note.inner_id}]${versionStr}${pinMark} (📡 Офлайн):\nСоздана: ${timeStr}\n\n${note.content}`,
                style: 'output-info'
            };
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
            if (window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const note = readCachedNote();
                if (note) {
                    const pinMark = note.is_pinned ? ' 📌 (закреплена)' : '';
                    const timeStr = formatDate(note.updated_at || note.created_at);
                    return {
                        response: `📄 Заметка [ID: ${note.inner_id}]${pinMark} (📡 Офлайн-кэш):\nСоздана: ${timeStr}\n\n${note.content}`,
                        style: 'output-info'
                    };
                }
            }
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

    if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
        const localActions = typeof window.getLocalActionsHistory === 'function' ? window.getLocalActionsHistory() : [];
        const found = localActions.find(a => Number(a.inner_id || a.id) === Number(targetId)) || localActions[Number(targetId) - 1];
        if (!found) {
            return { response: `📡 Офлайн-режим: запись истории [${targetId}] не найдена локально.`, style: 'output-info' };
        }
        const timeStr = formatDate(found.created_at);
        const statusMark = found.status === 'failure' ? ' ❌' : ' ✔️';
        const outputText = found.output ? `\n\n[Результат]:\n${found.output}` : '';
        return {
            response: `📜 Локальная история [${targetId}] [${timeStr}]:\nКоманда: ${found.raw_text || found.command}${statusMark}${outputText}`,
            style: 'output-info'
        };
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
