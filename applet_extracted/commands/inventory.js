CommandRegistry.register({
    names: ['inventory', 'склад', 'готово', 'show inventory', 'предметы'],
    
    description: 'Inventory',
    category: 'Dashboard',
    usage: 'Show inventory | inventory',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        try {
            const { data: items, error } = await window.supabaseClient
                .from('completed_items')
                .select('*')
                .eq('created_by', currentUser.id)
                .order('name', { ascending: true });

            if (error) throw error;
            if (!items || items.length === 0) return { response: '📦 Склад пуст. Сварите что-нибудь!', style: 'output-info' };

            const response = "📦 Склад готовых изделий:\n" +
                items.map(i => `  • ${i.name}: ${i.count} шт.`).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки склада: ' + err.message, style: 'output-error' };
        }
    }
});


