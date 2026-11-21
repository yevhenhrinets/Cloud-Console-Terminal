// commands/edit.js — разделение логики для быстрого 'edit last' и прямого редактирования по ID с текстом

CommandRegistry.register({
    names: ['edit', 'ред', 'редактировать', 'ред.', 'редагувати', 'змінити'],
    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
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

        // Находим первый числовой ID в заголовке команды (до начала нового текста)
        let firstNumericIdx = -1;
        let parsedNumericId = null;
        for (let i = 0; i < args.length; i++) {
            const cleaned = String(args[i]).replace(/[,#:№]/g, '').trim();
            if (/^\d+$/.test(cleaned) && Number(cleaned) > 0) {
                firstNumericIdx = i;
                parsedNumericId = Number(cleaned);
                break;
            }
            if (!headerPrefixWords.has(argsLower[i]) && !lastKeywords.includes(argsLower[i])) {
                break;
            }
        }

        // Проверяем "history" и "last" ТОЛЬКО в заголовке до ID, а не внутри текста самой заметки
        const headerTokens = firstNumericIdx !== -1 ? argsLower.slice(0, firstNumericIdx) : argsLower.slice(0, 2);
        const isHistory = headerTokens.some(w => historyKeywords.includes(w));
        const tableName = isHistory ? 'commands_history' : 'notes';
        const entityLabel = isHistory ? 'истории' : 'заметки';
        const entitySuccessTitle = isHistory ? 'Запись истории' : 'Заметка';
        const textField = isHistory ? 'raw_text' : 'content';

        // 💡 1. Четко проверяем, является ли команда чистым вызовом "edit last" на одном из языков
        let isPureEditLast = false;
        if (firstNumericIdx === -1) {
            if (args.length === 1 && lastKeywords.includes(argsLower[0])) {
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
            // Для "edit last" автоматически находим ID самой последней записи в таблице
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
                response: `❌ Укажите ID или используйте \`edit last\` для редактирования.\nПример: \`edit last note\` или \`edit 80 Новый текст\``, 
                style: 'output-error' 
            };
        }

        // Извлекаем новый текст (сохраняя точное форматирование из raw_args после ID)
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
            const cmdHint = isHistory ? `edit history ${targetInnerId}` : `edit ${targetInnerId}`;
            return {
                response: `⚠️ Редактирование текста работает только в 2 этапа — нельзя указывать новый текст прямо в команде!\n1) Введите \`${cmdHint}\` (или \`edit last\`)\n2) Отредактируйте загруженный текст в поле ввода.`,
                style: 'output-error'
            };
        }

        // Оффлайн-ветка для заметок (загрузка в инпут и сохранение в очередь синхронизации)
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
            // 2. Находим версию объекта по inner_id
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

            // 3. ЭТАП 1: Если текст не передан (или это чистый edit last) — команда крепится под prompt, а в поле ТОЛЬКО текст!
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

            // 4. ЭТАП 2: Если текст передан — сохраняем новую версию (INSERT)
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
