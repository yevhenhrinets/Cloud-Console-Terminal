// commands/history.js — вывод ПОСЛЕДНИХ 50 (по умолчанию) или ПОСЛЕДНИХ 100 записей

CommandRegistry.register({
    names: ['history', 'история', 'історія', 'show history', 'show commands history', 'commands history', 'history list', 'commands history list'],
    
    description: 'Вывод последних 50 или 100 команд и действий со всех страниц',
    category: 'CRUD',
    usage: 'history | history 100 | history 50 | show history',
    
    handler: async (parameters) => {
        const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
        
        const args = parameters && Array.isArray(parameters.args) ? parameters.args : [];
        const rawArgs = parameters && parameters.raw_args ? String(parameters.raw_args) : '';
        const combinedArgStr = (args.join(' ') + ' ' + rawArgs).trim().toLowerCase();
        
        // 1. Определение лимита: строго ПОСЛЕДНИЕ 50 по умолчанию, при "history 100" — ПОСЛЕДНИЕ 100
        let requestedLimit = 50;
        let isSpecificIdSearch = false;
        let specificIdNum = null;

        if (combinedArgStr.includes('#') || combinedArgStr.includes('id') || combinedArgStr.includes('номер') || combinedArgStr.includes('запись')) {
            const numMatch = combinedArgStr.match(/\b(\d+)\b/);
            if (numMatch) {
                isSpecificIdSearch = true;
                specificIdNum = parseInt(numMatch[1], 10);
            }
        } else {
            const numMatch = combinedArgStr.match(/\b(\d+)\b/);
            if (numMatch) {
                const val = parseInt(numMatch[1], 10);
                if (val >= 1 && val <= 5000) {
                    requestedLimit = val;
                }
            }
        }

        // Если запрошен поиск конкретного ID (например, history #5)
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
        if (isSpecificIdSearch && specificIdNum && isOnline && window.supabaseClient && currentUser && !currentUser.isGuest) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('commands_history')
                    .select('*')
                    .is('deleted_at', null)
                    .eq('inner_id', specificIdNum)
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (!error && Array.isArray(data) && data.length > 0) {
                    const visible = data.filter(r =>
                        r.command !== '__house_layout__' &&
                        !String(r.raw_text || '').startsWith('__house_layout__:') &&
                        r.command !== '__support_report__' &&
                        !String(r.raw_text || '').startsWith('__support_report__:') &&
                        r.command !== '__command_alias__' &&
                        !String(r.raw_text || '').startsWith('__command_alias__:') &&
                        r.command !== '__task_cooldown__' &&
                        !String(r.raw_text || '').startsWith('__task_cooldown__:')
                    );
                    if (visible.length > 0) {
                        const row = visible[0];
                        const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                        const cmdDisplay = row.raw_text || `${row.command || ''}`;
                        const statusMark = row.status === 'failure' ? ' ❌' : ' ✔️';
                        const outputText = row.output ? `\n   └─ [Результат]: ${row.output}` : '';
                        return {
                            response: `📜 Запись истории [ID: ${row.inner_id || row.id}] [${timeStr}]:\n${cmdDisplay}${statusMark}${outputText}`,
                            style: 'output-info',
                            skipHistorySave: true
                        };
                    }
                }
            } catch (e) {
                // fallback к общему списку
            }
        }

        // 2. Сбор истории из локального хранилища (до 200 последних действий со всех страниц)
        const localActions = typeof window.getLocalActionsHistory === 'function' ? window.getLocalActionsHistory() : [];
        
        // 3. Сбор истории из Supabase (если подключен, онлайн и авторизован)
        let remoteActions = [];
        if (isOnline && window.supabaseClient && currentUser && !currentUser.isGuest && currentUser.id !== 'guest') {
            try {
                const fetchCount = Math.max(150, requestedLimit * 2);
                const { data, error } = await window.supabaseClient
                    .from('commands_history')
                    .select('*')
                    .is('deleted_at', null)
                    .order('created_at', { ascending: false })
                    .limit(fetchCount);

                if (!error && Array.isArray(data)) {
                    remoteActions = data.filter(r =>
                        r.command !== '__house_layout__' &&
                        !String(r.raw_text || '').startsWith('__house_layout__:') &&
                        r.command !== '__support_report__' &&
                        !String(r.raw_text || '').startsWith('__support_report__:') &&
                        r.command !== '__command_alias__' &&
                        !String(r.raw_text || '').startsWith('__command_alias__:') &&
                        r.command !== '__task_cooldown__' &&
                        !String(r.raw_text || '').startsWith('__task_cooldown__:')
                    );
                }
            } catch (err) {
                console.warn('Supabase commands_history fetch error:', err);
            }
        }

        // 4. Объединение и скользящая 1-к-1 дедупликация (без артефактов границ 3-секундных бакетов)
        const getNavKey = typeof window.getCanonicalNavKey === 'function'
            ? window.getCanonicalNavKey
            : () => '';

        const normalizeItem = (item, source) => {
            const raw = (item.raw_text || item.command || '').trim();
            const ts = item.created_at ? new Date(item.created_at).getTime() : 0;
            return {
                raw_text: raw,
                rawLower: raw.toLowerCase(),
                navKey: getNavKey(raw),
                command: item.command,
                output: item.output || '',
                status: item.status || 'success',
                created_at: item.created_at || new Date().toISOString(),
                ts: isNaN(ts) ? 0 : ts,
                source: source,
                id: item.inner_id || item.id || null,
                _matched: false
            };
        };

        const localNormalized = localActions
            .map(i => normalizeItem(i, 'local'))
            .filter(i => i.raw_text);
        const remoteNormalized = remoteActions
            .map(i => normalizeItem(i, 'cloud'))
            .filter(i => i.raw_text);

        const combined = [];

        // Сначала добавляем локальные записи (фильтруя явные дубли навигации)
        for (const item of localNormalized) {
            if (item.navKey) {
                const dupLocalNav = combined.find(existing =>
                    existing.navKey === item.navKey &&
                    Math.abs(existing.ts - item.ts) <= 4000
                );
                if (dupLocalNav) continue;
            }
            combined.push(item);
        }

        // Затем сопоставляем записи из Supabase 1-к-1 с локальными по скользящему окну 8 секунд
        for (const cloudItem of remoteNormalized) {
            const matchingLocal = combined.find(localItem => {
                if (localItem.source !== 'local' || localItem._matched) return false;
                const timeDiff = Math.abs(cloudItem.ts - localItem.ts);
                if (timeDiff > 8000) return false;
                if (localItem.rawLower === cloudItem.rawLower) return true;
                if (localItem.navKey && cloudItem.navKey && localItem.navKey === cloudItem.navKey && timeDiff <= 4000) {
                    return true;
                }
                return false;
            });

            if (matchingLocal) {
                matchingLocal._matched = true;
                if (!matchingLocal.id && cloudItem.id) {
                    matchingLocal.id = cloudItem.id;
                }
                continue;
            }

            // Фильтруем также дубли навигации среди облачных записей
            if (cloudItem.navKey) {
                const dupNav = combined.find(existing =>
                    existing.navKey === cloudItem.navKey &&
                    Math.abs(existing.ts - cloudItem.ts) <= 4000
                );
                if (dupNav) continue;
            }

            combined.push(cloudItem);
        }

        // Сортировка от самых новых к старым (descending)
        combined.sort((a, b) => b.ts - a.ts);

        if (combined.length === 0) {
            return {
                response: '📜 История команд и действий пуста.\n💡 Выполните любое действие на страницах (Кухня, Зал, Дашборд, Поручения) или введите команду.',
                style: 'output-info',
                skipHistorySave: true
            };
        }

        // 5. Берем СТРОГО ПОСЛЕДНИЕ requestedLimit записей (50 по умолчанию, 100 при "history 100")
        const recentRecords = combined.slice(0, requestedLimit);

        // 6. Разворачиваем для хронологического вывода в терминал (от более ранних к самым свежим),
        // чтобы при автопрокрутке консоли вниз пользователь видел САМЫЕ ПОСЛЕДНИЕ действия прямо перед строкой ввода!
        const displayList = [...recentRecords].reverse();

        let outputText = `📜 ПОСЛЕДНИЕ ${recentRecords.length} ЗАПИСЕЙ ИСТОРИИ:\n`;
        outputText += `────────────────────────────────────────────────────────────\n`;

        displayList.forEach((row, idx) => {
            const isVeryLast = idx === displayList.length - 1;
            const num = `#${idx + 1}`.padEnd(4, ' ');

            // Точное время с секундами (ДД.ММ.ГГ ЧЧ:ММ:СС)
            let timeStr = '';
            if (row.created_at) {
                const d = new Date(row.created_at);
                if (!isNaN(d.getTime())) {
                    const day = String(d.getDate()).padStart(2, '0');
                    const mo = String(d.getMonth() + 1).padStart(2, '0');
                    const yr = String(d.getFullYear()).slice(-2);
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    const ss = String(d.getSeconds()).padStart(2, '0');
                    timeStr = `${day}.${mo}.${yr} ${hh}:${mm}:${ss}`;
                }
            }

            const statusMark = row.status === 'failure' ? '❌' : '✔️';
            const cmdText = row.raw_text;
            
            let resultPreview = '';
            if (row.output) {
                const firstLine = String(row.output).replace(/[\r\n]+/g, ' ').slice(0, 45);
                resultPreview = ` ➔ ${firstLine}`;
            }

            const lastMarker = isVeryLast ? ' 👈 [САМАЯ ПОСЛЕДНЯЯ]' : '';
            outputText += `[${num}] [${timeStr}] ${cmdText} ${statusMark}${resultPreview}${lastMarker}\n`;
        });

        outputText += `────────────────────────────────────────────────────────────\n`;
        outputText += `💡 Выведено ПОСЛЕДНИХ ${recentRecords.length} записей (самые свежие — внизу списка, перед полем ввода).\n`;
        if (!isOnline || !window.supabaseClient) {
            outputText += `📡 Режим ОФЛАЙН: показана локальная история. Новые действия попадут в базу при подключении.\n`;
        }
        try {
            const pendingList = JSON.parse(localStorage.getItem('terminal_pending_cloud_actions') || '[]');
            if (Array.isArray(pendingList) && pendingList.length > 0) {
                outputText += `⏳ Ожидают отправки в облако: ${pendingList.length} записей (синхронизируются по порядку).\n`;
            }
        } catch (e) {}
        if (requestedLimit === 50) {
            outputText += `💡 Можно указать любое количество записей, например: history 20 или history 150`;
        } else {
            outputText += `💡 Можно ввести любое число (например: history 20, history 150) или просто history (50)`;
        }

        return { response: outputText, style: 'output-info', skipHistorySave: true };
    }
});
