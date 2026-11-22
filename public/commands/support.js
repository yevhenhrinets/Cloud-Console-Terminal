// commands/support.js — отправка обращений, просмотр issues/reports для всех ролей (с сокрытием контактов от обычных пользователей)
// и взятие/завершение заявок в работу (take issue number / resolve issue number) пошагово.

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

    // Контакты (e-mail / телефон) и управление статусами доступны только для ролей support / admin / root (не для обычных пользователей и гостей)
    function isSupportOrAdminStaff(user) {
        if (typeof window.isAdminUser === 'function') {
            return window.isAdminUser(user);
        }
        if (!user || user.isGuest || user.id === 'guest') return false;
        const role = String(user.role || '').trim().toLowerCase();
        const email = String(user.email || '').trim().toLowerCase();
        return ['root', 'support', 'admin'].includes(role) || email === 'e.grinec@gmail.com' || email === 'yevhenhrinets@gmail.com';
    }

    function formatSupportStatusBadge(rawStatus) {
        const norm = window.SupportReportsSync && typeof window.SupportReportsSync.normalizeSupportStatus === 'function'
            ? window.SupportReportsSync.normalizeSupportStatus(rawStatus)
            : String(rawStatus || 'open').toLowerCase();

        if (norm === 'resolved') return '✅ Завершено';
        if (norm === 'in_review') return '🔍 В рассмотрении';
        return '🆕 Недавно создано';
    }

    function isSkipNoteToken(val) {
        const clean = String(val || '').trim().toLowerCase();
        return clean === '-' || clean === '—' || clean === 'skip' || clean === 'пропустить' || clean === 'без комментария' || clean === 'нет' || clean === 'no';
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

                    if (isSupportOrAdminStaff(currentUser)) {
                        window.SupportReportsSync.markAdminSeenSupportIds([String(report.id)]);
                    }

                    const reportDateStr = typeof formatDate === 'function' ? formatDate(report.created_at) : (report.created_at || '');
                    return {
                        response: `🆘 Обращение #${report.inner_id} зарегистрировано!\n📅 Создано: ${reportDateStr}\n📊 Статус: 🆕 Недавно создано\n📧 Отправитель: ${senderEmail}\n📝 Текст: "${report.message}"\n${statusHint}`,
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

                if (isSupportOrAdminStaff(currentUser)) {
                    window.SupportReportsSync.markAdminSeenSupportIds([String(report.id)]);
                }

                const reportDateStr = typeof formatDate === 'function' ? formatDate(report.created_at) : (report.created_at || '');
                return {
                    response: `🆘 Обращение #${report.inner_id} зарегистрировано!\n📅 Создано: ${reportDateStr}\n📊 Статус: 🆕 Недавно создано\n📞 Контакт для ответа: ${senderContact}\n📝 Текст: "${report.message}"\n${statusHint}`,
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
        description: 'Список обращений в поддержку (дата создания, статус и детали рассмотрения видны всем; контакты — только support/админу)',
        category: '🆘 Поддержка',
        usage: 'issues | reports | show reports list | show issues',
        handler: async (parameters, options = {}) => {
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            if (!(options && options.fromTwoStepBar) && rawArgs) {
                return rejectInlineParamsError(parameters.matchedCmd || 'reports', '');
            }
            const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (!currentUser) {
                return { response: typeof t === 'function' ? t('not_authorized') : 'Ошибка авторизации.', style: 'output-error' };
            }

            if (!window.SupportReportsSync) {
                return { response: '❌ Модуль SupportReportsSync недоступен.', style: 'output-error' };
            }

            const canViewContacts = isSupportOrAdminStaff(currentUser);
            const fetchFn = typeof window.SupportReportsSync.fetchSupportReports === 'function'
                ? window.SupportReportsSync.fetchSupportReports
                : window.SupportReportsSync.fetchSupportReportsForAdmin;

            const reports = await fetchFn(currentUser);
            if (!reports || reports.length === 0) {
                return { response: '📭 Список обращений пуст.', style: 'output-info' };
            }

            if (canViewContacts) {
                window.SupportReportsSync.markAdminSeenSupportIds(reports.map(r => String(r.id)));
            }

            const lines = reports.map((r, idx) => {
                const displayId = r.inner_id || (reports.length - idx);
                const dateStr = typeof formatDate === 'function' ? formatDate(r.created_at) : (r.created_at || '');
                const safeMsg = escapeHtmlSafe(r.message || '');
                const statusBadge = formatSupportStatusBadge(r.status);
                const normStatus = window.SupportReportsSync.normalizeSupportStatus
                    ? window.SupportReportsSync.normalizeSupportStatus(r.status)
                    : String(r.status || 'open').toLowerCase();

                const subLines = [
                    `   📅 Создано: ${escapeHtmlSafe(dateStr || '—')}`,
                    `   📝 ${safeMsg}`
                ];

                // Всё, что указано во время рассмотрения / завершения — показывается ВСЕМ (admin, support и обычным пользователям)
                if (normStatus === 'in_review' || normStatus === 'resolved') {
                    const takenTimeStr = r.taken_at ? (typeof formatDate === 'function' ? formatDate(r.taken_at) : r.taken_at) : '';
                    const takenActor = (canViewContacts && r.taken_by) ? ` (${escapeHtmlSafe(r.taken_by)})` : '';
                    if (takenTimeStr || takenActor) {
                        subLines.push(`   👤 Взято в рассмотрение${takenActor}${takenTimeStr ? `: ${escapeHtmlSafe(takenTimeStr)}` : ''}`);
                    }
                    if (normStatus === 'resolved') {
                        const resolvedTimeStr = r.resolved_at ? (typeof formatDate === 'function' ? formatDate(r.resolved_at) : r.resolved_at) : '';
                        const resolvedActor = (canViewContacts && r.resolved_by) ? ` (${escapeHtmlSafe(r.resolved_by)})` : '';
                        if (resolvedTimeStr || resolvedActor) {
                            subLines.push(`   🏁 Завершено${resolvedActor}${resolvedTimeStr ? `: ${escapeHtmlSafe(resolvedTimeStr)}` : ''}`);
                        }
                    }
                }
                if (r.review_note && String(r.review_note).trim() !== '') {
                    subLines.push(`   💬 Детали рассмотрения: <em>${escapeHtmlSafe(r.review_note)}</em>`);
                }

                // Строчка с контактными данными (email/phone) — ТОЛЬКО для ролей support / администратор
                if (canViewContacts) {
                    const contactRaw = String(r.user_email || 'unknown@local').trim();
                    const safeContact = escapeHtmlSafe(contactRaw);
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
                    subLines.push(`   ${replyHtml}`);
                    return `[ID: ${displayId}] ${statusBadge} | От: <strong>${safeContact}</strong>\n${subLines.join('\n')}`;
                }

                // Обычный пользователь / гость — БЕЗ контактных данных (email/phone)
                return `[ID: ${displayId}] ${statusBadge}\n${subLines.join('\n')}`;
            });

            const header = `📬 <strong>Обращения в поддержку (${reports.length}):</strong>\n`;
            return {
                response: header + lines.join('\n\n'),
                style: 'output-info',
                isHtml: true
            };
        }
    });

    async function handleIssueTransitionCommand(parameters, options, targetStatus, defaultCmdLabel) {
        const currentUser = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
        if (!currentUser) {
            return { response: typeof t === 'function' ? t('not_authorized') : 'Ошибка авторизации.', style: 'output-error' };
        }

        if (!isSupportOrAdminStaff(currentUser)) {
            return {
                response: '⛔ Доступ запрещён: изменять статус заявок могут только роли support или администратор.',
                style: 'output-error'
            };
        }

        if (!window.SupportReportsSync) {
            return { response: '❌ Модуль SupportReportsSync недоступен.', style: 'output-error' };
        }

        const rawText = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
        const matchedCmd = (parameters && parameters.matchedCmd ? String(parameters.matchedCmd).toLowerCase() : defaultCmdLabel).trim();
        const prefix = matchedCmd || defaultCmdLabel;

        // Шаг 1: только словесная команда без номера
        if (!options || !options.fromTwoStepBar) {
            if (rawText) {
                return rejectInlineParamsError(
                    prefix,
                    '1',
                    `💡 Команда \`${prefix}\` ожидает ID заявки отдельным шагом: сначала введите \`${prefix}\`, а затем на 2-м этапе укажите внутренний ID заявки (из \`issues\` / \`reports\`).`
                );
            }

            return {
                response: targetStatus === 'in_review'
                    ? '🔍 Взятие заявки в рассмотрение: команда ожидает ID заявки (введите внутренний номер ID из списка `issues` / `reports`):'
                    : '✅ Завершение заявки: команда ожидает ID заявки (введите внутренний номер ID из списка `issues` / `reports`):',
                style: 'output-info',
                commandSteps: [prefix],
                inputValue: '',
                inputPlaceholder: 'Команда ожидает ID заявки (например: 1)...'
            };
        }

        const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [prefix];
        const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawText).trim();

        // Шаг 2: получаем внутренний ID заявки
        if (steps.length <= 1) {
            const num = Number(payload);
            if (!payload || !Number.isInteger(num) || num <= 0) {
                return {
                    response: '⚠️ Команда ожидает ID заявки — укажите корректный внутренний ID заявки (целое положительное число из списка `issues` / `reports`).',
                    style: 'output-error',
                    commandSteps: [steps[0] || prefix],
                    inputValue: '',
                    inputPlaceholder: 'Команда ожидает ID заявки (например: 1)...'
                };
            }

            const reports = await window.SupportReportsSync.fetchSupportReports(currentUser);
            const found = reports.find(r => Number(r.inner_id) === num);
            if (!found) {
                return {
                    response: `❌ Заявка с ID #${num} не найдена. Команда ожидает существующий ID заявки — проверьте номера командой \`issues\` или \`reports\`.`,
                    style: 'output-error',
                    commandSteps: [steps[0] || prefix],
                    inputValue: '',
                    inputPlaceholder: 'Команда ожидает ID заявки (например: 1)...'
                };
            }

            const foundDateStr = typeof formatDate === 'function' ? formatDate(found.created_at) : (found.created_at || '');
            return {
                response: `📋 Заявка [ID: ${num}] (📅 Создано: ${foundDateStr}): "${found.message}"\n💬 Шаг 3/3: укажите детали / комментарий рассмотрения (будет виден всем пользователям) или отправьте \`-\`, чтобы оставить без комментария:`,
                style: 'output-info',
                commandSteps: [steps[0] || prefix, String(num)],
                inputValue: '',
                inputPlaceholder: 'Шаг 3/3: детали рассмотрения (или - чтобы пропустить)...'
            };
        }

        // Шаг 3: применяем статус и сохраняем комментарий рассмотрения
        const targetNum = Number(steps[1]);
        const reviewNote = isSkipNoteToken(payload) ? '' : payload;

        const res = await window.SupportReportsSync.updateSupportReportStatus(targetNum, targetStatus, currentUser, reviewNote);
        if (!res || !res.ok) {
            return {
                response: `❌ Заявка с ID #${targetNum} не найдена.`,
                style: 'output-error'
            };
        }

        const statusBadge = formatSupportStatusBadge(targetStatus);
        const createdDateStr = res.report && res.report.created_at && typeof formatDate === 'function'
            ? formatDate(res.report.created_at)
            : '';
        const dateLine = createdDateStr ? `\n📅 Создано: ${createdDateStr}` : '';
        const noteLine = reviewNote ? `\n💬 Детали рассмотрения: "${reviewNote}"` : '';
        const syncLine = res.synced
            ? '\n☁️ Статус синхронизирован с БД.'
            : '\n📡 Статус сохранён локально и синхронизируется с БД при сети/входе.';

        return {
            response: `🔄 Заявка [ID: ${targetNum}] переведена в статус: ${statusBadge}${dateLine}${noteLine}${syncLine}`,
            style: 'output-success'
        };
    }

    CommandRegistry.register({
        names: [
            'take issue number', 'take issue',
            'take an issue', 'take the issue', 'take an issue number', 'take the issue number',
            'take report number', 'take report',
            'take a report', 'take the report', 'take a report number', 'take the report number',
            'взять заявку', 'взять заявку номер', 'взять зявку номер',
            'взять в работу заявку', 'взять в работу заявку номер', 'взять в работу',
            'взять обращение', 'взять обращение номер',
            'взять тикет', 'взять тикет номер',
            'рассмотреть заявку', 'рассмотреть заявку номер'
        ],
        description: 'Взять заявку из issues/reports в рассмотрение (пошагово: команда -> ID заявки -> комментарий)',
        category: '🆘 Поддержка',
        usage: 'take issue number | take an issue | take the report | взять заявку номер',
        handler: async (parameters, options = {}) => {
            return await handleIssueTransitionCommand(parameters, options, 'in_review', 'take issue number');
        }
    });

    CommandRegistry.register({
        names: [
            'resolve issue number', 'resolve issue',
            'resolve an issue', 'resolve the issue', 'resolve the issue number',
            'resolve report number', 'resolve report', 'resolve a report', 'resolve the report', 'resolve the report number',
            'complete issue number', 'complete issue', 'complete report', 'complete report number',
            'close issue number', 'close issue', 'close report', 'close report number',
            'finish issue', 'finish issue number',
            'завершить заявку', 'завершить заявку номер',
            'закрыть заявку', 'закрыть заявку номер',
            'решить заявку', 'решить заявку номер',
            'завершить обращение', 'завершить обращение номер'
        ],
        description: 'Завершить рассмотрение заявки из issues/reports (пошагово: команда -> ID заявки -> итог)',
        category: '🆘 Поддержка',
        usage: 'resolve issue number | завершить заявку номер',
        handler: async (parameters, options = {}) => {
            return await handleIssueTransitionCommand(parameters, options, 'resolved', 'resolve issue number');
        }
    });
})();
