// commands/unpin.js — массовое открепление заметок по списку ID или 'last'

CommandRegistry.register({
    names: [
        'unpin', 'unpin note', 'unpin the note', 'unpin notes', 'unpin the notes', 'unpin note number', 'unpin the note number',
        'unfix', 'unfix note', 'unfix the note', 'unfix notes', 'unfix the notes', 'unfix note number', 'unfix the note number',
        'make unfixed', 'make note unfixed', 'make the note unfixed', 'make last note unfixed',
        'unfasten', 'unfasten note', 'unfasten the note', 'unfasten notes', 'unfasten the notes', 'unfasten note number', 'unfasten the note number',
        'detach', 'detach note', 'detach the note', 'detach notes', 'detach the notes', 'detach note number', 'detach the note number',
        'loosen', 'loosen note', 'loosen the note', 'loosen notes', 'loosen the notes', 'loosen note number', 'loosen the note number',
        'открепить', 'відкріпити'
    ],
    
    description: 'Unpin / unfasten / detach / loosen note (notes) by id (ids, including 1st/2nd/6th) or last',
    category: 'Notes',
    usage: 'unpin [id] | unfasten the note number [id] | detach [6th] note | loosen the note [id] | unfix [id]',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const argsLower = parameters.args.map(a => String(a).toLowerCase());
        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;
        const isOfflineMode = !window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest;

        const isLastKeyword = (parameters.matchedCmd === 'make last note unfixed') || argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
        
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
            // Поддерживает числа и порядковые формы (6th, 1st, 2nd, 3rd и т.д.)
            const fullArgsStr = parameters.args.join(' ');
            ids = [...new Set((fullArgsStr.match(/\d+/g) || []).map(Number).filter(n => Number.isFinite(n) && n > 0))];
        }

        if (ids.length === 0) {
            return { 
                response: `❌ Укажите ID (можно списком или как 6th) или слово "last" для открепления.\nПример: \`unpin 6\`, \`unfasten the note number 6\`, \`detach 6th note\`, \`loosen the note 6\``, 
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
                editedEntity: 'note'
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
