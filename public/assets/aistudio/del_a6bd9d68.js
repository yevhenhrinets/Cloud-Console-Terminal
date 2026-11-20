// commands/del.js — мягкое удаление заметок и истории по списку ID (через пробел/запятую) или 'last'

CommandRegistry.register({
    names: ['del', 'delete', 'удалить', 'видалити', 'rm'],
    
    description: 'Deletion',
    category: 'CRUD',
    usage: 'Del [id] | del [id1, id2...] | del note number [id] | delete notes number [id1, id2,...]',
    
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

        // Проверяем ключевое слово 'last'
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
        } else {
            // 💡 Собираем ВСЕ числа из аргументов, надежно игнорируя запятые и пробелы
            const fullArgsStr = parameters.args.join(' ');
            ids = [...new Set(fullArgsStr.match(/\d+/g)?.map(Number) || [])];
        }

        if (ids.length === 0) {
            return { 
                response: `❌ Укажите ID (можно списком через пробел или запятую) или слово "last".\nПример: \`del 1 2, 3\` или \`del last\``, 
                style: 'output-error' 
            };
        }

        try {
            // Мягкое удаление сразу пачки ID с помощью .in()
            const { error } = await window.supabaseClient
                .from(tableName)
                .update({ deleted_at: new Date().toISOString() })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId);

            if (error) throw error;

            const idsStr = ids.join(', ');
            return { 
                response: `🟢 ${entityLabel === 'истории' ? 'Записи истории' : 'Заметки'} [ID: ${idsStr}] успешно удалены.`, 
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note'
            };

        } catch (err) {
            return { response: '❌ Ошибка удаления: ' + err.message, style: 'output-error' };
        }
    }
});
