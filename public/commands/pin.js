// commands/pin.js — массовое закрепление заметок (строго в 2 этапа для числовых/ID параметров)

CommandRegistry.register({
    names: [
        'pin', 'pin note', 'pin the note', 'pin notes', 'pin the notes', 'pin note number', 'pin the note number',
        'fix', 'fix note', 'fix the note', 'fix notes', 'fix the notes', 'fix note number', 'fix the note number',
        'make fixed', 'make note fixed', 'make the note fixed', 'make notes fixed', 'make the notes fixed', 'make last note fixed',
        'закрепить', 'закріпити', 'приколоть', 'приколоти'
    ],

    description: 'Закрепить заметку(и) по ID (строго в 2 этапа)',
    category: 'Notes',
    usage: 'pin -> <id> | fix the note -> <id> | make last note fixed',

    handler: async (parameters, options = {}) => {
        const currentUser = await fetchCurrentUser();
        if (!currentUser) {
            return { response: t('not_authorized'), style: 'output-error' };
        }

        const matchedCmd = String((parameters && parameters.matchedCmd) || 'pin').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const argsLower = (parameters.args || []).map(a => String(a).toLowerCase());
        const isPureLastCmd = matchedCmd === 'make last note fixed';

        // Этап 1: запрещаем любые параметры (включая числа и last) прямо в строке команды
        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, '6');
            }
            if (!isPureLastCmd) {
                return {
                    response: `📌 Режим закрепления заметок (\`${matchedCmd}\`) активирован. Введите ID заметки (например: 6, 1 2, 6th или last) и нажмите Enter (или ✕ для отмены).`,
                    style: 'output-info',
                    commandPrefix: matchedCmd,
                    inputValue: '',
                    inputPlaceholder: 'Введите ID заметки (напр: 6, 1 2, 6th или last)...'
                };
            }
        }

        const targetUserId = parseTargetUser(parameters.args || []);
        const isAdmin = ['root', 'support'].includes(currentUser.role);
        const effectiveUserId = (isAdmin && targetUserId) ? targetUserId : currentUser.id;
        const isOfflineMode = !window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false) || currentUser.isGuest;

        const isLastKeyword = isPureLastCmd || argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));

        let ids = [];
        if (isLastKeyword) {
            if (!isOfflineMode) {
                try {
                    const { data, error } = await window.supabaseClient
                        .from('notes')
                        .select('inner_id')
                        .eq('created_by', effectiveUserId)
                        .is('deleted_at', null)
                        .order('inner_id', { ascending: false })
                        .limit(1);

                    if (error) throw error;
                    if (data && data.length > 0) ids = [data[0].inner_id];
                } catch (err) {
                    console.error('Ошибка поиска последнего ID для закрепления:', err);
                }
            }
            if (ids.length === 0 && window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId).filter(n => !n.deleted_at);
                if (cached.length > 0) {
                    cached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                    ids = [cached[0].inner_id];
                }
            }
        } else {
            const fullArgsStr = (parameters.args || []).join(' ');
            ids = [...new Set((fullArgsStr.match(/\d+/g) || []).map(Number).filter(n => Number.isFinite(n) && n > 0))];
        }

        if (ids.length === 0) {
            return {
                response: `❌ Укажите ID (напр: \`6\`, \`1 2\`, \`6th\`) или \`last\`.`,
                style: 'output-error'
            };
        }

        const pinOffline = () => {
            if (!window.OfflineNotesSync) return null;
            const matched = window.OfflineNotesSync.queuePinNotesOffline(effectiveUserId, ids, true);
            if (!matched || matched.length === 0) {
                return { response: `❌ Заметки [ID: ${ids.join(', ')}] не найдены в локальном кэше.`, style: 'output-error' };
            }
            return {
                response: `📌 Заметки [ID: ${matched.join(', ')}] закреплены (📡 Офлайн — синхронизируется при подключении).`,
                style: 'output-success',
                editedEntity: 'note'
            };
        };

        if (isOfflineMode) {
            const offlineRes = pinOffline();
            if (offlineRes) return offlineRes;
        }

        try {
            const { error } = await window.supabaseClient
                .from('notes')
                .update({ is_pinned: true })
                .in('inner_id', ids)
                .eq('created_by', effectiveUserId)
                .is('deleted_at', null);

            if (error) throw error;

            if (window.OfflineNotesSync) {
                const cached = window.OfflineNotesSync.getNotesCache(effectiveUserId);
                cached.forEach(n => {
                    if (ids.includes(Number(n.inner_id)) && !n.deleted_at) n.is_pinned = true;
                });
                window.OfflineNotesSync.saveNotesCache(effectiveUserId, cached);
            }

            const idsStr = ids.join(', ');
            return {
                response: `📌 Заметки [ID: ${idsStr}] успешно закреплены.`,
                style: 'output-success',
                editedEntity: 'note'
            };
        } catch (err) {
            if (window.OfflineNotesSync && window.OfflineNotesSync.isOfflineError(err)) {
                const offlineRes = pinOffline();
                if (offlineRes) return offlineRes;
            }
            return { response: '❌ Ошибка закрепления: ' + err.message, style: 'output-error' };
        }
    }
});
