// commands.js — универсальный диспетчер с поддержкой 2/3-словных команд (включая go to ...)

async function processCommand(rawText, options = {}) {
    const cleanRaw = String(rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');

    let lookupKey = cleanRaw;
    let parsed = parseCommand(rawText);

    // 1. Сначала проверяем точное совпадение всей строки (напр. "who am i", "go to missions", "trash notes")
    if (window.CommandRegistry.getHandler(lookupKey)) {
        // Оставляем lookupKey как есть
    } else {
        // 2. Используем команду из parseCommand (которая уже проверяет 3-словные и 2-словные команды)
        lookupKey = parsed.cmd.toLowerCase();

        if (!window.CommandRegistry.getHandler(lookupKey)) {
            if (parsed.parameters.args.length >= 2) {
                const threeWordKey = lookupKey + ' ' + parsed.parameters.args[0].toLowerCase() + ' ' + parsed.parameters.args[1].toLowerCase();
                if (window.CommandRegistry.getHandler(threeWordKey)) {
                    lookupKey = threeWordKey;
                }
            }
            if (!window.CommandRegistry.getHandler(lookupKey) && parsed.parameters.args.length >= 1) {
                const twoWordKey = lookupKey + ' ' + parsed.parameters.args[0].toLowerCase();
                if (window.CommandRegistry.getHandler(twoWordKey)) {
                    lookupKey = twoWordKey;
                }
            }
        }
    }

    const parameters = { ...parsed.parameters, matchedCmd: lookupKey };
    const handler = window.CommandRegistry.getHandler(lookupKey);

    let response = '';
    let style = '';
    let action = null;
    let editedEntity = null;
    let skipHistorySave = false;
    let inputValue = null;
    let commandPrefix = null;
    let commandSteps = null;
    let inputPlaceholder = null;
    let isHtml = false;
    let houseMutation = null;

    if (!handler) {
        response = `Команда не найдена: '${String(rawText || '').trim()}'. Введите 'commands list' для списка команд или 'support' для обращения в поддержку.`;
        style = 'output-error';
    } else {
        try {
            const res = await handler(parameters, options);
            if (res) {
                response = res.response || '';
                style = res.style || '';
                action = res.action || null;
                editedEntity = res.editedEntity || null;
                skipHistorySave = res.skipHistorySave || false;
                inputValue = (res.inputValue !== undefined && res.inputValue !== null) ? res.inputValue : null;
                commandPrefix = res.commandPrefix || null;
                commandSteps = Array.isArray(res.commandSteps) ? res.commandSteps : null;
                inputPlaceholder = res.inputPlaceholder || null;
                isHtml = Boolean(res.isHtml);
                houseMutation = res.houseMutation || null;
            }
        } catch (err) {
            console.error('Ошибка выполнения команды:', err);
            response = `❌ Ошибка выполнения команды: ${err.message || err}`;
            style = 'output-error';
        }
    }

    const status = style === 'output-error' ? 'failure' : 'success';
    const consoleResultLog = `[${status.toUpperCase()}] ${response}`;

    if (!skipHistorySave) {
        await saveToCloud(rawText, parsed.cmd, parameters, response, consoleResultLog, status);
    }

    return { response, style, action, editedEntity, inputValue, commandPrefix, commandSteps, inputPlaceholder, isHtml, houseMutation };
}

if (typeof window !== 'undefined') {
    window.processCommand = processCommand;
}
