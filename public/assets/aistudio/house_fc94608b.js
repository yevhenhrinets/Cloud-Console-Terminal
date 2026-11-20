// Команда перехода на визуальную панель
CommandRegistry.register({
    names: ['house', 'дом', 'будинок'],
    
    description: 'Show room',
    category: 'House',
    usage: 'House',
    
    handler: async () => {
        window.location.href = 'house/kitchen.html';
        return { response: '🚀 Переход...', style: 'output-info' };
    }
});