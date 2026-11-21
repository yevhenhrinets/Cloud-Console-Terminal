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

    // Возвращает каноническое имя команды по имени или алиасу
    resolveName(cmdName) {
        if (!cmdName) return null;
        return this.aliases[String(cmdName).trim().toLowerCase()] || null;
    },

    // Проверка существования имени/алиаса
    hasAlias(cmdName) {
        if (!cmdName) return false;
        return Boolean(this.aliases[String(cmdName).trim().toLowerCase()]);
    },

    // Динамическое добавление одного или нескольких алиасов к существующей команде
    addAliases(targetCmdName, newAliases = []) {
        const canonical = this.resolveName(targetCmdName);
        if (!canonical || !this.commands[canonical]) {
            return { ok: false, error: 'TARGET_NOT_FOUND', added: [], alreadyLinked: [], conflicts: [] };
        }

        const cmdConfig = this.commands[canonical];
        if (!Array.isArray(cmdConfig.names)) {
            cmdConfig.names = [canonical];
        }

        const added = [];
        const alreadyLinked = [];
        const conflicts = [];

        const rawList = Array.isArray(newAliases) ? newAliases : [newAliases];
        for (const rawAlias of rawList) {
            const clean = String(rawAlias || '').trim().replace(/\s+/g, ' ');
            const lower = clean.toLowerCase();
            if (!lower) continue;

            const existingOwner = this.aliases[lower];
            if (existingOwner) {
                if (existingOwner === canonical) {
                    if (!alreadyLinked.includes(lower)) alreadyLinked.push(lower);
                } else {
                    conflicts.push({ alias: clean, owner: existingOwner });
                }
                continue;
            }

            this.aliases[lower] = canonical;
            if (!cmdConfig.names.some(n => String(n).toLowerCase() === lower)) {
                cmdConfig.names.push(clean);
            }
            added.push(clean);
        }

        return { ok: true, canonical, added, alreadyLinked, conflicts };
    },

    // Поиск обработчика по имени или алиасу
    getHandler(cmdName) {
        const canonicalName = this.resolveName(cmdName);
        const cmdConfig = canonicalName ? this.commands[canonicalName] : null;
        // Возвращаем только handler для выполнения
        return cmdConfig ? cmdConfig.handler : null;
    },

    // Возвращает массив всех зарегистрированных конфигов команд (нужно для help)
    getAll() {
        return Object.values(this.commands);
    }
};
