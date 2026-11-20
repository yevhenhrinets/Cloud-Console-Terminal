// commands/pin.js — массовое закрепление заметок по списку ID или 'last'

CommandRegistry.register({
    names: ['pin', 'закрепить', 'закріпити', 'приколоть', 'приколоти'],
    
    description: 'Pin note (notes) by id (ids)',
    category: 'Notes',
    usage: 'Pin [id] | pin [id1, id2...]',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const argsLower = parameters.args.map(a => String(a).toLowerCase());
        const targetUserId = parseTargetUser(parameters.args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
        
        let ids = [];
        if (isLastKeyword) {
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
                console.error('Ошибка поиска последнего ID для закрепления:', err);
            }
        } else {
            const fullArgsStr = parameters.args.join(' ');
            ids = [...new Set(fullArgsStr.match(/\d+/g)?.map(Number) || [])];
        }

        if (ids.length === 0) {
            return { 
                response: `❌ Укажите ID (можно списком) или слово "last" для закрепления.\nПример: \`pin 1 2, 3\` или \`pin last\``, 
                style: 'output-error' 
            };
        }

        try {
            const { error } = await window.supabaseClient
                .from('notes')
                .update({ is_pinned: true })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId)
                .is('deleted_at', null);

            if (error) throw error;

            const idsStr = ids.join(', ');
            return { 
                response: `📌 Заметки [ID: ${idsStr}] успешно закреплены.`, 
                style: 'output-success',
                editedEntity: 'note'
            };

        } catch (err) {
            return { response: '❌ Ошибка закрепления: ' + err.message, style: 'output-error' };
        }
    }
});
