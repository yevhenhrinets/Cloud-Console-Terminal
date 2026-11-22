// commands/go_to.js — единый модуль навигации (home 1 / home 2 / home 3, go to house 1/2/3, kitchen/hall, dashboard, terminal)

function guardNoInlineRouteArgs(parameters, options, defaultCmd) {
    if (options && options.fromTwoStepBar) return null;
    const raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
    if (!raw) return null;
    const cmd = (parameters && (parameters.matchedCmd || parameters.cmd)) ? String(parameters.matchedCmd || parameters.cmd).trim() : defaultCmd;
    return rejectInlineParamsError(cmd, '', `💡 Команда \`${cmd}\` выполняется без параметров, либо используйте пошаговый переход: \`go to\`.`);
}

CommandRegistry.register({
    names: [
        'go to home', 'go to home 1', 'go to house', 'go to house 1',
        'home', 'home 1', 'house', 'house 1',
        'дом', 'дом 1', 'дім', 'дім 1', 'будинок', 'будинок 1',
        'go home', 'go house', 'open home', 'open house'
    ],
    description: 'Переход в Дом 1 (единый квадрат 16×16 = 4 зоны 8×8)',
    category: 'House',
    usage: 'go to home 1 | home 1 | house 1',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to home 1');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 1 в новой вкладке: /house/index.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/index.html';
        }, 200);
        return { response: '🚀 Переход в Дом 1 (/house/index.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to kitchen', 'go to kitchen 1', 'kitchen', 'kitchen 1', 'kitchen.html', 'кухня', 'кухня 1', 'go kitchen', 'open kitchen'],
    description: 'Переход на кухню Дома 1',
    category: 'House',
    usage: 'go to kitchen | kitchen',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to kitchen');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 1 (Кухня) в новой вкладке: /house/index.html#kitchen', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/index.html#kitchen';
        }, 200);
        return { response: '🚀 Переход на кухню Дома 1 (/house/index.html#kitchen)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to hall', 'go to hall 1', 'hall', 'hall 1', 'hall.html', 'parlor', 'parlour', 'go to parlor', 'go to parlour', 'зал', 'зала', 'зал 1', 'гостиная', 'вітальня', 'go hall', 'open hall'],
    description: 'Переход в зал Дома 1 (7×9)',
    category: 'House',
    usage: 'go to hall | hall',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to hall');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 1 (Зал) в новой вкладке: /house/index.html#hall', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/index.html#hall';
        }, 200);
        return { response: '🚀 Переход в зал Дома 1 (/house/index.html#hall)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: [
        'go to home 2', 'go to home2', 'go to house 2', 'go to house2',
        'home 2', 'home2', 'house 2', 'house2',
        'дом 2', 'дом2', 'дім 2', 'дім2', 'будинок 2',
        'go home 2', 'go house 2', 'open home 2', 'open house 2'
    ],
    description: 'Переход в Дом 2 (вторая локация — Кухня и Зал)',
    category: 'House',
    usage: 'go to home 2 | home 2 | house 2',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to home 2');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 2 в новой вкладке: /house2/index.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/index.html';
        }, 200);
        return { response: '🚀 Переход в Дом 2 (/house2/index.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to kitchen 2', 'go to kitchen2', 'go to house 2 kitchen', 'go to house2 kitchen', 'go to home 2 kitchen', 'kitchen 2', 'kitchen2', 'кухня 2', 'кухня2', 'go kitchen 2', 'open kitchen 2'],
    description: 'Переход на кухню Дома 2',
    category: 'House',
    usage: 'go to kitchen 2 | kitchen 2',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to kitchen 2');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 2 (Кухня) в новой вкладке: /house2/index.html#kitchen', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/index.html#kitchen';
        }, 200);
        return { response: '🚀 Переход на кухню Дома 2 (/house2/index.html#kitchen)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to hall 2', 'go to hall2', 'go to house 2 hall', 'go to house2 hall', 'go to home 2 hall', 'hall 2', 'hall2', 'зал 2', 'зала 2', 'зал2', 'go hall 2', 'open hall 2'],
    description: 'Переход в зал Дома 2',
    category: 'House',
    usage: 'go to hall 2 | hall 2',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to hall 2');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 2 (Зал) в новой вкладке: /house2/index.html#hall', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/index.html#hall';
        }, 200);
        return { response: '🚀 Переход в зал Дома 2 (/house2/index.html#hall)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: [
        'go to home 3', 'go to home3', 'go to house 3', 'go to house3',
        'home 3', 'home3', 'house 3', 'house3',
        'дом 3', 'дом3', 'дім 3', 'дім3', 'будинок 3',
        'go home 3', 'go house 3', 'open home 3', 'open house 3'
    ],
    description: 'Переход в Дом 3 (третья локация — Кухня и Зал)',
    category: 'House',
    usage: 'go to home 3 | home 3 | house 3',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to home 3');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 3 в новой вкладке: /house3/index.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house3/index.html';
        }, 200);
        return { response: '🚀 Переход в Дом 3 (/house3/index.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to kitchen 3', 'go to kitchen3', 'go to house 3 kitchen', 'go to house3 kitchen', 'go to home 3 kitchen', 'kitchen 3', 'kitchen3', 'кухня 3', 'кухня3', 'go kitchen 3', 'open kitchen 3'],
    description: 'Переход на кухню Дома 3',
    category: 'House',
    usage: 'go to kitchen 3 | kitchen 3',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to kitchen 3');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 3 (Кухня) в новой вкладке: /house3/index.html#kitchen', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house3/index.html#kitchen';
        }, 200);
        return { response: '🚀 Переход на кухню Дома 3 (/house3/index.html#kitchen)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to hall 3', 'go to hall3', 'go to house 3 hall', 'go to house3 hall', 'go to home 3 hall', 'hall 3', 'hall3', 'зал 3', 'зала 3', 'зал3', 'go hall 3', 'open hall 3'],
    description: 'Переход в зал Дома 3',
    category: 'House',
    usage: 'go to hall 3 | hall 3',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to hall 3');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 3 (Зал) в новой вкладке: /house3/index.html#hall', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house3/index.html#hall';
        }, 200);
        return { response: '🚀 Переход в зал Дома 3 (/house3/index.html#hall)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to dashboard', 'dashboard', 'dashboard.html', 'дашборд', 'дашбоард', 'панель', 'gui', 'go dashboard', 'open dashboard'],
    description: 'Переход на страницу дашборда построек и таймеров',
    category: 'Dashboard',
    usage: 'go to dashboard | dashboard',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to dashboard');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Dashboard в новой вкладке: /dashboard.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 200);
        return { response: '🚀 Переход на Dashboard (/dashboard.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to terminal', 'go to console', 'go terminal', 'go console', 'terminal.html', 'terminal', 'console', 'консоль', 'терминал'],
    description: 'Переход на страницу консоли / терминала',
    category: 'House',
    usage: 'go to terminal | go to console',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'go to terminal');
        if (err) return err;
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю консоль в новой вкладке: /terminal.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/terminal.html';
        }, 200);
        return { response: '🚀 Переход в консоль (/terminal.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['continue', 'continue last', 'resume', 'last page', 'продолжить', 'продовжити', 'далі'],
    description: 'Продолжить и вернуться на последнюю открытую страницу (Дашборд, Задания, Дом 1/2/3)',
    category: 'House',
    usage: 'Continue',
    handler: async (parameters, options = {}) => {
        const err = guardNoInlineRouteArgs(parameters, options, 'continue');
        if (err) return err;

        let target = null;
        if (window.LastPageSync && typeof window.LastPageSync.getBestLastPage === 'function') {
            target = await window.LastPageSync.getBestLastPage();
        } else {
            try {
                const raw = localStorage.getItem('terminal_last_page_v1');
                target = raw ? JSON.parse(raw) : null;
            } catch (e) {
                target = null;
            }
        }

        if (!target || !target.path) {
            return {
                response: 'ℹ️ Сохранённая последняя страница пока не найдена. Откройте Дашборд, Задания или Дом 1–3, чтобы приложение запомнило её.',
                style: 'output-info'
            };
        }

        if (options && options.skipRedirect) {
            return {
                response: `🆕 Открываю последнюю страницу в новой вкладке: ${target.title || target.path} (${target.path})`,
                style: 'output-info'
            };
        }

        setTimeout(() => {
            window.location.href = target.path;
        }, 180);
        return {
            response: `▶️ Переключаю на последнюю страницу: ${target.title || target.path} (${target.path})...`,
            style: 'output-info'
        };
    }
});

// Универсальный маршрутизатор: go to <цель> / go <цель>
CommandRegistry.register({
    names: ['go to', 'go', 'перейти', 'перейти в', 'открыть', 'open'],
    description: 'Универсальный переход к страницам и локациям (home 1/2/3, house 1/2/3, missions, dashboard, terminal...)',
    category: 'House',
    usage: 'go to <home 1 | home 2 | home 3 | house 1 | house 2 | house 3 | missions | dashboard | terminal>',
    handler: async (parameters, options = {}) => {
        const matchedCmd = String((parameters && parameters.matchedCmd) || 'go to').trim().toLowerCase();
        const rawTarget = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim().toLowerCase();

        if (!(options && options.fromTwoStepBar)) {
            if (rawTarget) {
                return rejectInlineParamsError(
                    matchedCmd,
                    'notes',
                    '💡 Либо введите готовую словесную команду: `go to home 1`, `go to home 2`, `go to home 3`, `go to missions`, `go to dashboard`, `go to terminal`.'
                );
            }
            return {
                response: `🧭 Режим перехода (\`${matchedCmd}\`): введите раздел (напр: \`home 1\`, \`home 2\`, \`missions\`, \`dashboard\`, \`notes\`, \`history\`) и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: 'Раздел (home 1, home 2, missions, dashboard, notes)...'
            };
        }

        if (!rawTarget) {
            return {
                response: '🧭 Укажите раздел для перехода.',
                style: 'output-error'
            };
        }

        const routeAliases = {
            'missions': 'go to missions',
            'mission': 'go to missions',
            'missions.html': 'go to missions',
            'todo': 'go to missions',
            'задания': 'go to missions',
            'поручения': 'go to missions',
            'поручення': 'go to missions',
            'завдання': 'go to missions',
            'home': 'go to home 1',
            'home 1': 'go to home 1',
            'home1': 'go to home 1',
            'house': 'go to home 1',
            'house 1': 'go to home 1',
            'house1': 'go to home 1',
            'дом': 'go to home 1',
            'дом 1': 'go to home 1',
            'дім': 'go to home 1',
            'дім 1': 'go to home 1',
            'будинок': 'go to home 1',
            'hall': 'go to hall',
            'hall 1': 'go to hall',
            'hall.html': 'go to hall',
            'parlor': 'go to hall',
            'parlour': 'go to hall',
            'зал': 'go to hall',
            'зала': 'go to hall',
            'зал 1': 'go to hall',
            'гостиная': 'go to hall',
            'вітальня': 'go to hall',
            'kitchen': 'go to kitchen',
            'kitchen 1': 'go to kitchen',
            'kitchen.html': 'go to kitchen',
            'кухня': 'go to kitchen',
            'кухня 1': 'go to kitchen',
            'home 2': 'go to home 2',
            'home2': 'go to home 2',
            'house 2': 'go to home 2',
            'house2': 'go to home 2',
            'дом 2': 'go to home 2',
            'дом2': 'go to home 2',
            'дім 2': 'go to home 2',
            'дім2': 'go to home 2',
            'будинок 2': 'go to home 2',
            'kitchen 2': 'go to kitchen 2',
            'kitchen2': 'go to kitchen 2',
            'кухня 2': 'go to kitchen 2',
            'кухня2': 'go to kitchen 2',
            'house 2 kitchen': 'go to kitchen 2',
            'house2 kitchen': 'go to kitchen 2',
            'home 2 kitchen': 'go to kitchen 2',
            'hall 2': 'go to hall 2',
            'hall2': 'go to hall 2',
            'зал 2': 'go to hall 2',
            'зала 2': 'go to hall 2',
            'зал2': 'go to hall 2',
            'house 2 hall': 'go to hall 2',
            'house2 hall': 'go to hall 2',
            'home 2 hall': 'go to hall 2',
            'home 3': 'go to home 3',
            'home3': 'go to home 3',
            'house 3': 'go to home 3',
            'house3': 'go to home 3',
            'дом 3': 'go to home 3',
            'дом3': 'go to home 3',
            'дім 3': 'go to home 3',
            'дім3': 'go to home 3',
            'будинок 3': 'go to home 3',
            'kitchen 3': 'go to kitchen 3',
            'kitchen3': 'go to kitchen 3',
            'кухня 3': 'go to kitchen 3',
            'кухня3': 'go to kitchen 3',
            'house 3 kitchen': 'go to kitchen 3',
            'house3 kitchen': 'go to kitchen 3',
            'home 3 kitchen': 'go to kitchen 3',
            'hall 3': 'go to hall 3',
            'hall3': 'go to hall 3',
            'зал 3': 'go to hall 3',
            'зала 3': 'go to hall 3',
            'зал3': 'go to hall 3',
            'house 3 hall': 'go to hall 3',
            'house3 hall': 'go to hall 3',
            'home 3 hall': 'go to hall 3',
            'dashboard': 'go to dashboard',
            'dashboard.html': 'go to dashboard',
            'дашборд': 'go to dashboard',
            'дашбоард': 'go to dashboard',
            'панель': 'go to dashboard',
            'terminal': 'go to terminal',
            'terminal.html': 'go to terminal',
            'console': 'go to terminal',
            'терминал': 'go to terminal',
            'консоль': 'go to terminal',
            'notes': 'show notes',
            'note': 'show notes',
            'заметки': 'show notes',
            'нотатки': 'show notes',
            'history': 'history',
            'история': 'history',
            'історія': 'history',
            'buildings': 'show buildings',
            'building': 'show buildings',
            'постройки': 'show buildings',
            'timers': 'timers',
            'таймеры': 'timers',
            'inventory': 'inventory',
            'склад': 'inventory',
            'commands': 'commands list',
            'commands list': 'commands list',
            'support': 'support',
            'reports': 'reports',
            'continue': 'continue',
            'resume': 'continue',
            'продолжить': 'continue'
        };

        const resolvedCmd = routeAliases[rawTarget] || rawTarget;
        const targetHandler = window.CommandRegistry ? window.CommandRegistry.getHandler(resolvedCmd) : null;

        if (targetHandler && resolvedCmd !== 'go to' && resolvedCmd !== 'go') {
            return await targetHandler({ args: [], raw_args: '' }, options);
        }

        return {
            response: `❓ Неизвестный раздел "${rawTarget}".\nДоступные варианты: \`go to home 1\`, \`go to home 2\`, \`go to home 3\`, \`go to missions\`, \`go to dashboard\`, \`go to terminal\``,
            style: 'output-error'
        };
    }
});
