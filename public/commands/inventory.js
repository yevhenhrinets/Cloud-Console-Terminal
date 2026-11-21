CommandRegistry.register({
    names: ['inventory', 'склад', 'готово', 'show inventory', 'предметы'],
    
    description: 'Inventory',
    category: 'Dashboard',
    usage: 'Show inventory | inventory',
    
    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: 'Помилка: користувач не визначений.', style: 'output-error' };

        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        if (!(options && options.fromTwoStepBar) && rawArgs) {
            return rejectInlineParamsError(parameters.matchedCmd || 'inventory', '');
        }

        if (currentUser.isGuest) {
            const response = "📦 Склад готових виробів (Демо/Offline):\n" +
                "  • Залізна руда: 30 шт.\n" +
                "  • Дубові дошки: 45 шт.\n" +
                "  • Сталевий злиток: 12 шт.\n" +
                "  • Свіжий гарячий суп: 3 шт.\n" +
                "  • Мідний кабель: 15 шт.";
            return { response, style: 'output-info' };
        }

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            return { response: '📡 Офлайн-режим: склад готовых изделий синхронизируется при подключении к интернету.', style: 'output-info' };
        }

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


