// commands/auth.js — управление входом через Google и профилем пользователя

CommandRegistry.register({
    names: ['login', 'log in', 'signin', 'sign in', 'auth google', 'google auth', 'войти'],
    
    description: 'Login',
    category: 'Auth',
    usage: 'Google auth',
    
    handler: async (parameters) => {
        try {
            const inIframe = window.self !== window.top;
            let redirectTarget = window.location.origin + '/terminal.html';
            
            // Если мы внутри studio.google.com, ни в коем случае не редиректим на studio.google.com
            if (window.location.hostname.includes('google.com') || window.location.origin.includes('google.com')) {
                redirectTarget = 'https://ais-dev-chnak55kwbkbbooyikw4mw-618166997611.europe-west3.run.app/terminal.html';
            } else if (window.location.hostname.includes('pages.dev')) {
                redirectTarget = window.location.origin + '/index.html';
            }

            if (inIframe) {
                const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: redirectTarget,
                        skipBrowserRedirect: true
                    }
                });
                if (error) throw error;
                if (data && data.url) {
                    const authWindow = window.open(data.url, '_blank');
                    if (!authWindow) {
                        return { 
                            response: `⚠️ Всплывающее окно заблокировано браузером.\n👉 <a href="${data.url}" target="_blank" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">[Нажмите сюда для авторизации через Google]</a>`, 
                            style: 'output-info',
                            isHtml: true 
                        };
                    }
                    return { response: '🔗 Окно входа Google открыто в новой вкладке. После завершения авторизации вернитесь в терминал.', style: 'output-info' };
                }
            } else {
                const { error } = await window.supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: redirectTarget
                    }
                });
                if (error) throw error;
                return { response: 'Перенаправление на авторизацию Google...', style: 'output-info' };
            }
        } catch (err) {
            return { response: 'Ошибка входа через Google: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['logout', 'log out', 'signout', 'sign out', 'выход', 'выйти', 'вихід', 'вийти'],
    
    description: 'Logout',
    category: 'Auth',
    usage: 'Google auth',
    
    handler: async (parameters) => {
        try {
            const { error } = await window.supabaseClient.auth.signOut();
            if (error) throw error;
            performLogout();
            currentUserCache = null;
            return { response: 'Вы успешно вышли из системы. Используйте команду "login" для входа.', style: 'output-success' };
        } catch (err) {
            return { response: 'Ошибка выхода: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['whoami', 'ктоя', 'хтоя', 'who am i?', 'who am i', 'кто я?', 'хто я?', 'кто я', 'хто я', 'show profile', 'show my profile', 'my profile', 'profile', 'профиль'],
    
    description: 'Whoami',
    category: 'User',
    usage: 'Who am I?',
    
    handler: async (parameters) => {
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
    
    description: 'Set name, set nickname',
    category: 'User',
    usage: 'Set name | set nickname',
    
    handler: async (parameters) => {
        const user = await fetchCurrentUser();
        if (!user) {
            return { response: 'Ошибка: вы не авторизованы.', style: 'output-error' };
        }

        const newText = parameters.args.slice(1).join(' '); // пропускаем ключевое слово
        const isNickname = parameters.args[0]?.toLowerCase().includes('nick') || parameters.args[0]?.toLowerCase().includes('ник');

        if (!newText) {
            return { response: `Ошибка: укажите новое значение.\nПример: ${isNickname ? 'set nickname cool_coder' : 'set name Алексей'}`, style: 'output-error' };
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
            return { response: `Профиль успешно обновлен! ${isNickname ? 'Новый никнейм' : 'Новое имя'}: "${newText}"`, style: 'output-success' };
        } catch (err) {
            return { response: 'Ошибка обновления профиля: ' + err.message, style: 'output-error' };
        }
    }
});
