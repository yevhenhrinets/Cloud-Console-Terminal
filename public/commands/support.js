// commands/support.js — двухэтапная отправка обращений в поддержку (help / support / add an issue / report about a problem)
// и список обращений для администратора (reports / show reports / show issues / problems)

(function () {
    function escapeHtmlSafe(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    CommandRegistry.register({
        names: [
            'help', 'support',
            'add an issue', 'add issue', 'create issue', 'new issue',
            'report', 'report problem', 'report a problem', 'report about a problem', 'report issue',
            'поддержка', 'помощь', 'допомога', 'помогите', 'допоможіть',
            'сообщить о проблеме', 'проблема', 'тикет', '?'
        ],
        description: 'Отправить сообщение/проблему в службу поддержки (только в 2 этапа)',
        category: '🆘 Поддержка',
        usage: 'support | help | add an issue | report about a problem (без текста)',
        handler: async (parameters, options = {}) => {
            const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (!currentUser) {
                return { response: typeof t === 'function' ? t('not_authorized') : 'Ошибка авторизации.', style: 'output-error' };
            }

            const rawText = (parameters && parameters.raw_args ? String(parameters.raw_args) : (parameters && Array.isArray(parameters.args) ? parameters.args.join(' ') : '')).trim();
            const matchedCmd = (parameters && parameters.matchedCmd ? String(parameters.matchedCmd).toLowerCase() : 'support').trim();
            const prefix = matchedCmd === '?' ? 'support' : (matchedCmd || 'support');

            if (rawText && !options.fromTwoStepBar) {
                return {
                    response: `⚠️ Эта команда работает только в 2 этапа — нельзя вводить текст проблемы сразу в строке команды!\n1) Введите команду без текста (например: \`${prefix}\`)\n2) После появления команды под строкой ввода напишите описание проблемы.`,
                    style: 'output-error'
                };
            }

            if (!rawText) {
                return {
                    response: '🆘 Обращение в поддержку: опишите возникшую проблему в поле ввода и нажмите Enter (или ✕ для отмены).',
                    style: 'output-info',
                    commandPrefix: prefix,
                    inputValue: '',
                    inputPlaceholder: 'Опишите проблему для отправки администратору...'
                };
            }

            if (!window.SupportReportsSync) {
                return { response: '❌ Модуль поддержки SupportReportsSync не загружен.', style: 'output-error' };
            }

            try {
                const { report, synced } = await window.SupportReportsSync.submitSupportReport(rawText, currentUser);
                const senderEmail = report.user_email || currentUser.email || 'guest@local';
                const statusHint = synced
                    ? '✅ Сообщение записано в БД и отправлено администратору!'
                    : '📡 Сообщение сохранено локально и отправится в БД и администратору при появлении сети.';

                if (typeof window.isAdminUser === 'function' && window.isAdminUser(currentUser)) {
                    window.SupportReportsSync.markAdminSeenSupportIds([String(report.id)]);
                }

                return {
                    response: `🆘 Обращение #${report.inner_id} зарегистрировано!\n📧 Отправитель: ${senderEmail}\n📝 Текст: "${report.message}"\n${statusHint}`,
                    style: 'output-success'
                };
            } catch (err) {
                return { response: '❌ Ошибка отправки обращения: ' + (err.message || err), style: 'output-error' };
            }
        }
    });

    CommandRegistry.register({
        names: [
            'reports', 'show reports', 'show reports list', 'reports list',
            'problems', 'show problems', 'show problems list',
            'issues', 'show issues', 'issues list', 'show issues list',
            'обращения', 'жалобы', 'тикеты', 'проблемы', 'список проблем', 'список обращений', 'репорты'
        ],
        description: 'Список обращений пользователей в поддержку (для администратора)',
        category: '🆘 Поддержка',
        usage: 'reports | show reports list | show issues',
        handler: async () => {
            const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (!currentUser) {
                return { response: typeof t === 'function' ? t('not_authorized') : 'Ошибка авторизации.', style: 'output-error' };
            }

            const adminAllowed = typeof window.isAdminUser === 'function'
                ? window.isAdminUser(currentUser)
                : ['root', 'support', 'admin'].includes(String(currentUser.role || '').toLowerCase());

            if (!adminAllowed) {
                return {
                    response: '⛔ Доступ запрещён: просмотр обращений доступен только администратору. Чтобы сообщить о проблеме, введите `support` или `help`.',
                    style: 'output-error'
                };
            }

            if (!window.SupportReportsSync) {
                return { response: '❌ Модуль SupportReportsSync недоступен.', style: 'output-error' };
            }

            const reports = await window.SupportReportsSync.fetchSupportReportsForAdmin(currentUser);
            if (!reports || reports.length === 0) {
                return { response: '📭 Список обращений пользователей пуст.', style: 'output-info' };
            }

            window.SupportReportsSync.markAdminSeenSupportIds(reports.map(r => String(r.id)));

            const lines = reports.map((r, idx) => {
                const displayId = r.inner_id || (reports.length - idx);
                const dateStr = typeof formatDate === 'function' ? formatDate(r.created_at) : (r.created_at || '');
                const emailRaw = String(r.user_email || 'unknown@local');
                const safeEmail = escapeHtmlSafe(emailRaw);
                const safeMsg = escapeHtmlSafe(r.message || '');
                const statusBadge = r.status === 'resolved' ? '✅ Решено' : '🆕 Открыто';
                const mailHref = `mailto:${encodeURIComponent(emailRaw)}?subject=${encodeURIComponent(`Re: Обращение #${displayId} (Cloud Terminal)`)}`;
                return `[ID: ${displayId}] [${escapeHtmlSafe(dateStr)}] ${statusBadge} | От: <strong>${safeEmail}</strong>\n   📝 ${safeMsg}\n   <a href="${mailHref}" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">✉️ Ответить на ${safeEmail}</a>`;
            });

            const header = `📬 <strong>Обращения в поддержку (${reports.length}):</strong>\n`;
            return {
                response: header + lines.join('\n\n'),
                style: 'output-info',
                isHtml: true
            };
        }
    });
})();
