// commands/theme.js — переключение тем оформления (Dark / Light)

CommandRegistry.register({
    names: [
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
    usage: 'theme light | theme dark | theme toggle | select light theme',
    
    handler: async (parameters) => {
        const rawText = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').toLowerCase();
        const fullCmd = (parameters && parameters.cmd ? String(parameters.cmd) : '').toLowerCase();
        const combined = `${fullCmd} ${rawText}`.trim();

        const currentTheme = (typeof window.getCurrentTheme === 'function') 
            ? window.getCurrentTheme() 
            : (localStorage.getItem('terminal_theme') || 'dark');

        let targetTheme = null;

        if (combined.includes('light') || combined.includes('светл') || combined.includes('бел')) {
            targetTheme = 'light';
        } else if (combined.includes('dark') || combined.includes('темн') || combined.includes('чёрн') || combined.includes('черн')) {
            targetTheme = 'dark';
        } else if (combined.includes('toggle') || combined.includes('переключ') || combined.includes('смен')) {
            targetTheme = (currentTheme === 'light') ? 'dark' : 'light';
        } else if (!rawText) {
            // Без параметров — показать текущую тему и справку
            const themeNameStr = currentTheme === 'light' ? '☀️ Светлая (Light)' : '🌙 Тёмная (Dark Blue)';
            return {
                response: `🎨 Текущая тема оформления: ${themeNameStr}\n\nКоманды для смены темы:\n  • theme light — включить светлую тему\n  • theme dark — включить тёмную тему\n  • theme toggle — быстрое переключение`,
                style: 'output-info'
            };
        } else {
            // Если передан неизвестный аргумент
            targetTheme = (currentTheme === 'light') ? 'dark' : 'light';
        }

        // Применяем тему через глобальный хелпер
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
