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

        if (window.DailyAcceleratorsSync && typeof window.DailyAcceleratorsSync.checkAndGrant === 'function') {
            await window.DailyAcceleratorsSync.checkAndGrant({ user: currentUser }).catch(() => null);
        }

        const dailyHint = (window.DailyAcceleratorsSync && window.DailyAcceleratorsSync.CONFIG && window.DailyAcceleratorsSync.CONFIG.enabled)
            ? '\n💡 Ежедневно начисляются ускорители: +1 в 09:00 и +2 в 21:00 (всего 3/день).'
            : '';

        const readLocalInventory = (uid) => {
            try {
                const raw = localStorage.getItem(`terminal_inventory_${uid}`);
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        };

        if (currentUser.isGuest || currentUser.id === 'guest' || !window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            const localItems = readLocalInventory(currentUser.id || 'guest').filter(i => (Number(i.count) || 0) > 0 || String(i.name || '').trim().toLowerCase() === 'ускорители');
            if (localItems.length === 0) {
                return { response: '📦 Склад пуст.' + dailyHint, style: 'output-info' };
            }
            const labelMode = currentUser.isGuest ? 'Демо' : 'Офлайн';
            const response = `📦 Склад готовых изделий (${labelMode}):\n` +
                localItems.map(i => `  • ${i.name}: ${Number(i.count) || 0} шт.`).join('\n') +
                dailyHint;
            return { response, style: 'output-info' };
        }

        try {
            const { data: items, error } = await window.supabaseClient
                .from('completed_items')
                .select('*')
                .eq('created_by', currentUser.id)
                .order('name', { ascending: true });

            if (error) throw error;
            if (!items || items.length === 0) return { response: '📦 Склад пуст. Сварите что-нибудь!' + dailyHint, style: 'output-info' };

            const response = "📦 Склад готовых изделий:\n" +
                items.map(i => `  • ${i.name}: ${i.count} шт.`).join('\n') +
                dailyHint;

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка загрузки склада: ' + err.message, style: 'output-error' };
        }
    }
});


