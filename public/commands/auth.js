// commands/auth.js — управление входом через Google, сменой аккаунта и профилем пользователя

async function startGoogleOAuthFlow(forceAccountSelect = true) {
    const inIframe = window.self !== window.top;

    // Надежный адрес возврата: текущий origin или опубликованный URL превью (если внутри iframe AI Studio)
    let redirectTarget = window.location.origin + (window.location.pathname.includes('index') ? '/index.html' : '/terminal.html');
    if (window.location.hostname.includes('google.com')) {
        redirectTarget = 'https://ais-pre-chnak55kwbkbbooyikw4mw-618166997611.europe-west3.run.app/terminal.html';
    }

    const oauthOptions = {
        redirectTo: redirectTarget,
        queryParams: forceAccountSelect
            ? { prompt: 'select_account', access_type: 'offline' }
            : {}
    };

    if (inIframe) {
        oauthOptions.skipBrowserRedirect = true;
        const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: oauthOptions
        });
        if (error) throw error;
        if (data && data.url) {
            const authWindow = window.open(data.url, '_blank');
            if (!authWindow) {
                return {
                    response: `⚠️ Всплывающее окно заблокировано браузером.\n👉 <a href="${data.url}" target="_blank" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">[Нажмите сюда для выбора аккаунта Google]</a>`,
                    style: 'output-info',
                    isHtml: true
                };
            }
            return {
                response: '🔗 Окно выбора аккаунта Google открыто в новой вкладке. После входа вернитесь в терминал.',
                style: 'output-info'
            };
        }
    } else {
        const { error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: oauthOptions
        });
        if (error) throw error;
        return {
            response: '🔄 Перенаправление на страницу выбора аккаунта Google...',
            style: 'output-info'
        };
    }
}

CommandRegistry.register({
    names: ['login', 'log in', 'signin', 'sign in', 'auth google', 'google auth', 'войти'],

    description: 'Вход через Google (с выбором аккаунта)',
    category: 'Auth',
    usage: 'login | switch account',

    handler: async () => {
        try {
            // Если уже авторизованы, сбрасываем текущую локальную сессию перед входом, чтобы можно было выбрать любой аккаунт
            const current = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (current && !current.isGuest) {
                await performLogout();
                currentUserCache = null;
            }
            return await startGoogleOAuthFlow(true);
        } catch (err) {
            return { response: '❌ Ошибка входа через Google: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['switch account', 'switch', 'change account', 'relogin', 'сменить аккаунт', 'смена аккаунта', 'переключить аккаунт', 'змінити акаунт'],

    description: 'Выйти из текущего аккаунта и войти другим аккаунтом Google',
    category: 'Auth',
    usage: 'switch account',

    handler: async () => {
        try {
            const current = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (current && !current.isGuest) {
                await performLogout();
                currentUserCache = null;
            }
            return await startGoogleOAuthFlow(true);
        } catch (err) {
            return { response: '❌ Ошибка смены аккаунта: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['logout', 'log out', 'signout', 'sign out', 'выход', 'выйти', 'вихід', 'вийти'],

    description: 'Выход из текущего аккаунта',
    category: 'Auth',
    usage: 'logout',

    handler: async () => {
        try {
            await performLogout();
            currentUserCache = null;
            return {
                response: '🟢 Вы успешно вышли из аккаунта. Введите `login` или `switch account` для входа под другим аккаунтом.',
                style: 'output-success'
            };
        } catch (err) {
            return { response: '❌ Ошибка выхода: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['whoami', 'ктоя', 'хтоя', 'who am i?', 'who am i', 'кто я?', 'хто я?', 'кто я', 'хто я', 'show profile', 'show my profile', 'my profile', 'profile', 'профиль'],

    description: 'Показать профиль текущего пользователя',
    category: 'User',
    usage: 'whoami',

    handler: async () => {
        const user = await fetchCurrentUser();
        if (!user) {
            return { response: 'Вы не авторизованы. Введите команду "login" для входа через Google.', style: 'output-error' };
        }
        return {
            response: `Ваш профиль:\n  Имя: ${user.name || 'Не указано'}\n  Никнейм: ${user.nickname || 'Не задан'}\n  Email: ${user.email}\n  Роль: ${user.role}\n  ID: ${user.id}`,
            style: 'output-info'
        };
    }
});

CommandRegistry.register({
    names: ['set nickname', 'set name', 'изменить ник', 'изменить имя'],

    description: 'Изменить имя или никнейм профиля (строго в 2 этапа)',
    category: 'User',
    usage: 'set name | set nickname',

    handler: async (parameters, options = {}) => {
        const user = await fetchCurrentUser();
        if (!user || user.isGuest) {
            return { response: 'Ошибка: сначала войдите в реальный аккаунт командой `login`.', style: 'output-error' };
        }

        const matchedLower = String((parameters && parameters.matchedCmd) || '').toLowerCase();
        const isNickname = matchedLower.includes('nick') || matchedLower.includes('ник');
        const prefix = isNickname ? 'set nickname' : 'set name';
        const newText = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim();

        if (newText && !(options && options.fromTwoStepBar)) {
            return {
                response: `⚠️ Команда \`${prefix}\` работает только в 2 этапа!\n1) Введите \`${prefix}\` без текста\n2) После появления команды под строкой ввода напишите новое значение.`,
                style: 'output-error'
            };
        }

        if (!newText) {
            return {
                response: `👤 Введите ${isNickname ? 'новый никнейм' : 'новое имя'} и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: prefix,
                inputValue: '',
                inputPlaceholder: isNickname ? 'Введите новый никнейм...' : 'Введите новое имя...'
            };
        }

        const updateData = isNickname
            ? { nickname: newText, updated_at: new Date().toISOString() }
            : { name: newText, updated_at: new Date().toISOString() };

        try {
            const { error } = await window.supabaseClient
                .from('profiles')
                .update(updateData)
                .eq('id', user.id);

            if (error) throw error;
            currentUserCache = null;
            return { response: `🟢 Профиль успешно обновлен! ${isNickname ? 'Новый никнейм' : 'Новое имя'}: "${newText}"`, style: 'output-success' };
        } catch (err) {
            return { response: '❌ Ошибка обновления профиля: ' + err.message, style: 'output-error' };
        }
    }
});
