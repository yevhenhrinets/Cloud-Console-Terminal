// commands/del.js — мягкое удаление заметок и истории (строго в 2 этапа для всех параметров)

CommandRegistry.register({
    names: [
        'del', 'delete', 'удалить', 'видалити', 'rm',
        'del note', 'del the note', 'del notes', 'del the notes', 'del note number', 'del the note number',
        'delete note', 'delete the note', 'delete notes', 'delete the notes', 'delete note number', 'delete the note number',
        'rm note', 'rm notes', 'удалить заметку', 'видалити нотатку',
        'del history', 'del the history', 'delete history', 'delete the history', 'del history number',
        'rm history', 'удалить историю', 'видалити історію'
    ],

    description: 'Удаление заметок или истории по ID (строго в 2 этапа)',
    category: 'CRUD',
    usage: 'del -> <id> | del note -> <id> | del history -> <id>',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'del').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const argsLower = (parameters.args || []).map(a => String(a).toLowerCase());

        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, '6');
            }
            const isHistPrompt = matchedCmd.includes('history') || matchedCmd.includes('истор') || matchedCmd.includes('істор');
            return {
                response: `🗑️ Режим удаления (${isHistPrompt ? 'истории' : 'заметок'}) активирован. Введите ID (напр: 6, 1 2 или last) и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: isHistPrompt ? 'ID записи истории (напр: 5 или last)...' : 'ID заметки (напр: 6, 1 2 или last)...'
            };
        }

        const targetUserId = parseTargetUser(parameters.args || []);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        if (['building', 'buildings', 'постройка', 'постройки', 'будівля', 'споруда'].includes(argsLower[0])) {
            const delBuildingHandler = window.CommandRegistry.getHandler('del building');
            if (delBuildingHandler) {
                return await delBuildingHandler(parameters, options);
            }
        }

        if (['task', 'tasks', 'задача', 'задачи', 'завдання'].includes(argsLower[0])) {
            const delTaskHandler = window.CommandRegistry.getHandler('del task');
            if (delTaskHandler) {
                return await delTaskHandler(parameters, options);
            }
        }

        const isHistory = matchedCmd.includes('history') || matchedCmd.includes('истор') || matchedCmd.includes('істор') ||
            argsLower.includes('history') || argsLower.includes('история') || argsLower.includes('історія');
        const tableName = isHistory ? 'commands_history' : 'notes';
        const entityLabel = isHistory ? 'истории' : 'заметки';

        const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));

        let ids = [];
        if (isLastKeyword) {
            try {
                const { data, error } = await window.supabaseClient
                    .from(tableName)
                    .select('inner_id')
                    .eq('created_by', effectiveUserId)
                    .is('deleted_at', null)
                    .order('inner_id', { ascending: false })
                    .limit(1);

                if (error) throw error;
                if (data && data.length > 0) ids = [data[0].inner_id];
            } catch (err) {
                console.error('Ошибка поиска последнего ID:', err);
            }
            if (ids.length === 0 && !isHistory && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
                if (cached.length > 0) {
                    cached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                    ids = [cached[0].inner_id];
                }
            }
        } else {
            const fullArgsStr = (parameters.args || []).join(' ');
            ids = [...new Set(fullArgsStr.match(/\d+/g)?.map(Number).filter(n => Number.isFinite(n) && n > 0) || [])];
        }

        if (ids.length === 0) {
            return {
                response: `❌ Укажите ID (напр: \`6\`, \`1 2\`, \`6th\`) или \`last\`.`,
                style: 'output-error'
            };
        }

        const handleOfflineDelete = () => {
            if (isHistory || !window.OfflineNotesSync) return null;
            const deleted = window.OfflineNotesSync.queueDeleteNotesOffline(effectiveUserId, ids);
            if (deleted.length === 0) {
                return { response: `❌ Заметки [ID: ${ids.join(', ')}] не найдены в оффлайн-кэше.`, style: 'output-error' };
            }
            return {
                response: `🟢 Заметки [ID: ${deleted.join(', ')}] удалены локально (отправятся в БД при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        };

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
            const offRes = handleOfflineDelete();
            if (offRes) return offRes;
            return { response: '📡 Удаление записей истории недоступно без сети.', style: 'output-error' };
        }

        try {
            const { error } = await window.supabaseClient
                .from(tableName)
                .update({ deleted_at: new Date().toISOString() })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId);

            if (error) throw error;

            if (!isHistory && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId);
                cached.forEach(n => {
                    if (ids.includes(Number(n.inner_id))) n.deleted_at = new Date().toISOString();
                });
                window.OfflineNotesSync.saveNotesCache(effectiveUserId, cached);
            }

            const idsStr = ids.join(', ');
            return {
                response: `🟢 ${entityLabel === 'истории' ? 'Записи истории' : 'Заметки'} [ID: ${idsStr}] успешно удалены.`,
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note',
                undoAction: !isHistory ? {
                    type: 'supabase_restore_notes_deleted',
                    innerIds: ids,
                    restoreToDeletedAt: null,
                    description: `удаление заметок [${idsStr}]`
                } : undefined
            };
        } catch (err) {
            if (!isHistory && window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const offRes = handleOfflineDelete();
                if (offRes) return offRes;
            }
            return { response: '❌ Ошибка удаления: ' + err.message, style: 'output-error' };
        }
    }
});
