// commands/restore.js — массовое восстановление из корзины по списку ID или 'last'

CommandRegistry.register({
    names: ['restore', 'восстановить', 'відновити'],
    
    description: 'Restoration',
    category: 'CRUD',
    usage: 'Restore [id] | restore [id1, id2...]',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const argsLower = parameters.args.map(a => String(a).toLowerCase());
        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        const isHistory = argsLower.includes('history') || argsLower.includes('история') || argsLower.includes('історія');
        const tableName = isHistory ? 'commands_history' : 'notes';
        const entityLabel = isHistory ? 'истории' : 'заметки';
        const isOfflineMode = !window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest;

        if (isHistory && isOfflineMode) {
            return { response: '📡 Восстановление записей истории из корзины доступно при подключении к интернету.', style: 'output-info' };
        }

        const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
        
        let ids = [];
        if (isLastKeyword) {
            if (!isOfflineMode) {
                try {
                    const { data, error } = await window.supabaseClient
                        .from(tableName)
                        .select('inner_id')
                        .eq('created_by', effectiveUserId)
                        .not('deleted_at', 'is', null)
                        .order('inner_id', { ascending: false })
                        .limit(1);
                        
                    if (error) throw error;
                    if (data && data.length > 0) ids = [data[0].inner_id];
                } catch (err) {
                    console.error('Ошибка поиска последнего удаленного ID:', err);
                }
            }
            if (!isHistory && ids.length === 0 && window.OfflineNotesSync) {
                const deletedCached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => n.deleted_at);
                if (deletedCached.length > 0) {
                    deletedCached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                    ids = [deletedCached[0].inner_id];
                }
            }
        } else {
            const fullArgsStr = parameters.args.join(' ');
            ids = [...new Set(fullArgsStr.match(/\d+/g)?.map(Number) || [])];
        }

        if (ids.length === 0) {
            return { 
                response: `❌ Укажите ID (можно списком) или слово "last" для восстановления.\nПример: \`restore 1 2, 3\` или \`restore last\``, 
                style: 'output-error' 
            };
        }

        const restoreOffline = () => {
            if (isHistory || !window.OfflineNotesSync) return null;
            const matched = window.OfflineNotesSync.queueRestoreNotesOffline(effectiveUserId, ids);
            if (!matched || matched.length === 0) {
                return { response: `❌ Удаленные заметки [ID: ${ids.join(', ')}] не найдены в локальном кэше.`, style: 'output-error' };
            }
            return {
                response: `🟢 Заметки [ID: ${matched.join(', ')}] восстановлены (📡 Офлайн — синхронизируется при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        };

        if (isOfflineMode) {
            const offlineRes = restoreOffline();
            if (offlineRes) return offlineRes;
        }

        try {
            const { error } = await window.supabaseClient
                .from(tableName)
                .update({ deleted_at: null })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId);

            if (error) throw error;

            if (!isHistory && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId);
                cached.forEach(n => {
                    if (ids.includes(Number(n.inner_id))) n.deleted_at = null;
                });
                window.OfflineNotesSync.saveNotesCache(effectiveUserId, cached);
            }

            const idsStr = ids.join(', ');
            return { 
                response: `🟢 ${entityLabel === 'истории' ? 'Записи истории' : 'Заметки'} [ID: ${idsStr}] успешно восстановлены.`, 
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note'
            };

        } catch (err) {
            if (!isHistory && window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const offlineRes = restoreOffline();
                if (offlineRes) return offlineRes;
            }
            return { response: '❌ Ошибка восстановления: ' + err.message, style: 'output-error' };
        }
    }
});
