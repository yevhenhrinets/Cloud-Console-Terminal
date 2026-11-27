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

    // Генерация вариантов с удалением только лексически и фонетически корректных артиклей (a / an / the)
    generateArticleNormalizedCandidates(cmdLower) {
        const tokens = String(cmdLower || '').trim().split(/\s+/).filter(Boolean);
        if (tokens.length < 2) return [];

        const isPairOk = (art, nextWord, rest) => {
            if (typeof window !== 'undefined' && typeof window.isValidEnglishArticlePair === 'function') {
                return window.isValidEnglishArticlePair(art, nextWord, rest);
            }
            if (art === 'the') return true;
            if (art === 'an') return /^[aeiou]/i.test(nextWord) && !/^(?:user|unit|uni|use|euro|one)/i.test(nextWord);
            if (art === 'a') return !/^[aeiou]/i.test(nextWord) || /^(?:user|unit|uni|use|euro|one)/i.test(nextWord);
            return false;
        };

        // Не удаляем артикль сразу после 'go' без предлога 'to' (например, 'go the home' недопустимо)
        const stripped = [];
        let removedCount = 0;
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if ((tok === 'a' || tok === 'an' || tok === 'the') && i + 1 < tokens.length) {
                if (tokens[0] === 'go' && i === 1) {
                    return [];
                }
                const nextTok = tokens[i + 1];
                const rest = tokens.slice(i + 2);
                if (!isPairOk(tok, nextTok, rest)) {
                    return [];
                }
                removedCount++;
                continue;
            }
            stripped.push(tok);
        }

        if (removedCount === 0 || stripped.length === 0) return [];
        return [stripped.join(' ')];
    },

    // Возвращает каноническое имя команды по имени или алиасу
    resolveName(cmdName) {
        if (!cmdName) return null;
        const lower = String(cmdName).trim().toLowerCase();
        if (this.aliases[lower]) {
            return this.aliases[lower];
        }
        const candidates = this.generateArticleNormalizedCandidates(lower);
        for (const cand of candidates) {
            if (this.aliases[cand]) {
                return this.aliases[cand];
            }
        }
        return null;
    },

    // Проверка существования имени/алиаса
    hasAlias(cmdName) {
        return Boolean(this.resolveName(cmdName));
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
