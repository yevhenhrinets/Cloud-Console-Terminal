// commands/edit.js — редактирование заметок и истории: Шаг 1 словесная команда -> Шаг 2 ID -> Шаг 3 текст

CommandRegistry.register({
    names: [
        'edit', 'ред', 'редактировать', 'ред.', 'редагувати', 'змінити',
        'edit note', 'edit the note', 'edit note number', 'edit the note number',
        'редактировать заметку', 'редагувати нотатку',
        'edit history', 'edit the history', 'edit history number',
        'редактировать историю', 'редагувати історію',
        'edit last', 'edit last note', 'edit last history',
        'ред последнюю', 'редактировать последнюю'
    ],

    description: 'Редактирование заметок или истории (поэтапно: команда -> ID -> текст)',
    category: 'CRUD',
    usage: 'edit -> <id> -> <текст> | edit last note',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'edit').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const isMatchedLast = ['edit last', 'edit last note', 'edit last history', 'ред последнюю', 'редактировать последнюю'].includes(matchedCmd);
        const isMatchedHistory = matchedCmd.includes('history') || matchedCmd.includes('истор') || matchedCmd.includes('істор');

        // Этап 1: запрещаем любые параметры (включая ID/числа и текст) прямо в команде
        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, isMatchedLast ? '' : '6');
            }
            if (!isMatchedLast) {
                return {
                    response: `✏️ Режим редактирования (${isMatchedHistory ? 'истории' : 'заметок'}) активирован. Введите ID (например: 6) или \`last\` и нажмите Enter (или ✕ для отмены).`,
                    style: 'output-info',
                    commandPrefix: matchedCmd,
                    inputValue: '',
                    inputPlaceholder: isMatchedHistory ? 'ID записи истории (напр: 5) или last...' : 'ID заметки (напр: 6) или last...'
                };
            }
        }

        const args = parameters.args || [];
        const argsLower = args.map(a => String(a).toLowerCase());
        const targetUserId = parseTargetUser(args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        const lastKeywords = ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'];
        const historyKeywords = ['history', 'история', 'историю', 'истории', 'історія', 'історію', 'історії'];
        const entityKeywords = [
            'note', 'notes', 'заметка', 'заметки', 'заметку', 'нотатка', 'нотатки', 'нотатку',
            ...historyKeywords,
            'task', 'tasks', 'задача', 'задачи', 'завдання',
            'timer', 'timers', 'таймер', 'таймери',
            'building', 'buildings', 'здание', 'здания', 'постройка', 'постройки', 'будівля'
        ];
        const headerPrefixWords = new Set([
            ...entityKeywords,
            'number', 'номер', '№', 'id', 'ид'
        ]);

        let firstNumericIdx = -1;
        let parsedNumericId = null;
        for (let i = 0; i < args.length; i++) {
            const rawTok = String(args[i]).replace(/[,#:№]/g, '').trim();
            const ordMatch = rawTok.match(/^(\d+)(?:st|nd|rd|th)?$/i);
            if (ordMatch && Number(ordMatch[1]) > 0) {
                firstNumericIdx = i;
                parsedNumericId = Number(ordMatch[1]);
                break;
            }
            if (!headerPrefixWords.has(argsLower[i]) && !lastKeywords.includes(argsLower[i])) {
                break;
            }
        }

        const headerTokens = firstNumericIdx !== -1 ? argsLower.slice(0, firstNumericIdx) : argsLower.slice(0, 2);
        const isHistory = isMatchedHistory || headerTokens.some(w => historyKeywords.includes(w));
        const tableName = isHistory ? 'commands_history' : 'notes';
        const entityLabel = isHistory ? 'истории' : 'заметки';
        const entitySuccessTitle = isHistory ? 'Запись истории' : 'Заметка';
        const textField = isHistory ? 'raw_text' : 'content';

        let isPureEditLast = false;
        if (firstNumericIdx === -1) {
            if (isMatchedLast) {
                isPureEditLast = true;
            } else if (args.length === 1 && lastKeywords.includes(argsLower[0])) {
                isPureEditLast = true;
            } else if (args.length === 2) {
                if ((lastKeywords.includes(argsLower[0]) && entityKeywords.includes(argsLower[1])) ||
                    (entityKeywords.includes(argsLower[0]) && lastKeywords.includes(argsLower[1]))) {
                    isPureEditLast = true;
                }
            }
        }

        let targetInnerId = null;

        if (isPureEditLast) {
            if (window.supabaseClient && (typeof navigator === 'undefined' || navigator.onLine !== false) && !currentUser.isGuest) {
                try {
                    let query = window.supabaseClient
                        .from(tableName)
                        .select('inner_id')
                        .eq('created_by', effectiveUserId)
                        .order('inner_id', { ascending: false })
                        .limit(1);

                    if (!isHistory) {
                        query = query.is('deleted_at', null);
                    }

                    const { data, error } = await query;
                    if (error) throw error;
                    if (data && data.length > 0) {
                        targetInnerId = data[0].inner_id;
                    }
                } catch (err) {
                    console.error('Ошибка поиска последнего ID:', err);
                }
            }
            if (!targetInnerId && !isHistory && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
                if (cached.length > 0) {
                    cached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                    targetInnerId = cached[0].inner_id;
                }
            }
        } else if (parsedNumericId !== null) {
            targetInnerId = parsedNumericId;
        } else {
            targetInnerId = await resolveTargetId(args.slice(0, 3), tableName, effectiveUserId);
        }

        if (!targetInnerId) {
            return {
                response: `❌ Укажите ID (напр: \`6\`) или \`last\`.`,
                style: 'output-error'
            };
        }

        let newContent = '';
        if (isPureEditLast) {
            newContent = '';
        } else if (firstNumericIdx !== -1) {
            const rawArgsStr = String(parameters.raw_args || '');
            const tokenRegex = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
            let tokenIdx = 0;
            let splitOffset = -1;
            while (tokenRegex.exec(rawArgsStr) !== null) {
                if (tokenIdx === firstNumericIdx) {
                    splitOffset = tokenRegex.lastIndex;
                    break;
                }
                tokenIdx++;
            }
            newContent = splitOffset !== -1
                ? rawArgsStr.slice(splitOffset).trim()
                : args.slice(firstNumericIdx + 1).join(' ').trim();
        } else {
            let idIndex = -1;
            for (let i = 0; i < args.length; i++) {
                if (String(args[i]).replace(/[,#:№]/g, '') === String(targetInnerId)) {
                    idIndex = i;
                    break;
                }
            }

            if (idIndex !== -1) {
                newContent = args.slice(idIndex + 1).join(' ').trim();
            } else {
                let startIndex = 0;
                const auxWords = ['number', 'номер', '№', 'id', 'ид'];
                while (startIndex < args.length) {
                    const word = args[startIndex].toLowerCase();
                    if (entityKeywords.includes(word) || auxWords.includes(word) || word === String(targetInnerId)) {
                        startIndex++;
                    } else {
                        break;
                    }
                }
                newContent = args.slice(startIndex).join(' ').trim();
            }
        }

        if (newContent && !(options && options.fromTwoStepBar)) {
            return rejectInlineParamsError(matchedCmd, String(targetInnerId));
        }

        const handleOfflineEdit = () => {
            if (isHistory || !window.OfflineNotesSync) return null;
            const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
            const item = cached.find(n => Number(n.inner_id) === Number(targetInnerId));
            if (!item) {
                return { response: `❌ Активный объект [заметки] с ID [${targetInnerId}] не найден в оффлайн-кэше.`, style: 'output-error' };
            }
            if (!newContent) {
                return {
                    response: `📝 Текущий текст заметки [${targetInnerId}] загружен в поле ввода (оффлайн). Отредактируйте его и нажмите Enter или ✕ для отмены.`,
                    style: 'output-info',
                    commandPrefix: `edit note ${targetInnerId}`,
                    inputValue: `${item.content || ''}`,
                    inputPlaceholder: `Введите новый текст заметки [${targetInnerId}]...`
                };
            }
            const updated = window.OfflineNotesSync.queueEditNoteOffline(effectiveUserId, targetInnerId, newContent);
            return {
                response: `🟢 Заметка [${targetInnerId}] изменена локально (v${updated.version}) и добавлена в очередь синхронизации.`,
                style: 'output-success',
                editedEntity: 'note'
            };
        };

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
            const offRes = handleOfflineEdit();
            if (offRes) return offRes;
            return { response: '📡 Редактирование истории недоступно без подключения к базе.', style: 'output-error' };
        }

        try {
            let query = window.supabaseClient
                .from(tableName)
                .select('*')
                .eq('inner_id', targetInnerId)
                .eq('created_by', effectiveUserId)
                .order('version', { ascending: false })
                .limit(1);

            if (!isHistory) {
                query = query.is('deleted_at', null);
            }

            const { data: items, error: fetchError } = await query;
            if (fetchError) throw fetchError;

            if (!items || items.length === 0) {
                return { response: `❌ Активный объект [${entityLabel}] с ID [${targetInnerId}] не найден.`, style: 'output-error' };
            }

            const latestItem = items[0];
            const currentText = latestItem[textField] || '';

            if (!newContent) {
                const prefix = isHistory ? 'edit history' : 'edit note';
                return {
                    response: `📝 Текущий текст ${entityLabel} [${targetInnerId}] загружен в поле ввода. Отредактируйте его и нажмите Enter или ✕ для отмены.`,
                    style: 'output-info',
                    commandPrefix: `${prefix} ${targetInnerId}`,
                    inputValue: `${currentText}`,
                    inputPlaceholder: `Введите новый текст ${entityLabel} [${targetInnerId}]...`
                };
            }

            let insertPayload = {
                inner_id: latestItem.inner_id,
                version: (latestItem.version || 1) + 1,
                created_by: latestItem.created_by,
                created_at: latestItem.created_at
            };

            if (isHistory) {
                insertPayload.raw_text = newContent;
                insertPayload.command = newContent.split(' ')[0] || '';
                insertPayload.output = latestItem.output;
                insertPayload.status = latestItem.status;
            } else {
                insertPayload.content = newContent;
                insertPayload.is_pinned = latestItem.is_pinned;
                insertPayload.updated_by = currentUser.id;
            }

            const { error: insertError } = await window.supabaseClient
                .from(tableName)
                .insert([insertPayload])
                .select();

            if (insertError) throw insertError;

            return {
                response: `🟢 ${entitySuccessTitle} [${targetInnerId}] успешно отредактирована (версия v${insertPayload.version}).`,
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note'
            };
        } catch (err) {
            if (!isHistory && window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const offRes = handleOfflineEdit();
                if (offRes) return offRes;
            }
            return { response: `❌ Ошибка редактирования ${entityLabel}: ` + err.message, style: 'output-error' };
        }
    }
});
