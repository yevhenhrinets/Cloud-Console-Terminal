// registry.js — реестр команд (ядро плагинов)

window.CommandRegistry = {
    commands: {},
    aliases: {},

    // Регистрация новой команды
    register(config) {
        // config = { names: ['help', 'помощь'], description: '...', category: '...', handler: async (...) => {} }
        if (!config.names || !config.handler) return;

        const primaryName = config.names[0].toLowerCase();
        
        // 💡 Сохраняем весь объект конфига целиком (включая описание, категорию и обработчик)
        this.commands[primaryName] = config;

        // Регистрируем все синонимы/алиасы
        config.names.forEach(name => {
            this.aliases[name.toLowerCase()] = primaryName;
        });
    },

    // Поиск обработчика по имени или алиасу
    getHandler(cmdName) {
        const canonicalName = this.aliases[cmdName.toLowerCase()];
        const cmdConfig = canonicalName ? this.commands[canonicalName] : null;
        // Возвращаем только handler для выполнения
        return cmdConfig ? cmdConfig.handler : null;
    },

    // Возвращает массив всех зарегистрированных конфигов команд (нужно для help)
    getAll() {
        return Object.values(this.commands);
    }
};
