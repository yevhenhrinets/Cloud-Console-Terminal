// commands/aliases.js — трёхсложные команды Add alias и Add aliases (3 этапа)

(function () {
    function formatBaseLabel(matchedCmd, isPlural) {
        const lower = String(matchedCmd || '').trim().toLowerCase();
        if (lower.startsWith('add aliases') || lower === 'create aliases' || lower === 'new aliases') return 'Add aliases';
        if (lower.startsWith('add alias') || lower.startsWith('add an alias') || lower === 'create alias' || lower === 'new alias') return 'Add alias';
        if (!lower) return isPlural ? 'Add aliases' : 'Add alias';
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    async function handleAliasCommand(parameters, options = {}, isPlural = false) {
        const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
        if (!currentUser) {
            return { response: typeof t === 'function' ? t('not_authorized') : 'Ошибка авторизации.', style: 'output-error' };
        }

        const matchedCmd = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : (isPlural ? 'add aliases' : 'add alias');
        const baseLabel = formatBaseLabel(matchedCmd, isPlural);
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

        // Шаг 1: запрещаем ввод аргументов в одну строку без пошаговой панели
        if (!options || !options.fromTwoStepBar) {
            if (rawArgs) {
                return {
                    response: `⚠️ Команда \`${baseLabel}\` работает строго в 3 этапа!\n1) Введите \`${baseLabel}\` без параметров\n2) Укажите существующую команду (например: \`ls\`)\n3) Укажите ${isPlural ? 'новые синонимы через запятую' : 'новый псевдоним (например: Directories)'}.`,
                    style: 'output-error'
                };
            }

            return {
                response: `🧩 ${baseLabel} (Шаг 1/3): введите название существующей команды (например: ls, cd, Fs Export, Find directory) и нажмите Enter или ✅.`,
                style: 'output-info',
                commandSteps: [baseLabel],
                inputValue: '',
                inputPlaceholder: 'Шаг 2/3: существующая команда (напр. ls)...'
            };
        }

        const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [];
        const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

        // Шаг 2: получили имя существующей команды, переходим к шагу 3
        if (steps.length <= 1) {
            if (!payload) {
                return {
                    response: '⚠️ Введите название существующей команды (например: ls).',
                    style: 'output-error',
                    commandSteps: [steps[0] || baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Шаг 2/3: существующая команда (напр. ls)...'
                };
            }

            const canonicalTarget = window.CommandRegistry && typeof window.CommandRegistry.resolveName === 'function'
                ? window.CommandRegistry.resolveName(payload)
                : null;

            if (!canonicalTarget) {
                return {
                    response: `❌ Команда "${payload}" не найдена в реестре. Введите существующую команду (например: ls, cd, Fs Export, Help).`,
                    style: 'output-error',
                    commandSteps: [steps[0] || baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Шаг 2/3: существующая команда...'
                };
            }

            const step3Hint = isPlural
                ? 'введите новые псевдонимы через запятую (например: Export file system, Download all files, Save project)'
                : 'введите новый псевдоним (например: Directories)';

            return {
                response: `🧩 Выбрана команда "${payload}" (каноническое имя: \`${canonicalTarget}\`). Шаг 2/3 выполнен!\n✏️ Теперь ${step3Hint} и нажмите Enter или ✅.`,
                style: 'output-info',
                commandSteps: [steps[0] || baseLabel, payload],
                inputValue: '',
                inputPlaceholder: isPlural
                    ? 'Шаг 3/3: синонимы через запятую...'
                    : 'Шаг 3/3: новый псевдоним...'
            };
        }

        // Шаг 3: применяем новый псевдоним (или список через запятую) к команде из шага 2
        const targetLabel = String(steps[1] || '').trim();
        const canonicalTarget = window.CommandRegistry && typeof window.CommandRegistry.resolveName === 'function'
            ? window.CommandRegistry.resolveName(targetLabel)
            : null;

        if (!canonicalTarget) {
            return {
                response: `❌ Целевая команда "${targetLabel}" больше не найдена.`,
                style: 'output-error'
            };
        }

        const aliasList = isPlural
            ? payload.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
            : [payload.trim().replace(/\s+/g, ' ')].filter(Boolean);

        if (aliasList.length === 0) {
            return {
                response: isPlural
                    ? '⚠️ Укажите хотя бы один псевдоним (можно через запятую).'
                    : '⚠️ Введите название нового псевдонима.',
                style: 'output-error',
                commandSteps: steps,
                inputValue: '',
                inputPlaceholder: isPlural ? 'Шаг 3/3: синонимы через запятую...' : 'Шаг 3/3: новый псевдоним...'
            };
        }

        const res = window.CommandRegistry.addAliases(canonicalTarget, aliasList);
        const toPersist = [...res.added, ...res.alreadyLinked];

        let synced = false;
        if (toPersist.length > 0 && window.CustomAliasesSync && typeof window.CustomAliasesSync.saveCustomAliases === 'function') {
            try {
                const saveRes = await window.CustomAliasesSync.saveCustomAliases(canonicalTarget, toPersist, currentUser);
                synced = Boolean(saveRes && saveRes.synced);
            } catch (e) {}
        }

        if (res.added.length === 0 && res.alreadyLinked.length === 0 && res.conflicts.length > 0) {
            const conflictStr = res.conflicts.map(c => `"${c.alias}" (уже занят командой \`${c.owner}\`)`).join(', ');
            return {
                response: `❌ Не удалось добавить псевдоним: ${conflictStr}.\n✏️ Введите другое название или нажмите ✕ на шаге для возврата.`,
                style: 'output-error',
                commandSteps: steps,
                inputValue: '',
                inputPlaceholder: isPlural ? 'Шаг 3/3: другие синонимы...' : 'Шаг 3/3: другой псевдоним...'
            };
        }

        const parts = [];
        if (res.added.length > 0) {
            parts.push(`🟢 Для команды \`${targetLabel}\` (\`${canonicalTarget}\`) добавлены новые псевдонимы:\n  • ${res.added.map(a => `\`${a}\``).join(', ')}`);
        }
        if (res.alreadyLinked.length > 0) {
            parts.push(`ℹ️ Уже привязаны к \`${canonicalTarget}\`: ${res.alreadyLinked.map(a => `\`${a}\``).join(', ')}`);
        }
        if (res.conflicts.length > 0) {
            parts.push(`⚠️ Пропущены конфликты: ${res.conflicts.map(c => `"${c.alias}" (занято \`${c.owner}\`)`).join(', ')}`);
        }
        if (toPersist.length > 0) {
            const syncMsg = synced
                ? '💾 Сохранено локально и синхронизировано с БД!'
                : '💾 Сохранено локально (синхронизируется с БД при подключении и авторизации).';
            parts.push(syncMsg);
        }

        return {
            response: parts.join('\n'),
            style: 'output-success'
        };
    }

    CommandRegistry.register({
        names: [
            'add alias', 'add an alias', 'add alias for the command', 'add alias for command', 'add an alias for the command',
            'create alias', 'new alias', 'добавить псевдоним', 'добавить алиас'
        ],
        description: 'Добавить псевдоним к существующей команде (строго в 3 этапа)',
        category: '🌐 Системные',
        usage: 'Add alias -> <команда> -> <псевдоним>',
        handler: async (parameters, options = {}) => {
            return await handleAliasCommand(parameters, options, false);
        }
    });

    CommandRegistry.register({
        names: [
            'add aliases', 'add aliases for the command', 'add aliases for command',
            'create aliases', 'new aliases', 'добавить псевдонимы', 'добавить алиасы'
        ],
        description: 'Добавить несколько псевдонимов через запятую к одной команде (строго в 3 этапа)',
        category: '🌐 Системные',
        usage: 'Add aliases -> <команда> -> <алиас 1, алиас 2, ...>',
        handler: async (parameters, options = {}) => {
            return await handleAliasCommand(parameters, options, true);
        }
    });
})();
