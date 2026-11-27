// commands/unpin.js — массовое открепление заметок (строго в 2 этапа для числовых/ID параметров)

CommandRegistry.register({
    names: [
        'unpin', 'unpin note', 'unpin the note', 'unpin notes', 'unpin the notes', 'unpin note number', 'unpin the note number',
        'unfix', 'unfix note', 'unfix the note', 'unfix notes', 'unfix the notes', 'unfix note number', 'unfix the note number',
        'make unfixed', 'make note unfixed', 'make the note unfixed', 'make notes unfixed', 'make the notes unfixed', 'make last note unfixed',
        'unfasten', 'unfasten note', 'unfasten the note', 'unfasten notes', 'unfasten the notes', 'unfasten note number', 'unfasten the note number',
        'detach', 'detach note', 'detach the note', 'detach notes', 'detach the notes', 'detach note number', 'detach the note number',
        'loosen', 'loosen note', 'loosen the note', 'loosen notes', 'loosen the notes', 'loosen note number', 'loosen the note number',
        'открепить', 'відкріпити'
    ],

    description: 'Открепить заметку(и) по ID (строго в 2 этапа)',
    category: 'Notes',
    usage: 'unpin -> <id> | unfasten the note number -> <id> | detach -> <id> | loosen the note -> <id>',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'unpin').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const argsLower = (parameters.args || []).map(a => String(a).toLowerCase());
        const isPureLastCmd = matchedCmd === 'make last note unfixed';

        // Этап 1: запрещаем любые параметры (включая числа и last) прямо в строке команды
        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, '6');
            }
            if (!isPureLastCmd) {
                return {
                    response: `📌 Режим открепления заметок (\`${matchedCmd}\`) активирован. Введите ID заметки (например: 6, 1 2, 6th или last) и нажмите Enter (или ✕ для отмены).`,
                    style: 'output-info',
                    commandPrefix: matchedCmd,
                    inputValue: '',
                    inputPlaceholder: 'Введите ID заметки (напр: 6, 1 2, 6th или last)...'
                };
            }
        }

        const targetUserId = parseTargetUser(parameters.args || []);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;
        const isOfflineMode = !window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest;

        const isLastKeyword = isPureLastCmd || argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));

        let ids = [];
        if (isLastKeyword) {
            if (!isOfflineMode) {
                try {
                    const { data, error } = await window.supabaseClient
                        .from('notes')
                        .select('inner_id')
                        .eq('created_by', effectiveUserId)
                        .is('deleted_at', null)
                        .order('inner_id', { ascending: false })
                        .limit(1);

                    if (error) throw error;
                    if (data && data.length > 0) ids = [data[0].inner_id];
                } catch (err) {
                    console.error('Ошибка поиска последнего ID для открепления:', err);
                }
            }
            if (ids.length === 0 && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
                if (cached.length > 0) {
                    cached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                    ids = [cached[0].inner_id];
                }
            }
        } else {
            const fullArgsStr = (parameters.args || []).join(' ');
            ids = [...new Set((fullArgsStr.match(/\d+/g) || []).map(Number).filter(n => Number.isFinite(n) && n > 0))];
        }

        if (ids.length === 0) {
            return {
                response: `❌ Укажите ID (напр: \`6\`, \`1 2\`, \`6th\`) или \`last\`.`,
                style: 'output-error'
            };
        }

        const unpinOffline = () => {
            if (!window.OfflineNotesSync) return null;
            const matched = window.OfflineNotesSync.queuePinNotesOffline(effectiveUserId, ids, false);
            if (!matched || matched.length === 0) {
                return { response: `❌ Заметки [ID: ${ids.join(', ')}] не найдены в локальном кэше.`, style: 'output-error' };
            }
            return {
                response: `📌 Заметки [ID: ${matched.join(', ')}] откреплены (📡 Офлайн — синхронизируется при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        };

        if (isOfflineMode) {
            const offlineRes = unpinOffline();
            if (offlineRes) return offlineRes;
        }

        try {
            const { data: prevRows } = await window.supabaseClient
                .from('notes')
                .select('inner_id, is_pinned')
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId)
                .is('deleted_at', null);

            const { error } = await window.supabaseClient
                .from('notes')
                .update({ is_pinned: false })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId)
                .is('deleted_at', null);

            if (error) throw error;

            if (window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId);
                cached.forEach(n => {
                    if (ids.includes(Number(n.inner_id)) && !n.deleted_at) n.is_pinned = false;
                });
                window.OfflineNotesSync.saveNotesCache(effectiveUserId, cached);
            }

            const idsStr = ids.join(', ');
            return {
                response: `📌 Заметки [ID: ${idsStr}] откреплены.`,
                style: 'output-success',
                editedEntity: 'note',
                undoAction: {
                    type: 'supabase_restore_notes_pin',
                    items: (prevRows && prevRows.length ? prevRows : ids.map(id => ({ inner_id: id, is_pinned: true }))).map(r => ({
                        inner_id: r.inner_id,
                        prevPinned: Boolean(r.is_pinned)
                    })),
                    description: `открепление заметок [${idsStr}]`
                }
            };
        } catch (err) {
            if (window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const offlineRes = unpinOffline();
                if (offlineRes) return offlineRes;
            }
            return { response: '❌ Ошибка открепления: ' + err.message, style: 'output-error' };
        }
    }
});
