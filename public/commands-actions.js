// commands-actions.js — обработчики команд с поддержкой Demo-режима и Supabase

const DEMO_NOTES_KEY = 'terminal_demo_notes_store';

function getDemoNotes() {
    let saved = localStorage.getItem(DEMO_NOTES_KEY);
    if (!saved) {
        const initial = [
            { id: 1, inner_id: 1, content: 'Ласкаво просимо в Cloud Terminal! Всі команди активовані.', is_pinned: true, created_at: new Date(Date.now() - 3600000).toISOString(), version: 1 },
            { id: 2, inner_id: 2, content: 'Спробуйте: commands list, support, show date, home 1, home 2, home 3', is_pinned: false, created_at: new Date(Date.now() - 1800000).toISOString(), version: 1 },
            { id: 3, inner_id: 3, content: 'Додайте нову нотатку у 2 етапи: введіть write note або add note', is_pinned: false, created_at: new Date(Date.now() - 600000).toISOString(), version: 1 }
        ];
        localStorage.setItem(DEMO_NOTES_KEY, JSON.stringify(initial));
        return initial;
    }
    try {
        return JSON.parse(saved);
    } catch (e) {
        return [];
    }
}

function saveDemoNotes(notes) {
    localStorage.setItem(DEMO_NOTES_KEY, JSON.stringify(notes));
}

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
        return { response: 'Помилка: не вдалося ініціалізувати користувача.', style: 'output-error' };
    }

    if (parameters.args.length < 2) {
        return { response: 'Помилка: вкажіть тип і текст.\nПриклад: `add note Купити молоко` або `Add mission Розвесить стирку`', style: 'output-error' };
    }

    const firstArg = parameters.args[0].toLowerCase();
    if (['mission', 'missions', 'миссия', 'миссию', 'задание', 'поручение', 'поручення', 'дело'].includes(firstArg)) {
        const missionText = parameters.args.slice(1).join(' ').trim();
        if (!missionText) {
            return { response: '❌ Вкажіть текст доручення.\nПриклад: `Add mission Розвесить стирку`', style: 'output-error' };
        }
        if (window.MissionsStore) {
            const m = await window.MissionsStore.addMission(missionText, currentUser.id);
            return {
                response: `🟢 Поручення збережено!\n📋 [#${m.position}] "${m.title}"\n⏱️ Фіксація: ${m.created_display}\n🔗 Відкрийте сторінку завдань: /missions.html`,
                style: 'output-success'
            };
        }
    }

    const noteText = parameters.args.slice(1).join(' ');
    if (!noteText.trim()) {
        return { response: 'Помилка: текст нотатки не може бути порожнім.', style: 'output-error' };
    }

    // Демо-режим (Гість)
    if (currentUser.isGuest) {
        const notes = getDemoNotes();
        const nextId = notes.length > 0 ? Math.max(...notes.map(n => n.id || 0)) + 1 : 1;
        notes.push({
            id: nextId,
            inner_id: nextId,
            content: noteText,
            is_pinned: false,
            created_at: new Date().toISOString(),
            version: 1
        });
        saveDemoNotes(notes);
        return { response: `🟢 Замітка збережена [ID: ${nextId}]: "${noteText}"`, style: 'output-success' };
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
        return { response: 'Помилка: не вдалося завантажити профіль.', style: 'output-error' };
    }

    // Демо-режим (Гість)
    if (currentUser.isGuest) {
        const notes = getDemoNotes();
        if (!notes || notes.length === 0) {
            return { response: 'Список заміток порожній. Додайте першу: `add note Мій текст`', style: 'output-info' };
        }
        // Сортуємо: закріплені вгорі, далі по ID спадно
        notes.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            return (b.id || 0) - (a.id || 0);
        });

        const resText = "📝 Ваші нотатки (Демо/Offline):\n" + 
            notes.map(row => {
                const pinMark = row.is_pinned ? '📌 ' : '';
                return `${pinMark}[ID: ${row.id}] ${row.content}`;
            }).join('\n');

        return { response: resText, style: 'output-info' };
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
        
        const latestNotesMap = new Map();
        data.forEach(note => {
            if (!latestNotesMap.has(note.inner_id) || note.version > latestNotesMap.get(note.inner_id).version) {
                latestNotesMap.set(note.inner_id, note);
            }
        });
        
        const activeNotes = Array.from(latestNotesMap.values()).sort((a, b) => b.inner_id - a.inner_id);

        const resText = "Ваши последние заметки:\n" + 
            activeNotes.map(row => {
                const timeStr = row.updated_at ? `ред: ${formatDate(row.updated_at)}` : formatDate(row.created_at);
                const pinMark = row.is_pinned ? '📌 ' : '';
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
        return { response: 'Помилка: користувач не визначений.', style: 'output-error' };
    }

    const validIds = extractNumericIds(parameters.args);
    const plurality = checkPlurality(parameters.args);

    if (validIds.length === 0) {
        const actionName = isPin ? 'pin' : 'unpin';
        return { response: `Вкажіть ID нотатки.\nПриклад: ${actionName} note 1`, style: 'output-error' };
    }

    // Демо-режим
    if (currentUser.isGuest) {
        const notes = getDemoNotes();
        let changed = false;
        notes.forEach(n => {
            if (validIds.includes(Number(n.id))) {
                n.is_pinned = isPin;
                changed = true;
            }
        });
        if (changed) {
            saveDemoNotes(notes);
            return { response: `🟢 Нотатку з ID [${validIds.join(', ')}] ${isPin ? 'закріплено зверху' : 'відкріплено'}.`, style: 'output-success' };
        } else {
            return { response: `Нотатку з ID [${validIds.join(', ')}] не знайдено.`, style: 'output-error' };
        }
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
        return { response: 'Помилка: користувач не визначений.', style: 'output-error' };
    }

    const firstArg = parameters.args[0] ? parameters.args[0].toLowerCase() : '';
    const historyEntities = ['history', 'историю', 'история', 'історію', 'історія'];
    const targetTable = historyEntities.includes(firstArg) ? 'commands_history' : 'notes';

    const validIds = extractNumericIds(parameters.args);
    const plurality = checkPlurality(parameters.args);

    if (validIds.length === 0) {
        return { response: 'Вкажіть ID для видалення.\nПриклад: del note 1', style: 'output-error' };
    }

    // Демо-режим
    if (currentUser.isGuest) {
        let notes = getDemoNotes();
        const before = notes.length;
        notes = notes.filter(n => !validIds.includes(Number(n.id)));
        if (notes.length < before) {
            saveDemoNotes(notes);
            return { response: `🗑️ Успішно видалено нотатку з ID: [${validIds.join(', ')}].`, style: 'output-success' };
        } else {
            return { response: `Нотатку з ID: [${validIds.join(', ')}] не знайдено.`, style: 'output-error' };
        }
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
