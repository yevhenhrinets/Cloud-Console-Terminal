// Команда перехода в Зал
CommandRegistry.register({
    names: ['hall', 'parlor', 'parlour', 'зал', 'зала'],
    
    description: 'Parlour',
    category: 'House',
    usage: 'Parlor | parlour | hall',
    
    handler: async () => {
        window.location.href = 'house/hall.html';
        return { response: '🚀 Переход в зал...', style: 'output-info' };
    }
});

