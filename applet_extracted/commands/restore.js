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

        const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
        
        let ids = [];
        if (isLastKeyword) {
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

        try {
            const { error } = await window.supabaseClient
                .from(tableName)
                .update({ deleted_at: null })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId);

            if (error) throw error;

            const idsStr = ids.join(', ');
            return { 
                response: `🟢 ${entityLabel === 'истории' ? 'Записи истории' : 'Заметки'} [ID: ${idsStr}] успешно восстановлены.`, 
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note'
            };

        } catch (err) {
            return { response: '❌ Ошибка восстановления: ' + err.message, style: 'output-error' };
        }
    }
});
