// commands/timers.js — просмотр таймеров с расчетом времени из ends_at (работает при закрытой вкладке)

CommandRegistry.register({
    names: ['timers', 'таймеры', 'show timers', 'активные таймеры'],
    
    description: 'Timers',
    category: 'Tasks',
    usage: 'Timers | show timers',
    
    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: 'Помилка: користувач не визначений.', style: 'output-error' };

        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        if (!(options && options.fromTwoStepBar) && rawArgs) {
            return rejectInlineParamsError('add timer', 'Сосиска 1', '💡 Для списка активных таймеров введите просто `timers`.');
        }

        if (currentUser.isGuest) {
            const response = "⏱️ Активні черги таймерів (Демо-режим):\n\n" +
                "📌 **Черга / Лінія #1 (Печь):**\n" +
                "  • [ID: 101] Виплавка заліза — <span style='color:#4ade80;font-weight:bold;'>01:45</span> 🟢 [В роботі]\n" +
                "  • [ID: 102] Загартування сталі — <span style='color:#94a3b8;'>05:00</span> ⏳ [В черзі]\n\n" +
                "📌 **Черга / Лінія #2 (Лесопилка):**\n" +
                "  • [ID: 201] Розпил дуба — <span style='color:#4ade80;font-weight:bold;'>00:32</span> 🟢 [В роботі]\n\n" +
                "📌 **Черга / Лінія #3 (Кухня):**\n" +
                "  • [ID: 301] Гарячий суп — <span style='color:#38bdf8;font-weight:bold;'>Готово!</span> ✨ [Завершено]";
            return { response, style: 'output-info', isHtml: true };
        }

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            return { response: '📡 Офлайн-режим: активные таймеры дашборда синхронизируются только при подключении к интернету.', style: 'output-info' };
        }

        try {
            const { data: timers, error } = await window.supabaseClient
                .from('active_timers')
                .select('*')
                .eq('created_by', currentUser.id)
                .order('id', { ascending: true });

            if (error) throw error;
            if (!timers || timers.length === 0) return { response: '⏱️ Активных таймеров и очередей нет.', style: 'output-info' };

            const queues = {};
            const now = Date.now();

            timers.forEach(t => {
                if (!queues[t.queue_group_id]) queues[t.queue_group_id] = [];
                
                // Вычисляем оставшиеся секунды на лету по серверному/системному времени (ends_at)
                let remaining = t.remaining_seconds;
                if (t.ends_at && t.status === 'running') {
                    const diffMs = new Date(t.ends_at).getTime() - now;
                    remaining = Math.max(0, Math.floor(diffMs / 1000));
                }
                t.calculated_remaining = remaining;
                
                queues[t.queue_group_id].push(t);
            });

            let response = "⏱️ Активные очереди таймеров:\n";
            for (const [qId, items] of Object.entries(queues)) {
                if (items.length === 0) continue;
                response += `\n📌 **Очередь / Линия #${qId}:**\n`;
                items.forEach(item => {
                    const rem = item.calculated_remaining;
                    const mins = Math.floor(rem / 60);
                    const secs = rem % 60;
                    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
                    const statusIcon = item.status === 'running' ? '🟢 [В работе]' : '⏳ [В очереди]';
                    response += `  • [ID: ${item.inner_id}] ${item.name} — <span id="timer-val-${item.id}">${timeFormatted}</span> ${statusIcon}\n`;
                });
            }

            return { 
                response, 
                style: 'output-info', 
                isHtml: true // Разрешаем рендер тегов <span> для живых часов
            };
        } catch (err) {
            return { response: '❌ Ошибка загрузки таймеров: ' + err.message, style: 'output-error' };
        }
    }
});
