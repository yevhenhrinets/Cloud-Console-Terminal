// Команда перехода на визуальную панель
CommandRegistry.register({
    names: ['dashboard', 'дашборд', 'дашбоард', 'панель', 'gui'],
    
    description: 'Dashboard',
    category: 'Dashboard',
    usage: 'Dashboard',
    
    handler: async () => {
        window.location.href = 'dashboard.html';
        return { response: '🚀 Переход на Dashboard...', style: 'output-info' };
    }
});