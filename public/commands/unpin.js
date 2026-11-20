// commands/unpin.js — массовое открепление заметок по списку ID или 'last'

CommandRegistry.register({
    names: ['unpin', 'открепить', 'відкріпити'],
    
    description: 'Unpinning',
    category: 'Notes',
    usage: 'Unpin [note_id] | unpin note [id] | unpin [note_id1, note_id2...] | unpin notes number: [id1, id2...]',
    
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

        const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
        
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
            const fullArgsStr = parameters.args.join(' ');
            ids = [...new Set(fullArgsStr.match(/\d+/g)?.map(Number) || [])];
        }

        if (ids.length === 0) {
            return { 
                response: `❌ Укажите ID (можно списком) или слово "last" для открепления.\nПример: \`unpin 1 2, 3\` или \`unpin last\``, 
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
