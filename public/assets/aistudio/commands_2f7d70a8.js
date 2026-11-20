// commands.js — универсальный диспетчер с поддержкой multi-word команд и inputValue

async function processCommand(rawText) {
    const cleanRaw = rawText.trim().toLowerCase();
    
    let lookupKey = cleanRaw;
    let parsed = parseCommand(rawText);

    // 1. Сначала проверяем, не является ли весь ввод точной многословной командой (например, "who am i", "trash notes")
    if (window.CommandRegistry.getHandler(lookupKey)) {
        // Оставляем lookupKey как есть
    } else {
        // 2. Если нет, используем стандартную команду из parsed.cmd
        lookupKey = parsed.cmd.toLowerCase();

        // Проверяем двухсловные команды (например, "show notes", "show history")
        if (parsed.parameters.args.length > 0) {
            const twoWordKey = lookupKey + ' ' + parsed.parameters.args[0].toLowerCase();
            if (window.CommandRegistry.getHandler(twoWordKey)) {
                lookupKey = twoWordKey;
            }
        }
    }

    const parameters = parsed.parameters;
    const handler = window.CommandRegistry.getHandler(lookupKey);

    let response = '';
    let style = '';
    let action = null;
    let editedEntity = null;
    let skipHistorySave = false;
    let inputValue = null; // 👈 Переменная для перехвата подстановки в инпут

    if (!handler) {
        response = `Команда не найдена: '${rawText.trim()}'. Введите 'help' для справки.`;
        style = 'output-error';
    } else {
        const res = await handler(parameters);
        if (res) {
            response = res.response || '';
            style = res.style || '';
            action = res.action || null;
            editedEntity = res.editedEntity || null;
            skipHistorySave = res.skipHistorySave || false;
            inputValue = res.inputValue || null; // 👈 Забираем inputValue из плагина
        }
    }

    const status = style === 'output-error' ? 'failure' : 'success';
    const consoleResultLog = `[${status.toUpperCase()}] ${response}`;

    // Сохраняем в историю то, что ввел пользователь
    if (!skipHistorySave) {
        await saveToCloud(rawText, parsed.cmd, parameters, response, consoleResultLog, status);
    }

    return { response, style, action, editedEntity, inputValue }; // 👈 Возвращаем inputValue наружу!
}
