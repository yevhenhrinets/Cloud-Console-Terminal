// commands/go_to.js — единый модуль навигации (go to kitchen, go to hall, go to dashboard, go to house, go to terminal и др.)

CommandRegistry.register({
    names: ['go to kitchen', 'go to kitchen 1', 'kitchen', 'kitchen 1', 'kitchen.html', 'кухня', 'кухня 1', 'go kitchen', 'open kitchen'],
    description: 'Переход в помещение кухни (Дом 1)',
    category: 'House',
    usage: 'go to kitchen | kitchen',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю кухню (Дом 1) в новой вкладке: /house/kitchen.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/kitchen.html';
        }, 200);
        return { response: '🚀 Переход на кухню Дома 1 (/house/kitchen.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to hall', 'go to hall 1', 'hall', 'hall 1', 'hall.html', 'parlor', 'parlour', 'go to parlor', 'go to parlour', 'зал', 'зала', 'зал 1', 'гостиная', 'вітальня', 'go hall', 'open hall'],
    description: 'Переход в помещение зала (Дом 1)',
    category: 'House',
    usage: 'go to hall | hall',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю зал (Дом 1) в новой вкладке: /house/hall.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/hall.html';
        }, 200);
        return { response: '🚀 Переход в зал Дома 1 (/house/hall.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to house', 'go to house 1', 'house', 'house 1', 'дом', 'дом 1', 'будинок', 'go house', 'open house'],
    description: 'Переход в Дом 1 (по умолчанию на кухню)',
    category: 'House',
    usage: 'go to house | house',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 1 в новой вкладке: /house/kitchen.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house/kitchen.html';
        }, 200);
        return { response: '🚀 Переход в Дом 1 (/house/kitchen.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to kitchen 2', 'go to kitchen2', 'go to house 2 kitchen', 'go to house2 kitchen', 'kitchen 2', 'kitchen2', 'кухня 2', 'кухня2', 'go kitchen 2', 'open kitchen 2'],
    description: 'Переход в помещение кухни (Дом 2)',
    category: 'House',
    usage: 'go to kitchen 2 | kitchen 2',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю кухню (Дом 2) в новой вкладке: /house2/kitchen.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/kitchen.html';
        }, 200);
        return { response: '🚀 Переход на кухню Дома 2 (/house2/kitchen.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to hall 2', 'go to hall2', 'go to house 2 hall', 'go to house2 hall', 'hall 2', 'hall2', 'зал 2', 'зала 2', 'зал2', 'go hall 2', 'open hall 2'],
    description: 'Переход в помещение зала (Дом 2)',
    category: 'House',
    usage: 'go to hall 2 | hall 2',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю зал (Дом 2) в новой вкладке: /house2/hall.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/hall.html';
        }, 200);
        return { response: '🚀 Переход в зал Дома 2 (/house2/hall.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to house 2', 'go to house2', 'house 2', 'house2', 'дом 2', 'дом2', 'будинок 2', 'go house 2', 'open house 2'],
    description: 'Переход в Дом 2 (вторая локация — кухня)',
    category: 'House',
    usage: 'go to house 2 | house 2',
    handler: async (parameters, options = {}) => {
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю Дом 2 в новой вкладке: /house2/kitchen.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/house2/kitchen.html';
        }, 200);
        return { response: '🚀 Переход в Дом 2 (/house2/kitchen.html)...', style: 'output-info' };
    }
});

CommandRegistry.register({
    names: ['go to dashboard', 'dashboard', 'dashboard.html', 'дашборд', 'дашбоард', 'панель', 'gui', 'go dashboard', 'open dashboard'],
    description: 'Переход на страницу дашборда построек и таймеров',
    category: 'Dashboard',
    usage: 'go to dashboard | dashboard',
    handler: async (parameters, options = {}) => {
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
        if (options && options.skipRedirect) {
            return { response: '🆕 Открываю консоль в новой вкладке: /terminal.html', style: 'output-info' };
        }
        setTimeout(() => {
            window.location.href = '/terminal.html';
        }, 200);
        return { response: '🚀 Переход в консоль (/terminal.html)...', style: 'output-info' };
    }
});

// Универсальный маршрутизатор: go to <цель> / go <цель>
CommandRegistry.register({
    names: ['go to', 'go', 'перейти', 'перейти в', 'открыть', 'open'],
    description: 'Универсальный переход к страницам и разделам (missions, hall, kitchen, dashboard, house, notes, history...)',
    category: 'House',
    usage: 'go to <missions | hall | kitchen | dashboard | house | terminal | notes | history | buildings | timers | inventory>',
    handler: async (parameters, options = {}) => {
        const rawTarget = (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '').trim().toLowerCase();
        if (!rawTarget) {
            return {
                response: '🧭 Укажите куда перейти.\nПримеры: `go to missions`, `go to hall`, `go to kitchen`, `go to dashboard`, `go to house`, `go to notes`',
                style: 'output-info'
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
            'house': 'go to house',
            'house 1': 'go to house',
            'дом': 'go to house',
            'дом 1': 'go to house',
            'будинок': 'go to house',
            'house 2': 'go to house 2',
            'house2': 'go to house 2',
            'дом 2': 'go to house 2',
            'дом2': 'go to house 2',
            'будинок 2': 'go to house 2',
            'kitchen 2': 'go to kitchen 2',
            'kitchen2': 'go to kitchen 2',
            'кухня 2': 'go to kitchen 2',
            'кухня2': 'go to kitchen 2',
            'house 2 kitchen': 'go to kitchen 2',
            'house2 kitchen': 'go to kitchen 2',
            'hall 2': 'go to hall 2',
            'hall2': 'go to hall 2',
            'зал 2': 'go to hall 2',
            'зала 2': 'go to hall 2',
            'зал2': 'go to hall 2',
            'house 2 hall': 'go to hall 2',
            'house2 hall': 'go to hall 2',
            'dashboard': 'go to dashboard',
            'dashboard.html': 'go to dashboard',
            'дашборд': 'go to dashboard',
            'дашбоард': 'go to dashboard',
            'панель': 'go to dashboard',
            'house': 'go to house',
            'дом': 'go to house',
            'будинок': 'go to house',
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
            'склад': 'inventory'
        };

        const resolvedCmd = routeAliases[rawTarget] || rawTarget;
        const targetHandler = window.CommandRegistry ? window.CommandRegistry.getHandler(resolvedCmd) : null;

        if (targetHandler && resolvedCmd !== 'go to' && resolvedCmd !== 'go') {
            return await targetHandler({ args: [], raw_args: '' }, options);
        }

        return {
            response: `❓ Неизвестный раздел "${rawTarget}".\nДоступные варианты: \`go to missions\`, \`go to hall\`, \`go to kitchen\`, \`go to dashboard\`, \`go to house\`, \`go to terminal\`, \`go to notes\``,
            style: 'output-error'
        };
    }
});
