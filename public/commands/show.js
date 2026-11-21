// commands/show.js — списки и обзоры (show notes, show history)

CommandRegistry.register({
    names: ['show notes', 'notes', 'заметки', 'нотатки'],

    description: 'Показать список активных заметок',
    category: 'CRUD',
    usage: 'show notes | show notes of user -> <UUID>',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) return { response: t('not_authorized'), style: 'output-error' };

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'show notes').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

        if (!(options && options.fromTwoStepBar) && rawArgs) {
            return rejectInlineParamsError('read note', '3', '💡 Для списка всех заметок введите просто `show notes`.');
        }

        const formatCachedNotes = (notesList, labelSuffix = '') => {
            const active = (notesList || []).filter(n => !n.deleted_at);
            if (active.length === 0) {
                return { response: 'Список заметок пуст.', style: 'output-info' };
            }
            active.sort((a, b) => {
                if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
                return Number(b.inner_id || 0) - Number(a.inner_id || 0);
            });
            const header = `Ваши активные заметки${labelSuffix}:\n`;
            const body = active.map(row => {
                const pinMark = row.is_pinned ? ' 📌' : '';
                const timeStr = formatDate(row.updated_at || row.created_at);
                const versionStr = (row.version && row.version > 1) ? ` (v${row.version})` : '';
                const pendingMark = row._pendingOffline ? ' 📡' : '';
                return `[ID: ${row.inner_id}] [${timeStr}]${versionStr} ${row.content}${pinMark}${pendingMark}`;
            }).join('\n');
            return { response: header + body, style: 'output-info' };
        };

        if (currentUser.isGuest) {
            const cachedGuest = window.OfflineNotesSync ? window.OfflineNotesSync.getNotesCache('guest') : [];
            if (cachedGuest && cachedGuest.length > 0) {
                return formatCachedNotes(cachedGuest, ' (Локально)');
            }
            return {
                response: '📝 Нотатки (Демо-режим):\n[ID: 1] Купити молоко і каву 📌\n[ID: 2] Перевірити лічильники води\n\n💡 Для збереження власних нотаток у хмару Supabase виконайте команду `login`',
                style: 'output-info'
            };
        }

        const targetUserId = parseTargetUser(parameters.args || []);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;

        if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            const cached = window.OfflineNotesSync ? window.OfflineNotesSync.getNotesCache(effectiveUserId) : [];
            return formatCachedNotes(cached, ' (📡 Офлайн-режим)');
        }

        try {
            if (window.OfflineNotesSync) {
                await window.OfflineNotesSync.flushPendingNotes();
            }

            let query = window.supabaseClient
                .from('notes')
                .select('*')
                .is('deleted_at', null)
                .eq('created_by', effectiveUserId);

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            if (!data || data.length === 0) {
                if (window.OfflineNotesSync) window.OfflineNotesSync.saveNotesCache(effectiveUserId, []);
                return { response: 'Список заметок пуст.', style: 'output-info' };
            }

            const latestNotesMap = new Map();
            data.forEach(note => {
                if (!latestNotesMap.has(note.inner_id) || note.version > latestNotesMap.get(note.inner_id).version) {
                    latestNotesMap.set(note.inner_id, note);
                }
            });

            const activeNotes = Array.from(latestNotesMap.values()).sort((a, b) => b.inner_id - a.inner_id);
            if (window.OfflineNotesSync) {
                window.OfflineNotesSync.saveNotesCache(effectiveUserId, activeNotes);
            }

            const response = "Ваши активные заметки:\n" +
                activeNotes.map(row => {
                    const pinMark = row.is_pinned ? ' 📌' : '';
                    const timeStr = formatDate(row.updated_at || row.created_at);
                    const versionStr = row.version > 1 ? ` (v${row.version})` : '';
                    return `[ID: ${row.inner_id}] [${timeStr}]${versionStr} ${row.content}${pinMark}`;
                }).join('\n');

            return { response, style: 'output-info' };
        } catch (err) {
            if (window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId);
                return formatCachedNotes(cached, ' (📡 Офлайн-кэш)');
            }
            return { response: '❌ Ошибка загрузки заметок: ' + err.message, style: 'output-error' };
        }
    }
});

CommandRegistry.register({
    names: ['show history', 'show commands history'],

    description: 'Показать историю команд (50 последних или через history limit)',
    category: 'CRUD',
    usage: 'show history | history limit -> <100>',

    handler: async (parameters, options = {}) => {
        const historyHandler = window.CommandRegistry.getHandler('history');
        if (historyHandler) {
            return await historyHandler(parameters, options);
        }
        return { response: 'Модуль history не найден.', style: 'output-error' };
    }
});
