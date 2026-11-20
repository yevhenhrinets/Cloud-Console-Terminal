// commands/timers.js — просмотр таймеров с расчетом времени из ends_at (работает при закрытой вкладке)

CommandRegistry.register({
    names: ['timers', 'таймеры', 'show timers', 'активные таймеры'],
    
    description: 'Timers',
    category: 'Tasks',
    usage: 'Timers | show timers',
    
    handler: async (parameters) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

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
