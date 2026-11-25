// commands/history.js — вывод ПОСЛЕДНИХ 50 записей (history) и выбор лимита/ID строго на 2-м этапе (history limit)

async function runHistoryCommand(parameters, options = {}, forceLimitMode = false) {
    const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;

    const matchedCmd = String((parameters && parameters.matchedCmd) || (forceLimitMode ? 'history limit' : 'history')).trim().toLowerCase();
    const args = parameters && Array.isArray(parameters.args) ? parameters.args : [];
    const rawArgs = parameters && parameters.raw_args ? String(parameters.raw_args).trim() : '';

    if (!(options && options.fromTwoStepBar)) {
        if (rawArgs) {
            return rejectInlineParamsError(
                'history limit',
                '100',
                '💡 Без параметров введите просто `history` (последние 50) или `history limit` для указания числа/ID на 2-м этапе.'
            );
        }
        if (forceLimitMode) {
            return {
                response: `📜 История с параметром (\`${matchedCmd}\`): введите количество записей (например: 100, 20) или #ID (например: #5) и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: 'Количество записей (напр: 100) или #ID (напр: #5)...'
            };
        }
    }

    const combinedArgStr = (args.join(' ') + ' ' + rawArgs).trim().toLowerCase();

    if (forceLimitMode && (options && options.fromTwoStepBar) && !combinedArgStr) {
        return { response: '❌ Укажите число записей (например: `100`) или `#ID` (например: `#5`).', style: 'output-error', skipHistorySave: true };
    }

    let requestedLimit = 50;
    let isSpecificIdSearch = false;
    let specificIdNum = null;

    if (combinedArgStr.includes('#') || combinedArgStr.includes('id') || combinedArgStr.includes('номер') || combinedArgStr.includes('запись')) {
        const numMatch = combinedArgStr.match(/\b(\d+)\b/);
        if (numMatch) {
            isSpecificIdSearch = true;
            specificIdNum = parseInt(numMatch[1], 10);
        }
    } else if (combinedArgStr) {
        const numMatch = combinedArgStr.match(/\b(\d+)\b/);
        if (numMatch) {
            const val = parseInt(numMatch[1], 10);
            if (val >= 1 && val <= 5000) {
                requestedLimit = val;
            }
        } else if (forceLimitMode) {
            return { response: '❌ Введите число (например: `100`, `20`) или `#ID` (например: `#5`).', style: 'output-error', skipHistorySave: true };
        }
    }

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
                    !String(r.command || '').startsWith('__') &&
                    !String(r.raw_text || '').startsWith('__')
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
        } catch (e) {}
    }

    const localActions = typeof window.getLocalActionsHistory === 'function' ? window.getLocalActionsHistory() : [];

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
                    !String(r.command || '').startsWith('__') &&
                    !String(r.raw_text || '').startsWith('__')
                );
            }
        } catch (err) {
            console.warn('Supabase commands_history fetch error:', err);
        }
    }

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

        if (cloudItem.navKey) {
            const dupNav = combined.find(existing =>
                existing.navKey === cloudItem.navKey &&
                Math.abs(existing.ts - cloudItem.ts) <= 4000
            );
            if (dupNav) continue;
        }

        combined.push(cloudItem);
    }

    combined.sort((a, b) => b.ts - a.ts);

    if (combined.length === 0) {
        return {
            response: '📜 История команд и действий пуста.\n💡 Выполните любое действие на страницах (Кухня, Зал, Дашборд, Поручения) или введите команду.',
            style: 'output-info',
            skipHistorySave: true
        };
    }

    const recentRecords = combined.slice(0, requestedLimit);
    const displayList = [...recentRecords].reverse();

    let outputText = `📜 ПОСЛЕДНИЕ ${recentRecords.length} ЗАПИСЕЙ ИСТОРИИ:\n`;
    outputText += `────────────────────────────────────────────────────────────\n`;

    displayList.forEach((row, idx) => {
        const isVeryLast = idx === displayList.length - 1;
        const num = `#${idx + 1}`.padEnd(4, ' ');

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
    outputText += `💡 Выведено ПОСЛЕДНИХ ${recentRecords.length} записей (самые свежие — внизу списка).\n`;
    if (!isOnline || !window.supabaseClient) {
        outputText += `📡 Режим ОФЛАЙН: показана локальная история. Новые действия попадут в базу при подключении.\n`;
    }
    try {
        const pendingList = JSON.parse(localStorage.getItem('terminal_pending_cloud_actions') || '[]');
        if (Array.isArray(pendingList) && pendingList.length > 0) {
            outputText += `⏳ Ожидают отправки в облако: ${pendingList.length} записей (синхронизируются по порядку).\n`;
        }
    } catch (e) {}
    outputText += `💡 Для выбора количества записей (напр. 100) или #ID используйте команду \`history limit\` (2 этапа)`;

    return { response: outputText, style: 'output-info', skipHistorySave: true };
}

CommandRegistry.register({
    names: ['history', 'история', 'історія', 'commands history', 'history list', 'commands history list'],
    description: 'Вывод последних 50 команд и действий со всех страниц',
    category: 'CRUD',
    usage: 'history | history limit -> <количество>',
    handler: async (parameters, options = {}) => {
        return await runHistoryCommand(parameters, options, false);
    }
});

CommandRegistry.register({
    names: ['history limit', 'history count', 'history number', 'history id', 'show history limit', 'show history count', 'лимит истории', 'история по номеру'],
    description: 'Вывод истории с указанием количества записей или #ID (строго в 2 этапа)',
    category: 'CRUD',
    usage: 'history limit -> <100 | #5>',
    handler: async (parameters, options = {}) => {
        return await runHistoryCommand(parameters, options, true);
    }
});
