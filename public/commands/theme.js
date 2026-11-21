// commands/theme.js — переключение тем оформления (Dark / Light)

CommandRegistry.register({
    names: [
        'toggle theme', 'change the topic', 'change topic', 'toggle topic',
        'theme', 'тема',
        'theme light', 'theme dark', 'theme toggle',
        'select light theme', 'select dark theme',
        'choose light theme', 'choose dark theme',
        'change theme on light one', 'change theme on dark one',
        'change theme to light', 'change theme to dark',
        'светлая тема', 'темная тема', 'тема светлая', 'тема темная',
        'переключить тему', 'сменить тему'
    ],
    description: 'Переключение темы оформления (светлая / тёмная)',
    category: 'UI',
    usage: 'toggle theme | change the topic | theme light | theme dark | theme -> <light|dark|toggle>',

    handler: async (parameters, options = {}) => {
        const rawText = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim().toLowerCase();
        const fullCmd = (parameters && (parameters.matchedCmd || parameters.cmd) ? String(parameters.matchedCmd || parameters.cmd) : '').trim().toLowerCase();

        if (!(options && options.fromTwoStepBar) && rawText) {
            return rejectInlineParamsError(fullCmd === 'тема' ? 'тема' : 'theme', 'light');
        }

        const currentTheme = (typeof window.getCurrentTheme === 'function')
            ? window.getCurrentTheme()
            : (localStorage.getItem('terminal_theme') || 'dark');

        const isBareGeneric = (fullCmd === 'theme' || fullCmd === 'тема') && !rawText;
        if (isBareGeneric) {
            const themeNameStr = currentTheme === 'light' ? '☀️ Светлая (Light)' : '🌙 Тёмная (Dark Blue)';
            return {
                response: `🎨 Текущая тема оформления: ${themeNameStr}\nВведите \`light\`, \`dark\` или \`toggle\` и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: fullCmd,
                inputValue: '',
                inputPlaceholder: 'light, dark или toggle...'
            };
        }

        const combined = `${fullCmd} ${rawText}`.trim();
        let targetTheme = null;

        if (combined.includes('light') || combined.includes('светл') || combined.includes('бел')) {
            targetTheme = 'light';
        } else if (combined.includes('dark') || combined.includes('темн') || combined.includes('чёрн') || combined.includes('черн')) {
            targetTheme = 'dark';
        } else if (combined.includes('toggle') || combined.includes('переключ') || combined.includes('смен') || combined.includes('topic')) {
            targetTheme = (currentTheme === 'light') ? 'dark' : 'light';
        } else {
            return {
                response: `❌ Неизвестная тема "${rawText}". Введите \`light\`, \`dark\` или \`toggle\`.`,
                style: 'output-error'
            };
        }

        if (typeof window.applyTheme === 'function') {
            await window.applyTheme(targetTheme);
        } else {
            document.documentElement.setAttribute('data-theme', targetTheme);
            document.body.classList.toggle('theme-light', targetTheme === 'light');
            localStorage.setItem('terminal_theme', targetTheme);
        }

        const isLight = targetTheme === 'light';
        const msg = isLight
            ? '☀️ Включена СВЕТЛАЯ тема оформления (Light).'
            : '🌙 Включена ТЁМНАЯ тема оформления (Dark Blue).';

        return {
            response: `🎨 ${msg}\n💾 Тема сохранена в LocalStorage и синхронизирована с настройками пользователя.`,
            style: 'output-success'
        };
    }
});
