CommandRegistry.register({
    names: ['notes', 'заметки', 'нотатки', 'notes list', 'show notes', 'read notes'],
    
    description: 'Show last notes',
    category: 'CRUD',
    usage: 'Notes | read notes | show notes | notes list',
    
    handler: async (parameters) => {
        return await handleShowNotes();
    }
});
