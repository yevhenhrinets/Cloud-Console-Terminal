CommandRegistry.register({
    names: ['date', 'дата', 'show date'],
    
    description: 'Date',
    category: 'Datetime',
    usage: 'Date | show date',
    
    handler: async (parameters, options = {}) => {
        if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
            return rejectInlineParamsError(parameters.matchedCmd || 'date', '');
        }
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        return { response: `${timeStr} ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`, style: 'output-success' };
    }
});

CommandRegistry.register({
    names: ['time', 'время', 'час'],
    
    description: 'Time',
    category: 'Datetime',
    usage: 'Time',
    
    handler: async (parameters, options = {}) => {
        if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
            return rejectInlineParamsError(parameters.matchedCmd || 'time', '');
        }
        const now = new Date();
        return { response: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), style: 'output-success' };
    }
});

CommandRegistry.register({
    names: ['datetime'],
    
    description: 'Datetime',
    category: 'Datetime',
    usage: 'Datetime',
    
    handler: async (parameters, options = {}) => {
        if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
            return rejectInlineParamsError(parameters.matchedCmd || 'datetime', '');
        }
        return { response: formatDate(new Date().toISOString()), style: 'output-success' };
    }
});

CommandRegistry.register({
    names: ['echo', 'эхо', 'луна', 'print'],
    
    description: 'Вывод текста (строго в 2 этапа)',
    category: 'System',
    usage: 'echo | print',
    
    handler: async (parameters, options = {}) => {
        const text = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'echo';

        if (text && !(options && options.fromTwoStepBar)) {
            return {
                response: `⚠️ Команда \`${prefix}\` работает только в 2 этапа — текст нельзя вводить сразу в команде!\n1) Введите \`${prefix}\` без текста\n2) Введите текст после появления команды под строкой ввода.`,
                style: 'output-error'
            };
        }

        if (!text) {
            return {
                response: `📢 Режим \`${prefix}\` активирован. Введите текст в поле ввода и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: prefix,
                inputValue: '',
                inputPlaceholder: `Введите текст для "${prefix}"...`
            };
        }

        return { 
            response: `Текст: ${text}`, 
            style: 'output-success' 
        };
    }
});

CommandRegistry.register({
    names: ['clear', 'очистить', 'чистка', 'очистити', 'почистити'],
    
    description: 'Clear output',
    category: 'System',
    usage: 'Clear | чистка | почистити',
    
    handler: async (parameters, options = {}) => {
        if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
            return rejectInlineParamsError(parameters.matchedCmd || 'clear', '');
        }
        await saveToCloud('clear', parameters, 'Screen cleared', 'Screen cleared [OK]', 'success');
        return { response: '', style: '', action: 'clear', skipHistorySave: true };
    }
});

CommandRegistry.register({
    names: ['reload', 'refresh', 'обновить', 'перезагрузить', 'оновити'],
    
    description: 'Reload terminal page',
    category: 'System',
    usage: 'reload | refresh',
    
    handler: async (parameters, options = {}) => {
        if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
            return rejectInlineParamsError(parameters.matchedCmd || 'reload', '');
        }
        setTimeout(() => {
            window.location.reload();
        }, 150);
        return { response: '🔄 Обновление страницы терминала...', style: 'output-info', skipHistorySave: true };
    }
});


