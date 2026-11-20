// commands/edit.js — разделение логики для быстрого 'edit last' и прямого редактирования по ID с текстом

CommandRegistry.register({
    names: ['edit', 'ред', 'редактировать', 'ред.', 'редагувати', 'змінити'],
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const args = parameters.args;
        const argsLower = args.map(a => a.toLowerCase());
        const targetUserId = parseTargetUser(args);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        const isHistory = argsLower.includes('history') || argsLower.includes('история') || argsLower.includes('історія');
        const tableName = isHistory ? 'commands_history' : 'notes';
        const entityLabel = isHistory ? 'истории' : 'заметки';
        const textField = isHistory ? 'raw_text' : 'content';

        // 💡 1. Четко проверяем, является ли команда чистым вызовом "edit last" на одном из языков
        const lastKeywords = ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'];
        const entityKeywords = [
            'note', 'notes', 'заметка', 'заметки', 'нотатка', 'нотатки',
            'history', 'история', 'історія',
            'task', 'tasks', 'задача', 'задачи', 'завдання',
            'timer', 'timers', 'таймер', 'таймери',
            'building', 'buildings', 'здание', 'здания', 'постройка', 'постройки', 'будівля'
        ];

        let isPureEditLast = false;
        if (args.length === 1 && lastKeywords.includes(argsLower[0])) {
            isPureEditLast = true;
        } else if (args.length === 2) {
            if ((lastKeywords.includes(argsLower[0]) && entityKeywords.includes(argsLower[1])) ||
                (entityKeywords.includes(argsLower[0]) && lastKeywords.includes(argsLower[1]))) {
                isPureEditLast = true;
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
        } else {
            // Для обычного редактирования ищем конкретный ID или числовой номер из аргументов
            targetInnerId = await resolveTargetId(args, tableName, effectiveUserId);
        }

        if (!targetInnerId) {
            return { 
                response: `❌ Укажите ID или используйте \`edit last\` для редактирования.\nПример: \`edit last note\` или \`edit 80 Новый текст\``, 
                style: 'output-error' 
            };
        }

        // Извлекаем новый текст
        let newContent = '';
        if (isPureEditLast) {
            // Если это чистый edit last — оставляем текст пустым, чтобы активировать Шаг 1 (загрузка в инпут)
            newContent = '';
        } else {
            // Если это редактирование по номеру с текстом — находим позицию ID и забираем ВСЁ, что идет после него
            let idIndex = -1;
            for (let i = 0; i < args.length; i++) {
                if (String(args[i]) === String(targetInnerId)) {
                    idIndex = i;
                    break;
                }
            }

            if (idIndex !== -1) {
                newContent = args.slice(idIndex + 1).join(' ').trim();
            } else {
                // Запасной вариант очистки префиксов, если ID был передан в неявном виде
                let startIndex = 0;
                const entityWords = ['history', 'история', 'історія', 'note', 'notes', 'заметка', 'нотатка', 'task', 'задача', 'timer', 'таймер', 'building', 'постройка'];
                const auxWords = ['number', 'номер', '№', 'id', 'ид'];
                while (startIndex < args.length) {
                    const word = args[startIndex].toLowerCase();
                    if (entityWords.includes(word) || auxWords.includes(word) || word === String(targetInnerId)) {
                        startIndex++;
                    } else {
                        break;
                    }
                }
                newContent = args.slice(startIndex).join(' ').trim();
            }
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

            // 3. ЭТАП 1: Если текст не передан (или это чистый edit last) — загружаем текущий в поле ввода!
            if (!newContent) {
                const prefix = isHistory ? 'edit history' : 'edit note';
                return {
                    response: `📝 Текущий текст ${entityLabel} [${targetInnerId}] загружен в поле ввода. Отредактируйте его и нажмите Enter.`,
                    style: 'output-info',
                    inputValue: `${prefix} ${targetInnerId} ${currentText}`
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
                response: `🟢 ${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} [${targetInnerId}] успешно отредактирована (версия v${insertPayload.version}).`, 
                style: 'output-success',
                editedEntity: isHistory ? 'history' : 'note'
            };

        } catch (err) {
            return { response: `❌ Ошибка редактирования ${entityLabel}: ` + err.message, style: 'output-error' };
        }
    }
});
