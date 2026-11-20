// commands/help.js — автоматический справочник по всем командам терминала

CommandRegistry.register({
    names: ['help', 'помощь', 'допомога', '?', 'с чего начать?', 'помогите', 'допоможіть'],
    description: 'Выводит список всех доступных команд',
    usage: 'help [название_команды]',
    category: '🌐 Системные',
    handler: async (parameters) => {
        try {
            const currentUser = await fetchCurrentUser();
            const isAdmin = currentUser && ['root', 'support'].includes(currentUser.role);

            // Получаем все зарегистрированные команды через новый метод getAll()
            const registeredCommands = typeof CommandRegistry.getAll === 'function' 
                ? CommandRegistry.getAll() 
                : Object.values(CommandRegistry.commands);

            if (!registeredCommands || registeredCommands.length === 0) {
                return { response: '⚠️ Список команд пуст.', style: 'output-error' };
            }

            // Убираем дубликаты по первому имени
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

            // Группируем по категориям
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
                    "  • Действия от чужого лица: добавьте `as user [UUID]`";
            }

            return { response: helpText.trim(), style: 'output-info' };
        } catch (err) {
            console.error('Ошибка в справке help:', err);
            return { response: '❌ Ошибка выполнения help: ' + err.message, style: 'output-error' };
        }
    }
});

