// commands/support.js — отправка обращений в поддержку (2 этапа для авторизованных, 3 этапа для гостя guest@demo.terminal с запросом e-mail/телефона)
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

    function isGuestSupportUser(user) {
        if (!user) return true;
        if (user.isGuest || user.id === 'guest') return true;
        const email = String(user.email || '').trim().toLowerCase();
        return !email || email === 'guest@demo.terminal' || email === 'guest@local';
    }

    CommandRegistry.register({
        names: [
            'help', 'support',
            'add an issue', 'add issue', 'create issue', 'new issue',
            'report', 'report problem', 'report a problem', 'report about a problem', 'report issue',
            'поддержка', 'помощь', 'допомога', 'помогите', 'допоможіть',
            'сообщить о проблеме', 'проблема', 'тикет', '?'
        ],
        description: 'Отправить сообщение/проблему в службу поддержки (2 этапа; для гостя — 3 этапа с контактом)',
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
            const isGuest = isGuestSupportUser(currentUser);

            // Шаг 1: запрещаем ввод текста в одной команде
            if (!options || !options.fromTwoStepBar) {
                if (rawText) {
                    return {
                        response: `⚠️ Эта команда работает только пошагово — нельзя вводить текст проблемы сразу в строке команды!\n1) Введите команду без текста (например: \`${prefix}\`)\n2) После появления команды под строкой ввода напишите описание проблемы${isGuest ? '\n3) Оставьте e-mail или телефон для ответа' : ''}.`,
                        style: 'output-error'
                    };
                }

                return {
                    response: '🆘 Обращение в поддержку: опишите возникшую проблему в поле ввода и нажмите Enter (или ✕ для отмены).',
                    style: 'output-info',
                    commandSteps: [prefix],
                    inputValue: '',
                    inputPlaceholder: 'Опишите проблему для отправки администратору...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [prefix];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawText).trim();

            if (!window.SupportReportsSync) {
                return { response: '❌ Модуль поддержки SupportReportsSync не загружен.', style: 'output-error' };
            }

            // Шаг 2: получили описание проблемы
            if (steps.length <= 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Введите описание проблемы (или нажмите ✕ для отмены).',
                        style: 'output-error',
                        commandSteps: [steps[0] || prefix],
                        inputValue: '',
                        inputPlaceholder: 'Опишите проблему для отправки администратору...'
                    };
                }

                // Для гостя (guest@demo.terminal) включаем обязательный 3-й этап: e-mail, телефон или оба
                if (isGuest) {
                    return {
                        response: '📞 Так как вы пишете как гость (guest@demo.terminal), укажите e-mail, телефон или оба контакта в одной строке, чтобы мы могли вам ответить:',
                        style: 'output-info',
                        commandSteps: [steps[0] || prefix, payload],
                        inputValue: '',
                        inputPlaceholder: 'Шаг 3/3: ваш e-mail, телефон или оба...'
                    };
                }

                try {
                    const { report, synced } = await window.SupportReportsSync.submitSupportReport(payload, currentUser);
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

            // Шаг 3 (для гостя): сохраняем контактную строку вместо guest@demo.terminal
            const problemText = String(steps[1] || '').trim();
            const contactText = payload;

            if (!contactText) {
                return {
                    response: '⚠️ Укажите e-mail, телефон или оба контакта, чтобы мы могли вам ответить.',
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Шаг 3/3: ваш e-mail, телефон или оба...'
                };
            }

            try {
                const { report, synced } = await window.SupportReportsSync.submitSupportReport(problemText, currentUser, contactText);
                const senderContact = report.user_email || contactText;
                const statusHint = synced
                    ? '✅ Сообщение записано в БД и отправлено администратору!'
                    : '📡 Сообщение сохранено локально с вашими контактами и синхронизируется при входе/сети.';

                if (typeof window.isAdminUser === 'function' && window.isAdminUser(currentUser)) {
                    window.SupportReportsSync.markAdminSeenSupportIds([String(report.id)]);
                }

                return {
                    response: `🆘 Обращение #${report.inner_id} зарегистрировано!\n📞 Контакт для ответа: ${senderContact}\n📝 Текст: "${report.message}"\n${statusHint}`,
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
        handler: async (parameters, options = {}) => {
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            if (!(options && options.fromTwoStepBar) && rawArgs) {
                return rejectInlineParamsError(parameters.matchedCmd || 'reports', '');
            }
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
                const contactRaw = String(r.user_email || 'unknown@local').trim();
                const safeContact = escapeHtmlSafe(contactRaw);
                const safeMsg = escapeHtmlSafe(r.message || '');
                const statusBadge = r.status === 'resolved' ? '✅ Решено' : '🆕 Открыто';

                const emailMatch = contactRaw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
                const phoneDigits = contactRaw.replace(/[^+\d]/g, '');
                let replyHtml = '';
                if (emailMatch) {
                    const mailHref = `mailto:${encodeURIComponent(emailMatch[0])}?subject=${encodeURIComponent(`Re: Обращение #${displayId} (Cloud Terminal)`)}`;
                    replyHtml = `<a href="${mailHref}" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">✉️ Ответить на ${escapeHtmlSafe(emailMatch[0])}</a>`;
                } else if (phoneDigits.length >= 6) {
                    replyHtml = `<a href="tel:${escapeHtmlSafe(phoneDigits)}" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">📞 Позвонить: ${safeContact}</a>`;
                } else {
                    replyHtml = `<span style="color:#38bdf8;font-weight:bold;">📞 Контакт для ответа: ${safeContact}</span>`;
                }

                return `[ID: ${displayId}] [${escapeHtmlSafe(dateStr)}] ${statusBadge} | От: <strong>${safeContact}</strong>\n   📝 ${safeMsg}\n   ${replyHtml}`;
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
