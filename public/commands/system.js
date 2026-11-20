CommandRegistry.register({
    names: ['date', 'дата', 'show date'],
    
    description: 'Date',
    category: 'Datetime',
    usage: 'Date | show date',
    
    handler: async (parameters) => {
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
    
    handler: async (parameters) => {
        const now = new Date();
        return { response: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), style: 'output-success' };
    }
});

CommandRegistry.register({
    names: ['datetime'],
    
    description: 'Datetime',
    category: 'Datetime',
    usage: 'Datetime',
    
    handler: async (parameters) => {
        return { response: formatDate(new Date().toISOString()), style: 'output-success' };
    }
});

CommandRegistry.register({
    names: ['echo', 'эхо', 'луна', 'print'],
    
    description: 'Outputing',
    category: 'System',
    usage: 'Echo [text] | print [text]',
    
    handler: async (parameters) => {
        return { 
            response: `Текст: ${parameters.raw_args}\nJSON parameters: ${JSON.stringify(parameters, null, 2)}`, 
            style: 'output-success' 
        };
    }
});

CommandRegistry.register({
    names: ['clear', 'очистить', 'чистка', 'очистити', 'почистити'],
    
    description: 'Clear output',
    category: 'System',
    usage: 'Clear | чистка | почистити',
    
    handler: async (parameters) => {
        await saveToCloud('clear', parameters, 'Screen cleared', 'Screen cleared [OK]', 'success');
        return { response: '', style: '', action: 'clear', skipHistorySave: true };
    }
});

CommandRegistry.register({
    names: ['reload', 'refresh', 'обновить', 'перезагрузить', 'оновити'],
    
    description: 'Reload terminal page',
    category: 'System',
    usage: 'reload | refresh',
    
    handler: async () => {
        setTimeout(() => {
            window.location.reload();
        }, 150);
        return { response: '🔄 Обновление страницы терминала...', style: 'output-info', skipHistorySave: true };
    }
});


