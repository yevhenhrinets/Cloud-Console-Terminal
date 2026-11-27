// commands/cancel.js — отмена последней выполненной операции / команды

if (window.CommandRegistry) {
    window.CommandRegistry.register({
        names: [
            'cancel last command',
            'cancel last operation',
            'cancel last',
            'cancel',
            'undo last command',
            'undo last operation',
            'undo last',
            'undo',
            'отменить последнюю команду',
            'отменить последнюю операцию',
            'отмена',
            'отменить',
            'скасувати'
        ],
        description: 'Отменяет последнюю выполненную операцию (создание, переименование, поворот, перемещение, цвет, размер и др.)',
        category: 'Система',
        handler: async (parameters, options) => {
            if (!window.CommandUndo || typeof window.CommandUndo.executeUndo !== 'function') {
                return {
                    response: '❌ Механизм отмены временно недоступен.',
                    style: 'output-error',
                    skipUndoSave: true
                };
            }
            const user = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            return await window.CommandUndo.executeUndo(user);
        }
    });
}
