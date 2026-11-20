// Команда перехода на Кухню
CommandRegistry.register({
    names: ['kitchen', 'кухня'],
    
    description: 'Show room',
    category: 'House',
    usage: 'Kitchen',
    
    handler: async () => {
        window.location.href = 'house/kitchen.html';
        return { response: '🚀 Переход на кухню...', style: 'output-info' };
    }
});

