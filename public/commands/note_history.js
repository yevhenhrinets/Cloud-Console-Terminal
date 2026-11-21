// commands/note_history.js — просмотр истории версий (логов) конкретной заметки (строго в 2 этапа)

CommandRegistry.register({
    names: ['note history', 'история заметки', 'історія нотатки', 'logs', 'note logs'],

    description: 'История версий заметки по ID (строго в 2 этапа)',
    category: 'CRUD',
    usage: 'note history -> <id> | logs -> <id>',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'note history').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, '2');
            }
            return {
                response: `📜 История версий заметки (\`${matchedCmd}\`): введите ID заметки (например: 2) и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: 'Введите ID заметки (напр: 2)...'
            };
        }

        const ids = extractNumericIds(parameters.args || []);
        if (ids.length === 0) {
            return { response: '❌ Укажите ID заметки для просмотра истории (например: `2`)', style: 'output-error' };
        }

        const targetInnerId = ids[0];
        const isAdmin = ['root', 'support'].includes(currentUser.role);

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest) {
            return { response: '📡 Офлайн-режим: история версий заметки доступна при подключении к интернету.', style: 'output-info' };
        }

        try {
            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .eq('inner_id', targetInnerId)
                .order('version', { ascending: true });

            if (!isAdmin) {
                query = query.eq('created_by', currentUser.id);
            }

            const { data: versions, error } = await query;
            if (error) throw error;

            if (!versions || versions.length === 0) {
                return { response: `❌ История для заметки [${targetInnerId}] не найдена.`, style: 'output-error' };
            }

            const response = `📜 История изменений заметки [ID: ${targetInnerId}]:\n` +
                versions.map(v => {
                    const timeStr = formatDate(v.updated_at || v.created_at);
                    const statusMark = v.version === versions.length ? ' ⭐ (актуальная)' : '';
                    return `  • [v${v.version}] [${timeStr}] ${v.content}${statusMark}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            return { response: '❌ Ошибка получения истории заметки: ' + err.message, style: 'output-error' };
        }
    }
});
