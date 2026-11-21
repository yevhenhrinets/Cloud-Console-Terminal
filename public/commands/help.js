// commands/help.js — автоматический справочник по всем командам терминала

CommandRegistry.register({
    names: [
        'commands list', 'show commands', 'show commands list',
        'list commands', 'commands', 'all commands',
        'список команд', 'показать команды', 'команды', 'команди', 'перелік команд'
    ],
    description: 'Выводит список всех доступных команд',
    usage: 'commands list | show commands list',
    category: '🌐 Системные',
    handler: async (parameters, options = {}) => {
        try {
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            if (!(options && options.fromTwoStepBar) && rawArgs) {
                return rejectInlineParamsError(parameters.matchedCmd || 'commands list', '');
            }
            const currentUser = await fetchCurrentUser();
            const isAdmin = typeof window.isAdminUser === 'function'
                ? window.isAdminUser(currentUser)
                : (currentUser && ['root', 'support', 'admin'].includes(currentUser.role));

            const registeredCommands = typeof CommandRegistry.getAll === 'function'
                ? CommandRegistry.getAll()
                : Object.values(CommandRegistry.commands);

            if (!registeredCommands || registeredCommands.length === 0) {
                return { response: '⚠️ Список команд пуст.', style: 'output-error' };
            }

            const uniqueCommandsMap = new Map();
            registeredCommands.forEach(cmd => {
                if (!cmd || !cmd.names) return;
                const names = Array.isArray(cmd.names) ? cmd.names : [cmd.names[0]];
                const primaryName = names[0].toLowerCase();

                if (!uniqueCommandsMap.has(primaryName)) {
                    uniqueCommandsMap.set(primaryName, {
                        names: names,
                        description: cmd.description || 'Описание отсутствует',
                        usage: cmd.usage || primaryName,
                        category: cmd.category || '📦 Основные команды'
                    });
                }
            });

            const categories = {};
            uniqueCommandsMap.forEach(cmd => {
                if (!categories[cmd.category]) {
                    categories[cmd.category] = [];
                }
                categories[cmd.category].push(cmd);
            });

            let helpText = "📚 Доступные команды облачного терминала:\n\n";

            for (const [category, cmds] of Object.entries(categories)) {
                helpText += `**${category}**:\n`;
                cmds.forEach(cmd => {
                    const namesFormatted = cmd.names.map(n => `\`${n}\``).join(', ');
                    const usageStr = cmd.usage ? ` (${cmd.usage})` : '';
                    helpText += `  • ${namesFormatted}${usageStr} — ${cmd.description}\n`;
                });
                helpText += "\n";
            }

            if (isAdmin) {
                helpText += "🔑 **Админ-модификаторы:**\n" +
                    "  • Фильтрация данных: добавьте `of user [UUID]` к командам просмотра\n" +
                    "  • Действия от чужого лица: добавьте `as user [UUID]`\n" +
                    "  • Обращения в поддержку: `reports` / `show issues`";
            }

            return { response: helpText.trim(), style: 'output-info' };
        } catch (err) {
            console.error('Ошибка в списке команд:', err);
            return { response: '❌ Ошибка выполнения commands list: ' + err.message, style: 'output-error' };
        }
    }
});
