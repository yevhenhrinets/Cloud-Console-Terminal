// commands-actions.js — обработчики команд с проверкой авторизации

function parseTargetUser(args) {
    for (let i = 0; i < args.length - 1; i++) {
        const word = args[i].toLowerCase();
        if (['user', 'of', 'as', 'for', 'пользователя', 'користувача'].includes(word)) {
            const targetId = Number(args[i + 1]);
            if (!isNaN(targetId) && targetId > 0) {
                return targetId;
            }
        }
    }
    return null;
}

async function handleAdd(parameters) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    if (parameters.args.length < 2) {
        return { response: 'Ошибка: укажите тип объекта и текст.\nПример: add note Купить молоко', style: 'output-error' };
    }

    const targetUserId = parseTargetUser(parameters.args);
    let effectiveCreatedBy = currentUser.id;

    if (targetUserId) {
        if (['root', 'support'].includes(currentUser.role)) {
            effectiveCreatedBy = targetUserId;
        } else {
            return { response: 'Ошибка: у вас нет прав создавать заметки от имени других пользователей.', style: 'output-error' };
        }
    }

    let cleanTextArgs = [...parameters.args.slice(1)];
    if (targetUserId) {
        cleanTextArgs = cleanTextArgs.filter((arg, idx, arr) => {
            const prev = arr[idx - 1] ? arr[idx - 1].toLowerCase() : '';
            const curr = arg.toLowerCase();
            return !['user', 'as', 'for', 'of', 'пользователя', 'користувача', String(targetUserId)].includes(curr) && prev !== 'user';
        });
    }

    const noteText = cleanTextArgs.join(' ');
    if (!noteText) {
        return { response: 'Ошибка: текст заметки не может быть пустым.', style: 'output-error' };
    }

    try {
        const { error } = await window.supabaseClient
            .from('notes')
            .insert([{ content: noteText, created_by: effectiveCreatedBy }]);

        if (error) throw error;
        return { response: `Заметка сохранена: "${noteText}"`, style: 'output-success' };
    } catch (err) {
        return { response: 'Ошибка сохранения заметки: ' + err.message, style: 'output-error' };
    }
}

async function handleShowNotes(parameters = { args: [] }) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    try {
        const targetUserId = parseTargetUser(parameters.args);

        let query = window.supabaseClient
            .from('notes')
            .select('*')
            .is('deleted_at', null);

        if (['root', 'support'].includes(currentUser.role)) {
            if (targetUserId) {
                query = query.eq('created_by', targetUserId);
            }
        } else {
            query = query.eq('created_by', currentUser.id);
        }

        const { data, error } = await query
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(150);

        if (error) throw error;
        if (!data || data.length === 0) {
            return { response: 'Список заметок пуст.', style: 'output-info' };
        }
        
        // 🧠 ГРУППИРУЕМ ПО inner_id И ОСТАВЛЯЕМ ТОЛЬКО ПОСЛЕДНЮЮ ВЕРСИЮ
        const latestNotesMap = new Map();
        data.forEach(note => {
            // Если такого inner_id еще нет в карте или версия текущей заметки выше — обновляем
            if (!latestNotesMap.has(note.inner_id) || note.version > latestNotesMap.get(note.inner_id).version) {
                latestNotesMap.set(note.inner_id, note);
            }
        });
        
        // Превращаем карту обратно в массив и сортируем по inner_id (или дате) от новых к старым
        const activeNotes = Array.from(latestNotesMap.values()).sort((a, b) => b.inner_id - a.inner_id);

        const resText = "Ваши последние заметки:\n" + 
            activeNotes.map(row => {
                const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                const pinMark = row.is_pinned ? '📌 ' : '';
                // Показываем пометку версии, только если она больше 1 (были правки)
                const versionStr = row.version > 1 ? ` (v${row.version})` : '';
                return `${pinMark}[ID: ${row.inner_id}] [${timeStr}]${versionStr} ${row.content}`;
            }).join('\n');

        return { response: resText, style: 'output-info' };
    } catch (err) {
        return { response: 'Ошибка загрузки заметок: ' + err.message, style: 'output-error' };
    }
}

async function handlePin(parameters, isPin = true) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    const validIds = extractNumericIds(parameters.args);
    const plurality = checkPlurality(parameters.args);

    if (validIds.length === 0) {
        const actionName = isPin ? 'pin' : 'unpin';
        return { response: `Ошибка: укажите ID заметок.\nПример: ${actionName} note number 3`, style: 'output-error' };
    }

    if (plurality === 'singular' && validIds.length > 1) {
        return { 
            response: `⚠️ ПРЕДУПРЕЖДЕНИЕ: Использовано единственное число 'note', но указано несколько ID (${validIds.join(', ')}).\nКоманда не выполнена.`, 
            style: 'output-error', 
            skipHistorySave: true 
        };
    }

    try {
        let query = window.supabaseClient
            .from('notes')
            .select('id, is_pinned, created_by')
            .in('id', validIds)
            .is('deleted_at', null);

        if (!['root', 'support'].includes(currentUser.role)) {
            query = query.eq('created_by', currentUser.id);
        }

        const { data: existingNotes, error: fetchError } = await query;
        if (fetchError) throw fetchError;

        if (!existingNotes || existingNotes.length === 0) {
            return { response: `Заметки не найдены или у вас нет доступа.`, style: 'output-error' };
        }

        const targetIds = existingNotes.filter(n => n.is_pinned !== isPin).map(n => n.id);
        const isMultiple = validIds.length > 1;
        const noteWord = isMultiple ? 'Заметки' : 'Заметка';

        if (targetIds.length === 0) {
            const statusWord = isPin ? (isMultiple ? 'уже закреплены' : 'уже закреплена') : (isMultiple ? 'уже откреплены' : 'уже откреплена');
            return { response: `${noteWord} с ID [${validIds.join(', ')}] ${statusWord}.`, style: 'output-info', noChange: true };
        }

        const { error } = await window.supabaseClient
            .from('notes')
            .update({ is_pinned: isPin, updated_by: currentUser.id })
            .in('id', targetIds);

        if (error) throw error;
        const actionText = isPin ? (isMultiple ? 'закреплены сверху' : 'закреплена сверху') : (isMultiple ? 'откреплены' : 'откреплена');
        return { response: `${noteWord} с ID [${targetIds.join(', ')}] ${actionText}.`, style: 'output-success', editedEntity: 'note' };
    } catch (err) {
        return { response: 'Ошибка операции: ' + err.message, style: 'output-error' };
    }
}

async function handleDel(parameters) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    const firstArg = parameters.args[0] ? parameters.args[0].toLowerCase() : '';
    const historyEntities = ['history', 'историю', 'история', 'історію', 'історія'];
    const targetTable = historyEntities.includes(firstArg) ? 'commands_history' : 'notes';

    const validIds = extractNumericIds(parameters.args);
    const plurality = checkPlurality(parameters.args);

    if (validIds.length === 0) {
        return { response: 'Ошибка: укажите ID для удаления.', style: 'output-error' };
    }

    if (plurality === 'singular' && validIds.length > 1) {
        return { response: `⚠️ ПРЕДУПРЕЖДЕНИЕ: Использовано единственное число 'note', но указано несколько ID.\nУдаление отменено.`, style: 'output-error', skipHistorySave: true };
    }

    try {
        const nowIso = new Date().toISOString();

        let query = window.supabaseClient
            .from(targetTable)
            .update({ deleted_at: nowIso, deleted_by: currentUser.id })
            .in('id', validIds);

        // Что делают эти 3 строки?
        if (!['root', 'support'].includes(currentUser.role)) {
            query = query.eq('created_by', currentUser.id);
        }

        const { error } = await query;
        if (error) throw error;

        const isMultiple = validIds.length > 1;
        const entityNameRu = targetTable === 'notes' ? (isMultiple ? 'заметки' : 'заметка') : (isMultiple ? 'записи истории' : 'запись истории');

        return { response: `Успешно скрыта (${entityNameRu}) с ID: [${validIds.join(', ')}].`, style: 'output-success', editedEntity: targetTable === 'notes' ? 'note' : 'history' };
    } catch (err) {
        return { response: 'Ошибка удаления: ' + err.message, style: 'output-error' };
    }
}

async function handleRes(parameters) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    const firstArg = parameters.args[0] ? parameters.args[0].toLowerCase() : '';
    const historyEntities = ['history', 'историю', 'история', 'історію', 'історія'];
    const targetTable = historyEntities.includes(firstArg) ? 'commands_history' : 'notes';

    const validIds = extractNumericIds(parameters.args);
    const plurality = checkPlurality(parameters.args);

    if (validIds.length === 0) {
        return { response: 'Ошибка: укажите ID для восстановления.', style: 'output-error' };
    }

    if (plurality === 'singular' && validIds.length > 1) {
        return { response: `⚠️ ПРЕДУПРЕЖДЕНИЕ: Использовано единственное число 'note', но указано несколько ID.\nВосстановление отменено.`, style: 'output-error', skipHistorySave: true };
    }

    try {
        const nowIso = new Date().toISOString();

        let query = window.supabaseClient
            .from(targetTable)
            .update({
                restored_at: nowIso,
                restored_by: currentUser.id,
                deleted_at: null
            })
            .in('id', validIds);

        // Что делают эти 3 строки кода
        if (!['root', 'support'].includes(currentUser.role)) {
            query = query.eq('created_by', currentUser.id);
        }

        const { error } = await query;
        if (error) throw error;

        const isMultiple = validIds.length > 1;
        const entityNameRu = targetTable === 'notes' ? (isMultiple ? 'заметки' : 'заметка') : (isMultiple ? 'записи истории' : 'запись истории');

        return { response: `Успешно восстановлена (${entityNameRu}) с ID: [${validIds.join(', ')}].`, style: 'output-success', editedEntity: targetTable === 'notes' ? 'note' : 'history' };
    } catch (err) {
        return { response: 'Ошибка восстановления: ' + err.message, style: 'output-error' };
    }
}

async function handleEdit(parameters) {
    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
        return { response: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.', style: 'output-error' };
    }

    if (parameters.args.length < 2) {
        return { response: 'Ошибка: неверный формат.\nПример: edit note number 3 Новый текст', style: 'output-error' };
    }

    const firstArg = parameters.args[0].toLowerCase();
    const historyEntities = ['history', 'историю', 'история', 'історію', 'історія'];
    const editTargetTable = historyEntities.includes(firstArg) ? 'commands_history' : 'notes';

    const validIds = extractNumericIds(parameters.args);
    const editIdStr = validIds[0];

    let newText = '';
    if (editIdStr) {
        const idIndex = parameters.args.findIndex(arg => Number(arg) === editIdStr);
        if (idIndex !== -1) {
            newText = parameters.args.slice(idIndex + 1).join(' ');
        }
    }

    if (!editIdStr || !newText) {
        return { response: 'Ошибка: проверьте ID и новый текст.', style: 'output-error' };
    }

    try {
        const nowIso = new Date().toISOString();
        let updateData = { updated_by: currentUser.id, updated_at: nowIso };

        if (editTargetTable === 'notes') {
            updateData.content = newText;
        } else {
            const parsedNewCmd = parseCommand(newText);
            updateData.command = parsedNewCmd.cmd;
            updateData.parameters = parsedNewCmd.parameters;
        }

        let query = window.supabaseClient
            .from(editTargetTable)
            .update(updateData)
            .eq('id', Number(editIdStr));

        if (!['root', 'support'].includes(currentUser.role)) {
            query = query.eq('created_by', currentUser.id);
        }

        const { error } = await query;
        if (error) throw error;

        return { response: `Успешно обновлена запись с ID [${editIdStr}].`, style: 'output-success', editedEntity: editTargetTable === 'notes' ? 'note' : 'history' };
    } catch (err) {
        return { response: 'Ошибка обновления: ' + err.message, style: 'output-error' };
    }
}
