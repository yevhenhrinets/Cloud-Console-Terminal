// commands/history.js — плагин истории, использующий raw_text

CommandRegistry.register({
    names: ['history', 'история', 'історія', 'show history', 'commands history', 'history list', 'commands history list'],
    
    description: 'Command history list',
    category: 'CRUD',
    usage: 'History | show history',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const targetUserId = parseTargetUser(parameters.args);
        const ids = extractNumericIds(parameters.args);

        // Точечный просмотр истории по ID
        if (ids.length > 0 && !targetUserId) {
            const targetInnerId = ids[0];
            try {
                let query = window.supabaseClient
                    .from('commands_history')
                    .select('*')
                    .is('deleted_at', null)
                    .eq('inner_id', targetInnerId);

                if (!['root', 'support'].includes(currentUser.role)) {
                    query = query.eq('created_by', currentUser.id);
                }

                const { data, error } = await query.order('id', { ascending: false }).limit(5);
                if (error) throw error;

                if (!data || data.length === 0) {
                    return { response: `Запись истории с ID [${targetId}] не найдена.`, style: 'output-error' };
                }
                
                // 🧠 ГРУППИРУЕМ ПО inner_id И ОСТАВЛЯЕМ ТОЛЬКО ПОСЛЕДНЮЮ ВЕРСИЮ
                const latestHistoryMap = new Map();
                data.forEach(history => {
                    // Если такого inner_id еще нет в карте или версия текущей заметки выше — обновляем
                    if (!latestHistoryMap.has(history.inner_id) || history.version > latestHistoryMap.get(history.inner_id).version) {
                        latestHistoryMap.set(history.inner_id, history);
                    }
                });
        
                // Превращаем карту обратно в массив и сортируем по inner_id (или дате) от новых к старым
                const activeHistory = Array.from(latestHistoryMap.values()).sort((a, b) => b.inner_id - a.inner_id);

                const response = `Контекст истории вокруг ID [${targetId}]:\n` +
                    activeHistory.map(row => {
                        const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                        // Используем raw_text, а если его нет (старая запись) — собираем из частей
                        const cmdDisplay = row.raw_text || `${row.command}${row.parameters && row.parameters.raw_args ? ' ' + row.parameters.raw_args : ''}`;
                        const statusMark = row.status === 'failure' ? ' ❌' : ' ✔️';
                        const outputText = row.output ? `\n   └─ [Результат]: ${row.output.replace(/\n/g, '\n      ')}` : '';
                        return `[ID: ${row.id}] [${timeStr}] ${cmdDisplay}${statusMark}${outputText}`;
                    }).join('\n');

                return { response, style: 'output-info' };
            } catch (err) {
                return { response: 'Ошибка поиска по истории: ' + err.message, style: 'output-error' };
            }
        } else {
            // Список последних команд
            try {
                let query = window.supabaseClient
                    .from('commands_history')
                    .select('*')
                    .is('deleted_at', null);

                if (['root', 'support'].includes(currentUser.role)) {
                    if (targetUserId) {
                        query = query.eq('created_by', targetUserId);
                    }
                } else {
                    query = query.eq('created_by', currentUser.id);
                }

                const { data, error } = await query.order('created_at', { ascending: false }).limit(6);
                if (error) throw error;

                if (!data || data.length === 0) {
                    return { response: 'История команд пуста.', style: 'output-info' };
                }

                const response = "Последние команды из облака:\n" + 
                    data.map(row => {
                        const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                        const cmdDisplay = row.raw_text || `${row.command}${row.parameters && row.parameters.raw_args ? ' ' + row.parameters.raw_args : ''}`;
                        const statusMark = row.status === 'failure' ? ' ❌' : ' ✔️';
                        const firstLineOutput = row.output ? ' ➔ ' + row.output.split('\n')[0] : '';
                        return `[ID: ${row.id}] [${timeStr}] ${cmdDisplay}${statusMark}${firstLineOutput}`;
                    }).join('\n');

                return { response, style: 'output-info' };
            } catch (err) {
                return { response: 'Ошибка загрузки истории: ' + err.message, style: 'output-error' };
            }
        }
    }
});
