// commands/houses.js — строго поэтапное создание Домов, Комнат и Предметов (привязка к аккаунту)

(function () {
    async function requireAuthedUserForHouses() {
        const user = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser(true) : null;
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            return {
                user: null,
                error: {
                    response: '🔒 Управление Домами доступно только авторизованным пользователям. Выполните вход через Google (команда `login`).',
                    style: 'output-error'
                }
            };
        }
        return { user, error: null };
    }

    async function requireAdminForHouses() {
        const { user, error } = await requireAuthedUserForHouses();
        if (error) return { user: null, error };
        const isAdmin = typeof window.isAdminUser === 'function'
            ? window.isAdminUser(user)
            : (['root', 'support', 'admin'].includes(String(user.role || '').toLowerCase()));
        if (!isAdmin) {
            return {
                user: null,
                error: {
                    response: '🔒 Смена комнат местами и финализация дома — привилегия администраторов.',
                    style: 'output-error'
                }
            };
        }
        return { user, error: null };
    }

    function formatHousesSummary(user) {
        const list = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
        if (!list.length) return 'у вас пока нет домов';
        return list.map(h => `\`${h.number || h.id}\` (${h.name})`).join(', ');
    }

    function formatRoomsSummary(house) {
        if (!house) return 'нет комнат';
        const rooms = Array.isArray(house.rooms) ? house.rooms : [];
        if (rooms.length === 0) {
            return house.builtin ? '`kitchen`, `hall`, `room`, `corridor`' : 'комнат пока нет';
        }
        return rooms.map((r, i) => `${i + 1}: \`${r.name}\``).join(', ');
    }

    function isKeywordStep(payload, acceptedList) {
        const clean = String(payload || '').trim().toLowerCase().replace(/[:.!]+$/g, '').replace(/\s+/g, ' ');
        return acceptedList.includes(clean);
    }

    // 1. Add house / add home (2 этапа: 1: Add house -> 2: <номер или название>)
    CommandRegistry.register({
        names: ['add house', 'add home', 'create house', 'create home', 'new house', 'new home', 'добавить дом', 'додати дім', 'додати будинок'],
        description: 'Создать новый Дом для текущего аккаунта (строго в 2 этапа: Add house ➔ номер/название)',
        category: 'House',
        usage: 'Add house -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const matchedCmd = String((parameters && parameters.matchedCmd) || 'Add house').trim();
            const baseLabel = matchedCmd.toLowerCase().includes('home') ? 'add home' : 'Add house';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: `⚠️ Команда \`${baseLabel}\` выполняется строго поэтапно (без параметров в одной строке)!\n1️⃣ Этап 1: введите \`${baseLabel}\`\n2️⃣ Этап 2: введите номер или название дома (например: \`2\` или \`Дача\`).`,
                        style: 'output-error'
                    };
                }
                return {
                    response: `🏠 ${baseLabel} (Этап 1/2): введите номер или название нового дома (например: \`2\` или \`House_name\`) и нажмите Enter или ✅.`,
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/2: номер или название дома (напр: 2)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (!payload) {
                return {
                    response: '⚠️ Введите номер или название нового дома (например: `2`).',
                    style: 'output-error',
                    commandSteps: [steps[0] || baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/2: номер или название дома...'
                };
            }

            try {
                const res = await window.UserHousesSync.addHouse(user, payload);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `✅ Создан новый пустой дом "${res.house.name}" (адрес: ${res.house.url}) для аккаунта ${user.email}.\n${syncText}\n💡 Следующий шаг: \`Add room\` ➔ название комнаты (напр: \`kitchen\`) ➔ \`to house\` ➔ \`${res.house.number || res.house.name}\`.`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: '❌ ' + (err && err.message ? err.message : String(err)),
                    style: 'output-error'
                };
            }
        }
    });

    // 2. Add room (4 этапа: 1: Add room -> 2: kitchen -> 3: to house -> 4: 2/House_name)
    CommandRegistry.register({
        names: ['add room', 'create room', 'new room', 'добавить комнату', 'додати кімнату'],
        description: 'Добавить комнату в дом текущего аккаунта (строго в 4 этапа: Add room ➔ имя ➔ to house ➔ дом)',
        category: 'House',
        usage: 'Add room -> kitchen -> to house -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'Add room';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `Add room` выполняется строго поэтапно (однострочный синтаксис не используется)!\n1️⃣ `Add room`\n2️⃣ название комнаты (например: `kitchen`)\n3️⃣ `to house`\n4️⃣ номер или название дома (например: `2`).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🚪 Add room (Этап 1/4): введите название новой комнаты (например: `kitchen`) и нажмите Enter или ✅.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/4: название комнаты (напр: kitchen)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            const cleanVal = (typeof window.stripLeadingValidArticle === 'function')
                ? window.stripLeadingValidArticle(payload)
                : payload;

            // Этап 2 -> получили название комнаты -> парсер сам подставляет `to house`
            if (steps.length === 1) {
                if (!cleanVal) {
                    return {
                        response: '⚠️ Введите название комнаты (например: `kitchen`).',
                        style: 'output-error',
                        commandSteps: [steps[0] || baseLabel],
                        inputValue: '',
                        inputPlaceholder: 'Этап 2: название комнаты (напр: kitchen)...'
                    };
                }
                return {
                    response: `🚪 Комната: "${cleanVal}" ➔ парсер добавил \`to house\`.\n🏠 Следующий шаг: введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [steps[0] || baseLabel, cleanVal, 'to house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома (напр: 2)...'
                };
            }

            // Совместимость, если ключ передан вручную
            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['to house', 'to home', 'в дом', 'до дому', 'до будинку'])) {
                    return {
                        response: `⚠️ Введите \`to house\` (для комнаты "${steps[1]}").`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите to house...'
                    };
                }
                return {
                    response: `🏠 Введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [steps[0], steps[1], 'to house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома (напр: 2)...'
                };
            }

            // Финал -> создаём комнату в выбранном доме
            const roomName = String(steps[1] || '').trim();
            if (!cleanVal) {
                return {
                    response: `⚠️ Укажите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            try {
                const res = await window.UserHousesSync.addRoom(user, roomName, cleanVal);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `✅ Комната "${res.room.name}" добавлена в "${res.house.name}" (всего комнат: ${res.house.rooms.length}).\n${syncText}\n💡 Добавить предмет: \`add thing\` ➔ \`desk\` ➔ \`${res.room.name}\` ➔ \`${res.house.number || res.house.name}\` ➔ \`2\`.`,
                    style: 'output-success'
                };
            } catch (err) {
                const msg = err && err.message ? err.message : String(err);
                return {
                    response: `❌ ${msg}\nДоступные дома: ${formatHousesSummary(user)}`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }
        }
    });

    // 3. Add thing (парсер сам подставляет to room, of house, with queue id)
    CommandRegistry.register({
        names: ['add thing', 'add item', 'add furniture', 'new thing', 'добавить предмет', 'добавить вещь', 'додати річ', 'додати предмет'],
        description: 'Добавить предмет в комнату дома (поэтапно, ключевые слова `to room`, `of house`, `with queue id` подставляются автоматически)',
        category: 'House',
        usage: 'add thing -> desk -> to room -> kitchen -> of house -> 2 -> with queue id -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'add thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `add thing` выполняется поэтапно!\nВы вводите только значения, а парсер сам подставляет `to room`, `of house` и `with queue id`:\n1️⃣ `add thing`\n2️⃣ предмет, цвет и форма (напр: `table brown 2x1`, `desk green`, `round table 2x2`, `bed`)\n3️⃣ (авто: `to room`) ➔ комната (`kitchen`, `hall` или номер)\n4️⃣ (авто: `of house`) ➔ дом (`1`, `2`, `Чапаева` или название)\n5️⃣ (авто: `with queue id`) ➔ номер очереди (`2`, или `0` если без очереди).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🪑 add thing (Шаг 1/4): введите название предмета (можно с цветом и формой/размером, напр: `table brown 2x1`, `desk green`, `round table 2x2`, `sofa`). Ключевые слова `to room`, `of house`, `with queue id` парсер подставит автоматически.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Предмет (напр: table brown 2x1)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();
            const cleanPayload = (typeof window.stripLeadingValidArticle === 'function')
                ? window.stripLeadingValidArticle(payload)
                : payload;

            // Шаг 2: название предмета -> парсер сам подставляет `to room`
            if (steps.length === 1) {
                if (!cleanPayload) {
                    return {
                        response: '⚠️ Введите название предмета (например: `table brown 2x1` или `desk`).',
                        style: 'output-error',
                        commandSteps: [steps[0] || baseLabel],
                        inputValue: '',
                        inputPlaceholder: 'Предмет (напр: table brown 2x1)...'
                    };
                }
                return {
                    response: `🪑 Предмет: "${cleanPayload}" ➔ парсер добавил \`to room\`.\n🚪 Шаг 2/4: введите название или номер комнаты (например: \`kitchen\` или \`2\`).`,
                    style: 'output-info',
                    commandSteps: [steps[0] || baseLabel, cleanPayload, 'to room'],
                    inputValue: '',
                    inputPlaceholder: 'Комната (напр: kitchen или 2)...'
                };
            }

            // Legacy-совместимость для `to room`
            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['to room', 'в комнату', 'до кімнати'])) {
                    return {
                        response: `⚠️ Введите \`to room\` (чтобы указать комнату для "${steps[1]}").`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите to room...'
                    };
                }
                return {
                    response: '🚪 Введите название или номер комнаты (например: `kitchen` или `2`).',
                    style: 'output-info',
                    commandSteps: [...steps, 'to room'],
                    inputValue: '',
                    inputPlaceholder: 'Комната (напр: kitchen или 2)...'
                };
            }

            // Шаг 3: комната -> парсер сам подставляет `of house`
            if (steps.length === 3) {
                if (!cleanPayload) {
                    return {
                        response: '⚠️ Введите название или номер комнаты (например: `kitchen` или `2`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Комната (напр: kitchen или 2)...'
                    };
                }
                return {
                    response: `🚪 Комната: "${cleanPayload}" ➔ парсер добавил \`of house\`.\n🏠 Шаг 3/4: введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, cleanPayload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома (напр: 2)...'
                };
            }

            // Legacy-совместимость для `of house`
            if (steps.length === 4) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'из дома', 'в доме', 'будинку'])) {
                    return {
                        response: '⚠️ Введите `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите of house...'
                    };
                }
                return {
                    response: `🏠 Введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома (напр: 2)...'
                };
            }

            // Шаг 4: дом -> проверка и авто-подстановка `with queue id`
            if (steps.length === 5) {
                if (!cleanPayload) {
                    return {
                        response: `⚠️ Введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Номер или название дома...'
                    };
                }
                const targetHouse = window.UserHousesSync ? window.UserHousesSync.findHouse(user, cleanPayload) : null;
                if (!targetHouse) {
                    return {
                        response: `❌ Дом "${cleanPayload}" не найден в вашем аккаунте. Доступны: ${formatHousesSummary(user)}.`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Номер или название дома...'
                    };
                }
                const targetRoom = window.UserHousesSync.findRoom(targetHouse, steps[3]);
                const builtinRoomKeys = ['kitchen', 'hall', 'room', 'corridor', 'кухня', 'зал', 'комната', 'коридор', '1', '2', '3', '4'];
                if (!targetRoom && !(targetHouse.builtin && builtinRoomKeys.includes(String(steps[3] || '').toLowerCase()))) {
                    return {
                        response: `❌ Комната "${steps[3]}" не найдена в "${targetHouse.name}" (${formatRoomsSummary(targetHouse)}).\nСначала создайте её командой \`Add room\`, или нажмите ✕ на шаге комнаты.`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Другой дом...'
                    };
                }
                return {
                    response: `🏠 Дом: "${targetHouse.name}" ➔ парсер добавил \`with queue id\`.\n🔢 Шаг 4/4: введите номер очереди (например: \`2\`, или \`0\` / \`-\` если без привязки).`,
                    style: 'output-info',
                    commandSteps: [...steps, cleanPayload, 'with queue id'],
                    inputValue: '',
                    inputPlaceholder: 'Номер очереди (напр: 2 или 0)...'
                };
            }

            // Legacy-совместимость для `with queue id` / `queue id`
            if (steps.length === 6) {
                if (!isKeywordStep(payload, ['with queue id', 'with queue', 'queue id', 'queue', 'id очереди', 'очередь'])) {
                    return {
                        response: '⚠️ Введите `with queue id` (или сразу число на следующем шаге).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите with queue id...'
                    };
                }
                return {
                    response: '🔢 Финальный шаг: введите номер очереди (например: `2`, или `0` / `-` если предмет без привязки к очереди).',
                    style: 'output-info',
                    commandSteps: [...steps, 'with queue id'],
                    inputValue: '',
                    inputPlaceholder: 'Номер очереди (напр: 2 или 0)...'
                };
            }

            // Финал (steps.length >= 7): значение queue id и сохранение предмета
            const thingName = steps[1];
            const roomRef = steps[3];
            const houseRef = steps[5];
            const lowerQ = payload.toLowerCase();
            let queueNum = 0;
            if (lowerQ !== '0' && lowerQ !== '-' && lowerQ !== 'none' && lowerQ !== 'нет' && lowerQ !== 'без') {
                if (!/^\d+$/.test(payload)) {
                    return {
                        response: '⚠️ Укажите числовой номер очереди (например: `2`) или `0` / `-` если без очереди.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Номер очереди (напр: 2 или 0)...'
                    };
                }
                queueNum = parseInt(payload, 10) || 0;
            }

            try {
                const res = await window.UserHousesSync.addThing(user, thingName, roomRef, houseRef, queueNum);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально (отправится в БД при подключении).';
                const qText = queueNum > 0 ? `with queue id #${queueNum}` : 'без очереди';
                const colorText = res.thing.color ? `, цвет: ${res.thing.color}` : '';
                const shapeText = res.thing.shape && res.thing.shape !== 'rect' ? `, форма: ${res.thing.shape}` : '';
                const doorText = Math.min(res.thing.w, res.thing.h) <= 2 ? 'проходит в двери (≤ 2 пл.)' : 'не проходит в двери (> 2 пл.)';
                return {
                    response: `✅ Предмет "${res.thing.name}" (${res.thing.w}×${res.thing.h}${colorText}${shapeText}, ${qText}, ${doorText}) размещён в комнате "${res.room.name}" дома "${res.house.name}" (коорд. ${res.thing.col},${res.thing.row}, ID: \`${res.thing.id}\`).\n${syncText}\n💡 Изменить позже: \`color thing\`, \`shape thing\`, \`queue thing\`.`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: '❌ ' + (err && err.message ? err.message : String(err)),
                    style: 'output-error'
                };
            }
        }
    });

    // 4. Просмотр своих домов, комнат и вещей
    CommandRegistry.register({
        names: ['show houses', 'my houses', 'houses', 'дома', 'мои дома', 'показати будинки', 'показать дома'],
        description: 'Показать список домов, комнат и предметов текущего аккаунта',
        category: 'House',
        usage: 'show houses',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            if (!(options && options.fromTwoStepBar) && parameters && parameters.raw_args && parameters.raw_args.trim()) {
                return rejectInlineParamsError('show houses', '');
            }

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }

            const list = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (list.length === 0) {
                return {
                    response: '🏘️ У вашего аккаунта пока нет домов. Создайте первый командой `Add house`.',
                    style: 'output-info'
                };
            }

            const lines = [`🏘️ Дома аккаунта ${user.email} (${list.length}):`];
            list.forEach((h, idx) => {
                const rooms = Array.isArray(h.rooms) ? h.rooms : [];
                const things = Array.isArray(h.things) ? h.things : [];
                const readyTag = (h.isReady || h.ready || h.locked) ? ' • ✅ готов (зафиксирован)' : '';
                const typeNote = (h.builtin ? 'встроенный шаблон + ваши добавления' : (rooms.length === 0 ? 'пустой' : `${rooms.length} комн.`)) + readyTag;
                lines.push(`\n${idx + 1}. 🏠 ${h.name} [${typeNote}] — ${h.url}`);
                if (rooms.length > 0) {
                    lines.push(`   🚪 Комнаты: ${rooms.map((r, rIdx) => `${rIdx + 1}) ${r.name}`).join(', ')}`);
                }
                if (things.length > 0) {
                    lines.push(`   🪑 Предметы (${things.length}): ${things.map(t => `${t.name} (${t.roomName}${t.queueId > 0 ? ', queue #' + t.queueId : ''})`).join(', ')}`);
                }
            });

            return {
                response: lines.join('\n'),
                style: 'output-info'
            };
        }
    });

    // 5. SQL-скрипт для создания таблиц Домов и раскладов в Supabase
    CommandRegistry.register({
        names: ['houses sql', 'house sql', 'houses db', 'sql houses'],
        description: 'Показать SQL-скрипт для создания таблиц user_houses и house_layouts в Supabase',
        category: 'House',
        usage: 'houses sql',
        handler: async () => {
            const sql = (window.UserHousesSync && typeof window.UserHousesSync.getSetupSql === 'function')
                ? window.UserHousesSync.getSetupSql()
                : '';
            return {
                response: `🗄️ SQL-скрипт для создания таблиц Домов (user_houses + house_layouts с RLS по аккаунтам) в Supabase SQL Editor:\n\n${sql}`,
                style: 'output-info'
            };
        }
    });

    // 6. Принудительная синхронизация домов и раскладов с БД
    CommandRegistry.register({
        names: ['sync houses', 'синхронизировать дома'],
        description: 'Синхронизировать дома и расклады с базой данных Supabase',
        category: 'House',
        usage: 'sync houses',
        handler: async () => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;
            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user);
            }
            if (window.HouseLayoutSync && typeof window.HouseLayoutSync.flushPendingHouseLayouts === 'function') {
                await window.HouseLayoutSync.flushPendingHouseLayouts();
            }
            const missingUh = window.UserHousesSync && typeof window.UserHousesSync.isTableMissing === 'function' && window.UserHousesSync.isTableMissing();
            const missingHl = window.HouseLayoutSync && typeof window.HouseLayoutSync.isHouseLayoutsTableMissing === 'function' && window.HouseLayoutSync.isHouseLayoutsTableMissing();
            if (missingUh || missingHl) {
                return {
                    response: '⚠️ Таблицы `user_houses` / `house_layouts` ещё не созданы в Supabase (сейчас используется резервное хранилище).\nВведите `houses sql` чтобы получить SQL-скрипт для Supabase SQL Editor.',
                    style: 'output-error'
                };
            }
            return {
                response: `🟢 Дома и расклады аккаунта ${user.email} синхронизированы с таблицами Supabase (\`user_houses\`, \`house_layouts\`).`,
                style: 'output-success'
            };
        }
    });

    async function resolveHouseContext(options, houseRef) {
        const runtime = options && options.houseRuntime;
        if (options && options.fromHouseUI && runtime && runtime.user && !runtime.user.isGuest && runtime.user.id && runtime.user.id !== 'guest' && runtime.house && runtime.room) {
            return { user: runtime.user, house: runtime.house, room: runtime.room, error: null };
        }
        const { user, error } = await requireAuthedUserForHouses();
        if (error) return { user: null, house: null, room: null, error };

        if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
            await window.UserHousesSync.syncFromDb(user).catch(() => {});
        }
        const house = window.UserHousesSync ? window.UserHousesSync.findHouse(user, houseRef) : null;
        if (!house) {
            return {
                user,
                house: null,
                room: null,
                error: {
                    response: `❌ Дом "${houseRef}" не найден в вашем аккаунте. Доступны: ${formatHousesSummary(user)}.`,
                    style: 'output-error'
                }
            };
        }
        const engine = window.HouseLayoutEngine;
        const room = engine && typeof engine.loadHeadlessHouseRoom === 'function'
            ? engine.loadHeadlessHouseRoom(user, house)
            : null;
        if (!room) {
            return {
                user,
                house,
                room: null,
                error: {
                    response: `❌ Не удалось загрузить расстановку дома "${house.name}".`,
                    style: 'output-error'
                }
            };
        }
        if (window.HouseLayoutSync && typeof window.HouseLayoutSync.fetchRoomLayoutFromDb === 'function') {
            try {
                const remote = await window.HouseLayoutSync.fetchRoomLayoutFromDb(room.id);
                const localTs = Number(localStorage.getItem(room.tsKey) || '0') || 0;
                const remoteTs = remote ? (Number(remote.ts) || (remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0)) : 0;
                if (remote && remote.layout && remoteTs > localTs) {
                    engine.applyLayoutMap(room, remote.layout);
                    engine.saveRoomLayoutLocalOnly(user, room, remoteTs);
                }
            } catch (e) {}
        }
        return { user, house, room, error: null };
    }

    function parseRotationDelta(rawDir) {
        const clean = String(rawDir || '').trim().toLowerCase().replace(/°/g, '');
        if (['+90', '90', 'cw', 'right', 'по', 'по часовой', 'за годинниковою', 'вправо', 'clockwise'].includes(clean)) return 90;
        if (['-90', 'ccw', 'left', 'против', 'против часовой', 'проти годинникової', 'влево', 'counterclockwise', '270'].includes(clean)) return -90;
        return null;
    }

    function parseMoveCoords(rawCoords) {
        const clean = String(rawCoords || '').trim().replace(/[()[\]]/g, '');
        const match = clean.match(/^(\d+)\s*[,;:\s]\s*(\d+)$/);
        if (!match) return null;
        return { col: parseInt(match[1], 10), row: parseInt(match[2], 10) };
    }

    // 7. Поворот предмета в комнате дома (по часовой +90 / против часовой -90)
    CommandRegistry.register({
        names: ['rotate thing', 'rotate item', 'rotate', 'повернуть предмет', 'повернуть вещь', 'повернуть', 'повернути предмет', 'повернути'],
        description: 'Повернуть предмет в доме на +90° или -90° (строго поэтапно: rotate thing ➔ предмет ➔ +90/-90 ➔ of house ➔ дом)',
        category: 'House',
        usage: 'rotate thing -> sofa2 -> +90 -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const baseLabel = 'rotate thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                const { error } = await requireAuthedUserForHouses();
                if (error) return error;
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `rotate thing` выполняется строго поэтапно!\n1️⃣ `rotate thing`\n2️⃣ предмет (напр: `sofa2` или `Диван`)\n3️⃣ `+90` или `-90`\n4️⃣ `of house`\n5️⃣ номер или название дома (напр: `2`).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '↻ rotate thing (Этап 1/5): введите ID или название предмета и нажмите Enter или ✅.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет (напр: fridge2 или Диван)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Укажите ID или название предмета.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 2/5: предмет...'
                    };
                }
                return {
                    response: `↻ Предмет: "${payload}".\n➡️ Этап 3/5: введите \`+90\` (по часовой) или \`-90\` (против часовой).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/5: +90 или -90...'
                };
            }

            if (steps.length === 2) {
                if (parseRotationDelta(payload) === null) {
                    return {
                        response: '⚠️ Укажите направление поворота: `+90` (или `cw`) либо `-90` (или `ccw`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: '+90 или -90...'
                    };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `↻ Направление: ${parseRotationDelta(payload) > 0 ? '+90°' : '-90°'} ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return {
                        response: '⚠️ Введите `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите of house...'
                    };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            const itemRef = steps[1];
            const deltaDeg = parseRotationDelta(steps[2]);
            const houseRef = payload;

            if (deltaDeg === null) {
                return { response: '❌ Некорректный угол поворота.', style: 'output-error' };
            }

            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            const engine = window.HouseLayoutEngine;
            const item = engine.resolveItemInRoom(ctx.room, itemRef);
            if (!item) {
                return { response: `❌ Предмет "${itemRef}" не найден в "${ctx.house.name}".`, style: 'output-error' };
            }
            if (item.hidden) {
                return { response: `⚠️ Предмет "${engine.getItemLabel(item)}" скрыт. Сначала верните его командой \`unhide thing\`.`, style: 'output-error' };
            }

            const nextDims = engine.getRotatedDimensions(item.baseW, item.baseH, (item.rot || 0) + deltaDeg);
            const spot = engine.findRotationSpot(ctx.room, item, nextDims.w, nextDims.h);
            if (!spot) {
                return {
                    response: '⚠️ Нет свободного места для поворота на 90°',
                    style: 'output-error',
                    houseMutation: { action: 'rotate_blocked', houseId: ctx.house.id, roomId: ctx.room.id, itemId: item.id, reason: 'no_space' }
                };
            }

            item.rot = nextDims.rot;
            item.w = nextDims.w;
            item.h = nextDims.h;
            item.col = spot.col;
            item.row = spot.row;

            await engine.persistRoomLayout(ctx.user, ctx.house, ctx.room, { asyncCloud: Boolean(options.fromHouseUI) });
            const itemName = engine.getItemLabel(item);
            return {
                response: `↻ Предмет "${itemName}" повёрнут на ${deltaDeg > 0 ? '+90°' : '-90°'} (угол: ${item.rot}°, позиция: ${item.col},${item.row}) в "${ctx.house.name}".`,
                style: 'output-success',
                houseMutation: { action: 'rotate', houseId: ctx.house.id, roomId: ctx.room.id, itemId: item.id, deltaDeg, rot: item.rot, col: item.col, row: item.row }
            };
        }
    });

    // 8. Скрытие предмета в комнате дома
    CommandRegistry.register({
        names: ['hide thing', 'hide item', 'hide furniture', 'hide', 'скрыть предмет', 'скрыть вещь', 'скрыть', 'убрать предмет', 'сховати предмет', 'сховати'],
        description: 'Скрыть предмет в комнате дома (строго поэтапно: hide thing ➔ предмет ➔ of house ➔ дом)',
        category: 'House',
        usage: 'hide thing -> fridge2 -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const baseLabel = 'hide thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                const { error } = await requireAuthedUserForHouses();
                if (error) return error;
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `hide thing` выполняется строго поэтапно!\n1️⃣ `hide thing`\n2️⃣ предмет\n3️⃣ `of house`\n4️⃣ дом',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🙈 hide thing (Этап 1/4): введите ID или название предмета и нажмите Enter или ✅.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/4: предмет...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return { response: '⚠️ Укажите предмет.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Предмет...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🙈 Предмет: "${payload}" ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            const itemRef = steps[1];
            const houseRef = payload;
            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            const engine = window.HouseLayoutEngine;
            const item = engine.resolveItemInRoom(ctx.room, itemRef);
            if (!item) {
                return { response: `❌ Предмет "${itemRef}" не найден в "${ctx.house.name}".`, style: 'output-error' };
            }

            item.hidden = true;
            await engine.persistRoomLayout(ctx.user, ctx.house, ctx.room, { asyncCloud: Boolean(options.fromHouseUI) });
            const itemName = engine.getItemLabel(item);
            return {
                response: `🙈 Предмет "${itemName}" скрыт в "${ctx.house.name}". Вернуть можно командой \`unhide thing\`.`,
                style: 'output-success',
                houseMutation: { action: 'hide', houseId: ctx.house.id, roomId: ctx.room.id, itemId: item.id, itemName }
            };
        }
    });

    // 9. Отмена скрытия предмета (показ обратно) в комнате дома
    CommandRegistry.register({
        names: ['unhide thing', 'unhide item', 'unhide', 'show thing', 'show item', 'restore thing', 'вернуть предмет', 'показать предмет', 'отменить скрытие', 'показати предмет'],
        description: 'Вернуть скрытый предмет в комнату дома (строго поэтапно: unhide thing ➔ предмет/all ➔ of house ➔ дом)',
        category: 'House',
        usage: 'unhide thing -> fridge2 -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const baseLabel = 'unhide thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                const { error } = await requireAuthedUserForHouses();
                if (error) return error;
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `unhide thing` выполняется строго поэтапно!\n1️⃣ `unhide thing`\n2️⃣ предмет (или `all`)\n3️⃣ `of house`\n4️⃣ дом',
                        style: 'output-error'
                    };
                }
                return {
                    response: '👁️ unhide thing (Этап 1/4): введите ID/название скрытого предмета (или `all` для всех) и нажмите Enter или ✅.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/4: предмет или all...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return { response: '⚠️ Укажите предмет или `all`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Предмет или all...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `👁️ Возврат: "${payload}" ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            const itemRef = steps[1];
            const houseRef = payload;
            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            const engine = window.HouseLayoutEngine;
            const lowerRef = String(itemRef || '').trim().toLowerCase();

            if (['all', 'все', 'всё', 'всі'].includes(lowerRef)) {
                let restoredCount = 0;
                const restoredIds = [];
                ctx.room.items.forEach(item => {
                    if (item.hidden) {
                        item.hidden = false;
                        const activeOthers = ctx.room.items.filter(x => !x.hidden && x.id !== item.id);
                        if (!engine.canPlaceItem(ctx.room, item.id, item.col, item.row, item.w, item.h, activeOthers) ||
                            (ctx.room.quadrants && engine.straddlesQuadrantWall(ctx.room, item.col, item.row, item.w, item.h))) {
                            const spot = engine.findFreePlacementInRoom(ctx.room, item, activeOthers);
                            if (spot) {
                                item.col = spot.col;
                                item.row = spot.row;
                            }
                        }
                        restoredCount++;
                        restoredIds.push(item.id);
                    }
                });
                if (restoredCount > 0) {
                    await engine.persistRoomLayout(ctx.user, ctx.house, ctx.room, { asyncCloud: Boolean(options.fromHouseUI) });
                }
                return {
                    response: restoredCount > 0
                        ? `👁️ Возвращено скрытых предметов: ${restoredCount} в "${ctx.house.name}".`
                        : `ℹ️ В "${ctx.house.name}" нет скрытых предметов.`,
                    style: restoredCount > 0 ? 'output-success' : 'output-info',
                    houseMutation: { action: 'unhide_all', houseId: ctx.house.id, roomId: ctx.room.id, restoredCount, restoredIds }
                };
            }

            const item = engine.resolveItemInRoom(ctx.room, itemRef);
            if (!item) {
                return { response: `❌ Предмет "${itemRef}" не найден в "${ctx.house.name}".`, style: 'output-error' };
            }

            item.hidden = false;
            const activeOthers = ctx.room.items.filter(x => !x.hidden && x.id !== item.id);
            if (!engine.canPlaceItem(ctx.room, item.id, item.col, item.row, item.w, item.h, activeOthers) ||
                (ctx.room.quadrants && engine.straddlesQuadrantWall(ctx.room, item.col, item.row, item.w, item.h))) {
                const spot = engine.findFreePlacementInRoom(ctx.room, item, activeOthers);
                if (spot) {
                    item.col = spot.col;
                    item.row = spot.row;
                }
            }

            await engine.persistRoomLayout(ctx.user, ctx.house, ctx.room, { asyncCloud: Boolean(options.fromHouseUI) });
            const itemName = engine.getItemLabel(item);
            return {
                response: `👁️ Возвращён предмет "${itemName}" (коорд. ${item.col},${item.row}) в "${ctx.house.name}".`,
                style: 'output-success',
                houseMutation: { action: 'unhide', houseId: ctx.house.id, roomId: ctx.room.id, itemId: item.id, col: item.col, row: item.row }
            };
        }
    });

    // 10. Перемещение предмета на новые координаты сетки
    CommandRegistry.register({
        names: ['move thing', 'move item', 'move furniture', 'переместить предмет', 'передвинуть предмет', 'перемістити предмет'],
        description: 'Переместить предмет в комнате на указанные координаты col,row (move thing ➔ предмет ➔ col,row ➔ of house ➔ дом)',
        category: 'House',
        usage: 'move thing -> fridge2 -> 2,1 -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const baseLabel = 'move thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                const { error } = await requireAuthedUserForHouses();
                if (error) return error;
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `move thing` выполняется строго поэтапно!\n1️⃣ `move thing`\n2️⃣ предмет\n3️⃣ `col,row` (напр: `2,1`)\n4️⃣ `of house`\n5️⃣ дом',
                        style: 'output-error'
                    };
                }
                return {
                    response: '↔️ move thing (Этап 1/5): введите ID или название предмета.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) return { response: '⚠️ Укажите предмет.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Предмет...' };
                return { response: `↔️ Предмет: "${payload}".\n➡️ Введите координаты \`col,row\` (напр: \`2,1\`).`, style: 'output-info', commandSteps: [...steps, payload], inputValue: '', inputPlaceholder: 'col,row...' };
            }
            if (steps.length === 2) {
                if (!parseMoveCoords(payload)) {
                    return { response: '⚠️ Введите координаты в формате `col,row` (напр: `2,1`).', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'col,row...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return { response: `↔️ Координаты: ${payload} ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`, style: 'output-info', commandSteps: [...steps, payload, 'of house'], inputValue: '', inputPlaceholder: 'Номер или название дома...' };
            }
            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return { response: `🏠 Введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`, style: 'output-info', commandSteps: [...steps, 'of house'], inputValue: '', inputPlaceholder: 'Дом...' };
            }

            const itemRef = steps[1];
            const coords = parseMoveCoords(steps[2]);
            const houseRef = payload;
            if (!coords) return { response: '❌ Некорректные координаты.', style: 'output-error' };

            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            const engine = window.HouseLayoutEngine;
            const item = engine.resolveItemInRoom(ctx.room, itemRef);
            if (!item) return { response: `❌ Предмет "${itemRef}" не найден в "${ctx.house.name}".`, style: 'output-error' };

            const moveCheck = engine.canMoveItemTo(ctx.room, item, item.col, item.row, coords.col, coords.row, ctx.room.items);
            if (!moveCheck.ok) {
                const msg = moveCheck.reason === 'door_size'
                    ? `🚪 Объект ${item.w}×${item.h} не проходит в двери (${engine.DOOR_WIDTH_TILES} пл.)`
                    : '❌ Нельзя разместить предмет на указанных координатах (занято или стена).';
                return {
                    response: msg,
                    style: 'output-error',
                    houseMutation: { action: 'move_blocked', reason: moveCheck.reason }
                };
            }

            item.col = coords.col;
            item.row = coords.row;
            await engine.persistRoomLayout(ctx.user, ctx.house, ctx.room, { asyncCloud: Boolean(options.fromHouseUI) });
            return {
                response: `↔️ Предмет "${engine.getItemLabel(item)}" перемещён на ${item.col},${item.row} в "${ctx.house.name}".`,
                style: 'output-success',
                houseMutation: { action: 'move', houseId: ctx.house.id, roomId: ctx.room.id, itemId: item.id, col: item.col, row: item.row }
            };
        }
    });

    // 11. Смена двух комнат местами с переносом всей мебели (привилегия админов, пока дом не готов)
    CommandRegistry.register({
        names: [
            'swap rooms', 'shift rooms', 'switch rooms', 'move rooms',
            'поменять комнаты', 'поменять комнаты местами', 'сменить комнаты',
            'переместить комнаты', 'обменять комнаты', 'змінити кімнати'
        ],
        description: 'Поменять две комнаты дома местами с сохранением порядка всей мебели (только админ, пока дом не готов)',
        category: 'House',
        usage: 'swap rooms -> kitchen -> hall -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAdminForHouses();
            if (error) return error;

            const baseLabel = 'swap rooms';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `swap rooms` выполняется поэтапно:\n1️⃣ `swap rooms`\n2️⃣ первая комната (напр: `kitchen` или `kitchen, hall`)\n3️⃣ вторая комната (если не ввели через запятую)\n4️⃣ `of house`\n5️⃣ номер или название дома (напр: `2` или `skip` если дом один).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🔁 swap rooms (Этап 1): введите название/номер первой комнаты (напр: `kitchen`, `hall`, `room`, `corridor`) или сразу две через запятую (`kitchen, hall`).',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Первая комната (или: kitchen, hall)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            // Этап 2: первая комната (или обе через запятую)
            if (steps.length === 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Укажите название или номер комнаты (напр: `kitchen` или `kitchen, hall`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Первая комната (или: kitchen, hall)...'
                    };
                }
                if (payload.includes(',')) {
                    const parts = payload.split(',').map(s => s.trim()).filter(Boolean);
                    if (parts.length !== 2) {
                        return {
                            response: '⚠️ Укажите ровно 2 комнаты через запятую (например: `kitchen, hall`).',
                            style: 'output-error',
                            commandSteps: steps,
                            inputValue: '',
                            inputPlaceholder: 'Например: kitchen, hall...'
                        };
                    }
                    if (parts[0].toLowerCase() === parts[1].toLowerCase()) {
                        return {
                            response: '⚠️ Укажите две разные комнаты.',
                            style: 'output-error',
                            commandSteps: steps,
                            inputValue: '',
                            inputPlaceholder: 'Например: kitchen, hall...'
                        };
                    }
                    const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                    const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                    return {
                        response: `🔁 Меняем местами: "${parts[0]}" ↔ "${parts[1]}" ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                        style: 'output-info',
                        commandSteps: [steps[0] || baseLabel, parts[0], parts[1], 'of house'],
                        inputValue: '',
                        inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Номер или название дома...'
                    };
                }
                return {
                    response: `🔁 Первая комната: "${payload}".\n➡️ Введите название/номер второй комнаты.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Вторая комната (напр: hall)...'
                };
            }

            // Этап 3: вторая комната -> парсер сам подставляет `of house`
            if (steps.length === 2) {
                if (!payload) {
                    return {
                        response: '⚠️ Укажите вторую комнату.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Вторая комната (напр: hall)...'
                    };
                }
                if (payload.toLowerCase() === String(steps[1] || '').trim().toLowerCase()) {
                    return {
                        response: '⚠️ Укажите комнату, отличную от первой.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Вторая комната...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🔁 Меняем местами: "${steps[1]}" ↔ "${payload}" ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Номер или название дома...'
                };
            }

            // Legacy-совместимость для `of house`
            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме', 'для дома'])) {
                    return {
                        response: '⚠️ Введите `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите of house...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Финальный шаг: введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Номер или название дома...'
                };
            }

            // Финал (steps.length >= 4): выполнение смены комнат
            const roomARef = steps[1];
            const roomBRef = steps[2];
            let houseRef = payload;

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }

            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(houseRef, ['skip', 'пропустить']) && boundList.length === 1) {
                houseRef = boundList[0].id;
            }
            if (!houseRef) {
                return {
                    response: `⚠️ Укажите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Номер или название дома...'
                };
            }

            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            if (ctx.house && (ctx.house.isReady || ctx.house.ready || ctx.house.locked)) {
                return {
                    response: `🔒 Дом "${ctx.house.name}" уже готов (позиционирование завершено) — менять комнаты местами больше нельзя.`,
                    style: 'output-error'
                };
            }

            try {
                const res = await window.UserHousesSync.swapRooms(user, ctx.house.id, roomARef, roomBRef, ctx.room);
                const syncText = res.synced
                    ? '💾 Синхронизировано с БД.'
                    : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `✅ Комнаты "${res.roomAName}" и "${res.roomBName}" поменялись местами в "${res.house.name}" (перенесено предметов: ${res.movedCount}, порядок мебели внутри сохранён).\n${syncText}`,
                    style: 'output-success',
                    houseMutation: {
                        action: 'swap_rooms',
                        houseId: res.house.id,
                        roomA: res.roomAName,
                        roomB: res.roomBName,
                        movedCount: res.movedCount
                    }
                };
            } catch (err) {
                return {
                    response: '❌ ' + (err && err.message ? err.message : String(err)),
                    style: 'output-error'
                };
            }
        }
    });

    // 12. Поворот всей мебели в комнате на +90° или -90° как единого целого (пол и название не меняются)
    CommandRegistry.register({
        names: ['rotate room', 'turn room', 'повернуть комнату', 'развернуть комнату', 'повернути кімнату'],
        description: 'Повернуть всю мебель в комнате на +90° или -90° как единое целое (пол и название не меняются, поэтапно: rotate room ➔ комната ➔ +90/-90 ➔ of house ➔ дом)',
        category: 'House',
        usage: 'rotate room -> kitchen -> +90 -> of house -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'rotate room';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            // Этап 1: rotate room
            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `rotate room` выполняется строго поэтапно (без параметров в одной строке)!\n1️⃣ `rotate room`\n2️⃣ комната (напр: `kitchen`, `hall`, `room`, `corridor` или `1..4`)\n3️⃣ `+90` или `-90`\n4️⃣ `of house`\n5️⃣ номер или название дома (или `skip` если дом один).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '↻ rotate room (Этап 1/5): введите название или номер комнаты (напр: `kitchen`, `hall`, `room`, `corridor` или `1`).',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: комната (напр: kitchen)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            // Этап 2: комната
            if (steps.length === 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Укажите название или номер комнаты (напр: `kitchen` или `1`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 2/5: комната (напр: kitchen)...'
                    };
                }
                return {
                    response: `↻ Комната: "${payload}".\n➡️ Этап 3/5: введите \`+90\` (по часовой) или \`-90\` (против часовой).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/5: +90 или -90...'
                };
            }

            // Этап 3: направление поворота (+90 / -90) -> парсер сам подставляет `of house`
            if (steps.length === 2) {
                const parsedDelta = parseRotationDelta(payload);
                if (parsedDelta === null) {
                    return {
                        response: '⚠️ Укажите направление поворота: `+90` (или `cw`) либо `-90` (или `ccw`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: '+90 или -90...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `↻ Поворот комнаты на ${parsedDelta > 0 ? '+90° (по часовой)' : '-90° (против часовой)'} ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Номер или название дома...'
                };
            }

            // Legacy-совместимость для `of house`
            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме', 'для дома'])) {
                    return {
                        response: '⚠️ Введите `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите of house...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Номер или название дома...'
                };
            }

            // Этап 5: выполнение поворота комнаты
            const roomRef = steps[1];
            const deltaDeg = parseRotationDelta(steps[2]);
            let houseRef = payload;

            if (deltaDeg === null) {
                return { response: '❌ Некорректный угол поворота комнаты.', style: 'output-error' };
            }

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }

            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(houseRef, ['skip', 'пропустить']) && boundList.length === 1) {
                houseRef = boundList[0].id;
            }
            if (!houseRef) {
                return {
                    response: `⚠️ Укажите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Этап 5/5: номер или название дома...'
                };
            }

            const ctx = await resolveHouseContext(options, houseRef);
            if (ctx.error) return ctx.error;

            try {
                const res = await window.UserHousesSync.rotateRoom(user, ctx.house.id, roomRef, deltaDeg, ctx.room);
                if (!res.rotatedCount) {
                    return {
                        response: `ℹ️ В комнате "${res.roomName}" дома "${res.house.name}" нет мебели для поворота (пол и название комнаты сохранены).`,
                        style: 'output-info'
                    };
                }
                const syncText = res.synced
                    ? '💾 Синхронизировано с БД.'
                    : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `↻ Мебель комнаты "${res.roomName}" в "${res.house.name}" повёрнута на ${res.deltaDeg > 0 ? '+90° (по часовой)' : '-90° (против часовой)'} (предметов: ${res.rotatedCount}; пол и название комнаты не изменены).\n${syncText}`,
                    style: 'output-success',
                    houseMutation: {
                        action: 'rotate_room',
                        houseId: res.house.id,
                        roomName: res.roomName,
                        deltaDeg: res.deltaDeg,
                        rotatedCount: res.rotatedCount
                    }
                };
            } catch (err) {
                return {
                    response: '❌ ' + (err && err.message ? err.message : String(err)),
                    style: 'output-error'
                };
            }
        }
    });

    // 13. Отметка дома как готового (после чего менять комнаты местами больше нельзя)
    CommandRegistry.register({
        names: ['finish house', 'ready house', 'house ready', 'lock house', 'завершить дом', 'дом готов', 'готовый дом'],
        description: 'Отметить дом как готовый и зафиксировать расположение комнат (только админ, поэтапно: finish house ➔ дом)',
        category: 'House',
        usage: 'finish house -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAdminForHouses();
            if (error) return error;

            const baseLabel = 'finish house';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `finish house` выполняется в 2 этапа:\n1️⃣ `finish house`\n2️⃣ номер или название дома (напр: `2`).',
                        style: 'output-error'
                    };
                }
                return {
                    response: `🔒 finish house (Этап 1/2): введите номер или название дома, чтобы зафиксировать расположение комнат (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/2: номер или название дома (напр: 2)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            let payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }
            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(payload, ['skip', 'пропустить']) && boundList.length === 1) {
                payload = boundList[0].id;
            }
            if (!payload) {
                return {
                    response: `⚠️ Укажите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/2: номер или название дома...'
                };
            }

            try {
                const res = await window.UserHousesSync.markHouseReady(user, payload);
                if (res.alreadyReady) {
                    return {
                        response: `ℹ️ Дом "${res.house.name}" уже отмечен как готовый.`,
                        style: 'output-info'
                    };
                }
                const syncText = res.synced
                    ? '💾 Синхронизировано с БД.'
                    : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `🔒 Дом "${res.house.name}" отмечен как готовый! Смена комнат местами для него теперь заблокирована.\n${syncText}`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: '❌ ' + (err && err.message ? err.message : String(err)),
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/2: номер или название дома...'
                };
            }
        }
    });

    // 14. Изменение цвета предмета в доме (после создания)
    CommandRegistry.register({
        names: ['color thing', 'color item', 'paint thing', 'paint item', 'цвет предмета', 'цвет', 'покрасить предмет', 'покрасить', 'колір предмета'],
        description: 'Изменить цвет предмета в доме (поэтапно: color thing ➔ предмет ➔ цвет ➔ of house ➔ дом)',
        category: 'House',
        usage: 'color thing -> hall_table -> brown -> of house -> 1',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'color thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `color thing` выполняется строго поэтапно!\n1️⃣ `color thing`\n2️⃣ ID или название предмета\n3️⃣ цвет (`brown`, `green`, `blue`, `red`, `yellow`, `white`, `gray`, `black`, `orange`, `purple` или `#hex`)\n4️⃣ `of house`\n5️⃣ дом (`1`, `2`, `3` или `skip`)',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🎨 color thing (Этап 1/5): введите ID или название предмета (напр: `hall_table`, `table_brown`, `table`).',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет (напр: hall_table)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return { response: '⚠️ Укажите ID или название предмета.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/5: предмет...' };
                }
                return {
                    response: `🎨 Предмет: "${payload}".\n➡️ Этап 3/5: введите цвет (\`brown\`, \`green\`, \`blue\`, \`red\`, \`yellow\`, \`white\`, \`gray\`, \`black\`, \`orange\`, \`purple\` или \`#hex\`).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/5: цвет (напр: brown или green)...'
                };
            }

            if (steps.length === 2) {
                const parsedColor = window.UserHousesSync && window.UserHousesSync.parseThingColorInput
                    ? window.UserHousesSync.parseThingColorInput(payload)
                    : null;
                if (!parsedColor) {
                    return {
                        response: '⚠️ Укажите цвет: `brown`, `green`, `blue`, `red`, `yellow`, `white`, `gray`, `black`, `orange`, `purple` или `#RRGGBB`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Цвет (напр: brown)...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🎨 Цвет: \`${parsedColor}\` ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме', 'для дома'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            const itemRef = steps[1];
            const colorInput = steps[2];
            let houseRef = payload;

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }
            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(houseRef, ['skip', 'пропустить']) && boundList.length === 1) {
                houseRef = boundList[0].id;
            }
            if (!houseRef) {
                return { response: `⚠️ Укажите дом (доступны: ${formatHousesSummary(user)}).`, style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 5/5: дом...' };
            }

            try {
                const res = await window.UserHousesSync.setThingColor(user, houseRef, itemRef, colorInput);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально.';
                return {
                    response: `🎨 Цвет предмета "${res.itemName}" в "${res.house.name}" изменён на \`${res.color}\`.\n${syncText}`,
                    style: 'output-success',
                    houseMutation: { action: 'color_thing', houseId: res.house.id, itemId: res.item.id, color: res.color }
                };
            } catch (err) {
                return { response: '❌ ' + (err && err.message ? err.message : String(err)), style: 'output-error' };
            }
        }
    });

    // 15. Изменение формы и/или размера предмета в доме (после создания)
    CommandRegistry.register({
        names: ['shape thing', 'shape item', 'resize thing', 'resize item', 'size thing', 'форма предмета', 'форма'],
        description: 'Изменить форму и размер предмета (поэтапно: shape thing ➔ предмет ➔ 2x1 / 1x2 / 2x2 / rect / corner / round ➔ of house ➔ дом)',
        category: 'House',
        usage: 'shape thing -> hall_table -> 2x1 -> of house -> 1',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'shape thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `shape thing` выполняется строго поэтапно!\n1️⃣ `shape thing`\n2️⃣ ID или название предмета\n3️⃣ форма/размер (`2x1`, `1x2`, `2x2`, `1x1`, `rect`, `corner`, `round` или `round 2x2`)\n4️⃣ `of house`\n5️⃣ дом (`1`, `2`, `3` или `skip`)',
                        style: 'output-error'
                    };
                }
                return {
                    response: '📐 shape thing (Этап 1/5): введите ID или название предмета (напр: `hall_table`, `table_brown`, `table`).',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return { response: '⚠️ Укажите ID или название предмета.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/5: предмет...' };
                }
                return {
                    response: `📐 Предмет: "${payload}".\n➡️ Этап 3/5: введите форму или размер (\`2x1\`, \`1x2\`, \`2x2\`, \`1x1\`, \`rect\`, \`corner\`, \`round\` или \`round 2x2\`).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/5: 2x1 / round / corner...'
                };
            }

            if (steps.length === 2) {
                const parsedShape = window.UserHousesSync && window.UserHousesSync.parseThingShapeInput
                    ? window.UserHousesSync.parseThingShapeInput(payload)
                    : null;
                if (!parsedShape) {
                    return {
                        response: '⚠️ Укажите форму или размер (напр: `2x1`, `1x2`, `2x2`, `1x1`, `rect`, `corner`, `round`, `round 2x2`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: '2x1 / round / corner...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `📐 Форма/размер: \`${payload}\` ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме', 'для дома'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            const itemRef = steps[1];
            const shapeInput = steps[2];
            let houseRef = payload;

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }
            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(houseRef, ['skip', 'пропустить']) && boundList.length === 1) {
                houseRef = boundList[0].id;
            }
            if (!houseRef) {
                return { response: `⚠️ Укажите дом (доступны: ${formatHousesSummary(user)}).`, style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 5/5: дом...' };
            }

            try {
                const res = await window.UserHousesSync.setThingShape(user, houseRef, itemRef, shapeInput);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально.';
                return {
                    response: `📐 Предмет "${res.itemName}" в "${res.house.name}" обновлён: форма \`${res.shape}\`, размер ${res.w}×${res.h} (поз. ${res.item.col},${res.item.row}).\n${syncText}`,
                    style: 'output-success',
                    houseMutation: { action: 'shape_thing', houseId: res.house.id, itemId: res.item.id, shape: res.shape, w: res.w, h: res.h }
                };
            } catch (err) {
                return { response: '❌ ' + (err && err.message ? err.message : String(err)), style: 'output-error' };
            }
        }
    });

    // 16. Привязка или смена Queue ID предмета (после создания)
    CommandRegistry.register({
        names: ['queue thing', 'queue item', 'set queue', 'link queue', 'очередь предмета', 'привязать очередь', 'очередь'],
        description: 'Привязать или изменить Queue ID для предмета в доме (поэтапно: queue thing ➔ предмет ➔ номер/0 ➔ of house ➔ дом)',
        category: 'House',
        usage: 'queue thing -> hall_table -> 2 -> of house -> 1',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'queue thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `queue thing` выполняется строго поэтапно!\n1️⃣ `queue thing`\n2️⃣ ID или название предмета\n3️⃣ номер очереди (`1`, `2`, `6`... или `0` чтобы отвязать)\n4️⃣ `of house`\n5️⃣ дом (`1`, `2`, `3` или `skip`)',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🔢 queue thing (Этап 1/5): введите ID или название предмета.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                if (!payload) {
                    return { response: '⚠️ Укажите ID или название предмета.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/5: предмет...' };
                }
                return {
                    response: `🔢 Предмет: "${payload}".\n➡️ Этап 3/5: введите номер очереди (напр: \`2\`, или \`0\` / \`-\` чтобы отвязать).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/5: номер очереди (напр: 2 или 0)...'
                };
            }

            if (steps.length === 2) {
                const lowerQ = payload.toLowerCase();
                if (lowerQ !== '0' && lowerQ !== '-' && lowerQ !== 'none' && lowerQ !== 'нет' && lowerQ !== 'без' && !/^\d+$/.test(payload)) {
                    return {
                        response: '⚠️ Введите числовой номер очереди (напр: `2`) или `0` / `-` чтобы отвязать.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Номер очереди...'
                    };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🔢 Queue: \`${payload}\` ➔ парсер добавил \`of house\`.\n🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, payload, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме', 'для дома'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Введите номер или название дома${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом...'
                };
            }

            const itemRef = steps[1];
            const queueInput = steps[2];
            let houseRef = payload;

            if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                await window.UserHousesSync.syncFromDb(user).catch(() => {});
            }
            const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
            if (isKeywordStep(houseRef, ['skip', 'пропустить']) && boundList.length === 1) {
                houseRef = boundList[0].id;
            }
            if (!houseRef) {
                return { response: `⚠️ Укажите дом (доступны: ${formatHousesSummary(user)}).`, style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 5/5: дом...' };
            }

            try {
                const res = await window.UserHousesSync.setThingQueue(user, houseRef, itemRef, queueInput);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально.';
                const qText = res.queueId > 0 ? `привязан к Queue #${res.queueId}` : 'отвязан от очереди (Queue #0)';
                return {
                    response: `🔢 Предмет "${res.itemName}" в "${res.house.name}" ${qText}.\n${syncText}`,
                    style: 'output-success',
                    houseMutation: { action: 'queue_thing', houseId: res.house.id, itemId: res.item.id, queueId: res.queueId }
                };
            } catch (err) {
                return { response: '❌ ' + (err && err.message ? err.message : String(err)), style: 'output-error' };
            }
        }
    });

    // 17. Быстрое изменение размера любой вещи (одной строкой или поэтапно):
    // make size of Кровать 2 in the room Спальня of house Дом 2 equal 1x2
    CommandRegistry.register({
        names: ['make size of', 'make size', 'set size of', 'set size', 'размер предмета', 'задать размер', 'розмір предмета'],
        description: 'Изменить размер X×Y любого предмета в комнате (X — горизонталь, Y — вертикаль): make size of <предмет> in the room <комната> of house <дом> equal <X>x<Y>',
        category: 'House',
        usage: 'make size of Кровать 2 in the room Спальня of house Дом 2 equal 1x2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'make size of';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            const executeResize = async ({ itemRef, roomRef, houseRef, sizeRaw }) => {
                const parsedShape = window.UserHousesSync && window.UserHousesSync.parseThingShapeInput
                    ? window.UserHousesSync.parseThingShapeInput(sizeRaw)
                    : null;
                if (!parsedShape || parsedShape.w === null || parsedShape.h === null) {
                    return {
                        response: `⚠️ Укажите размер в формате \`XxY\` или \`X*Y\` (от 1 до 8, например: \`1x2\`, \`2x1\`, \`2x2\`, \`1*2\`). Получено: "${sizeRaw}".`,
                        style: 'output-error'
                    };
                }

                if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                    await window.UserHousesSync.syncFromDb(user).catch(() => {});
                }

                let resolvedHouseRef = String(houseRef || '').trim();
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const runtimeHouse = options && options.houseRuntime && options.houseRuntime.house;
                const runtimeRoom = options && options.houseRuntime && options.houseRuntime.room;

                if ((!resolvedHouseRef || isKeywordStep(resolvedHouseRef, ['skip', 'пропустить']))) {
                    if (runtimeHouse && runtimeHouse.id) {
                        resolvedHouseRef = runtimeHouse.id;
                    } else if (boundList.length === 1) {
                        resolvedHouseRef = boundList[0].id;
                    }
                }
                if (!resolvedHouseRef) {
                    return {
                        response: `⚠️ Укажите дом (\`of house <номер или название>\`). Доступны: ${formatHousesSummary(user)}.`,
                        style: 'output-error'
                    };
                }

                const cleanRoomRef = (roomRef && !isKeywordStep(roomRef, ['skip', 'пропустить', 'any', 'all'])) ? roomRef : '';

                try {
                    const liveRoom = (runtimeHouse && runtimeRoom && (
                        String(runtimeHouse.id).toLowerCase() === resolvedHouseRef.toLowerCase() ||
                        String(runtimeHouse.name || '').toLowerCase() === resolvedHouseRef.toLowerCase() ||
                        String(runtimeHouse.number || '') === resolvedHouseRef
                    )) ? runtimeRoom : null;

                    const res = await window.UserHousesSync.setThingShape(
                        user,
                        resolvedHouseRef,
                        itemRef,
                        sizeRaw,
                        liveRoom,
                        { roomRef: cleanRoomRef || null, resetRot: true }
                    );
                    const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально.';
                    const roomText = res.targetRoom ? ` в комнате "${res.targetRoom.name}"` : '';
                    return {
                        response: `📐 Размер предмета "${res.itemName}"${roomText} в "${res.house.name}" установлен: **${res.w}×${res.h}** (X=${res.w} по горизонтали, Y=${res.h} по вертикали; поз. ${res.item.col},${res.item.row}).\n${syncText}`,
                        style: 'output-success',
                        houseMutation: { action: 'shape_thing', houseId: res.house.id, itemId: res.item.id, shape: res.shape, w: res.w, h: res.h, rot: res.rot }
                    };
                } catch (err) {
                    return { response: '❌ ' + (err && err.message ? err.message : String(err)), style: 'output-error' };
                }
            };

            // 1) Однострочный режим (как попросил пользователь): make size of Кровать 2 in the room Спальня of house Дом 2 equal 1x2
            if ((!options || !options.fromTwoStepBar) && rawArgs) {
                const parsed = window.UserHousesSync && typeof window.UserHousesSync.parseMakeSizeArgs === 'function'
                    ? window.UserHousesSync.parseMakeSizeArgs(rawArgs)
                    : null;
                if (!parsed || !parsed.itemRef || !parsed.sizeRaw) {
                    return {
                        response: '⚠️ Формат команды:\n`make size of <предмет> in the room <комната> of house <дом> equal <X>x<Y>`\nПример: `make size of Кровать 2 in the room Спальня of house Дом 2 equal 1x2` (или `1*2`).\n📏 Стандарт осей: **X** — ширина по горизонтали (слева-направо), **Y** — высота по вертикали (сверху-вниз).',
                        style: 'output-error'
                    };
                }
                return await executeResize(parsed);
            }

            // 2) Если ввели без параметров — предлагаем поэтапный ввод (или подсказываем однострочный шаблон)
            if (!options || !options.fromTwoStepBar) {
                return {
                    response: '📐 make size of (Этап 1/5): введите предмет (напр: `Кровать 2`, `bed2`, `table_brown`).\n💡 Или сразу одной строкой: `make size of Кровать 2 in the room Спальня of house Дом 2 equal 1x2`\n📏 Стандарт: **X** — горизонталь (слева-направо), **Y** — вертикаль (сверху-вниз).',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2/5: предмет (напр: Кровать 2)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                const cleanItem = (typeof window.stripLeadingValidArticle === 'function')
                    ? window.stripLeadingValidArticle(payload)
                    : payload;
                if (!cleanItem) {
                    return { response: '⚠️ Укажите название или ID предмета.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Предмет...' };
                }
                return {
                    response: `🪑 Предмет: "${cleanItem}" ➔ парсер добавил \`in room\`.\n🚪 Введите комнату (напр: \`Спальня\`, \`Кухня\`, \`hall\`) или \`skip\`.`,
                    style: 'output-info',
                    commandSteps: [...steps, cleanItem, 'in room'],
                    inputValue: '',
                    inputPlaceholder: 'Комната (или skip)...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['in room', 'in the room', 'of room', 'в комнате'])) {
                    return { response: '⚠️ Введите `in room`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите in room...' };
                }
                return {
                    response: '🚪 Введите комнату (напр: `Спальня`, `Кухня`, `hall`) или `skip`.',
                    style: 'output-info',
                    commandSteps: [...steps, 'in room'],
                    inputValue: '',
                    inputPlaceholder: 'Комната (или skip)...'
                };
            }

            if (steps.length === 3) {
                const cleanRoom = (typeof window.stripLeadingValidArticle === 'function')
                    ? window.stripLeadingValidArticle(payload)
                    : payload;
                const roomVal = isKeywordStep(cleanRoom, ['skip', 'пропустить']) ? 'skip' : cleanRoom;
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🚪 Комната: \`${roomVal}\` ➔ парсер добавил \`of house\`.\n🏠 Введите дом${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, roomVal, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом (напр: Дом 2)...'
                };
            }

            if (steps.length === 4) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'дома', 'в доме'])) {
                    return { response: '⚠️ Введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите of house...' };
                }
                const boundList = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
                const skipHint = boundList.length === 1 ? ' (или `skip` для единственного дома)' : '';
                return {
                    response: `🏠 Введите дом${skipHint} (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: boundList.length === 1 ? 'Дом (или skip)...' : 'Дом (напр: Дом 2)...'
                };
            }

            if (steps.length === 5) {
                const cleanHouse = (typeof window.stripLeadingValidArticle === 'function')
                    ? window.stripLeadingValidArticle(payload)
                    : payload;
                if (!cleanHouse) {
                    return { response: `⚠️ Укажите дом (${formatHousesSummary(user)}).`, style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Дом...' };
                }
                return {
                    response: `🏠 Дом: \`${cleanHouse}\` ➔ парсер добавил \`equal\`.\n📐 Введите размер \`XxY\` (или \`X*Y\`), напр: \`1x2\`, \`2x1\`, \`2x2\` (X — горизонталь, Y — вертикаль).`,
                    style: 'output-info',
                    commandSteps: [...steps, cleanHouse, 'equal'],
                    inputValue: '',
                    inputPlaceholder: 'Размер (напр: 1x2)...'
                };
            }

            if (steps.length === 6) {
                if (!isKeywordStep(payload, ['equal', 'equals', 'equal to', 'to', '=', 'равно'])) {
                    return { response: '⚠️ Введите `equal`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Введите equal...' };
                }
                return {
                    response: '📐 Введите размер `XxY` (или `X*Y`), напр: `1x2`, `2x1`, `2x2`.',
                    style: 'output-info',
                    commandSteps: [...steps, 'equal'],
                    inputValue: '',
                    inputPlaceholder: 'Размер (напр: 1x2)...'
                };
            }

            return await executeResize({
                itemRef: steps[1],
                roomRef: steps[3],
                houseRef: steps[5],
                sizeRaw: payload
            });
        }
    });

    // 18. Переименование дома: Rename Дом 1 to Чапаева (или поэтапно, с фоллбэком на папки LocalFS)
    CommandRegistry.register({
        names: [
            'rename house',
            'rename home',
            'rename',
            'переименовать дом',
            'переименуй дом',
            'перейменувати будинок',
            'перейменувати дім'
        ],
        description: 'Переименовать дом: Rename Дом 1 to Чапаева (поддерживает 1 строку и пошаговый ввод)',
        category: 'House',
        usage: 'Rename Дом 1 to Чапаева',
        handler: async (parameters, options = {}) => {
            const matchedCmd = String((parameters && parameters.matchedCmd) || 'rename').trim().toLowerCase();
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            const executeHouseRename = async (oldRefInput, newNameInput) => {
                const { user, error } = await requireAuthedUserForHouses();
                if (error) return error;

                if (window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
                    await window.UserHousesSync.syncFromDb(user).catch(() => {});
                }

                const cleanOldRef = (typeof window.stripLeadingValidArticle === 'function')
                    ? window.stripLeadingValidArticle(String(oldRefInput || '').trim(), { allowTheBeforeAny: true })
                    : String(oldRefInput || '').trim();
                const cleanNewName = String(newNameInput || '').trim().replace(/^["']|["']$/g, '');

                // Если ввели просто `rename <oldFolder> <newFolder>` и это не дом — проверяем LocalFS папку
                const foundHouse = window.UserHousesSync ? window.UserHousesSync.findHouse(user, cleanOldRef) : null;
                if (!foundHouse && matchedCmd === 'rename' && window.LocalFS && typeof window.LocalFS.rename === 'function') {
                    try {
                        const fsRes = await window.LocalFS.rename(cleanOldRef, cleanNewName);
                        return {
                            response: `✏️ Папка '${fsRes.oldName}' переименована в '${fsRes.newName}'`,
                            style: 'output-success',
                            undoAction: {
                                type: 'local_fs_rename',
                                oldName: fsRes.oldName,
                                newName: fsRes.newName,
                                description: `переименование папки ${fsRes.oldName} → ${fsRes.newName}`
                            }
                        };
                    } catch (fsErr) {}
                }

                try {
                    const res = await window.UserHousesSync.renameHouse(user, cleanOldRef, cleanNewName);
                    const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально.';
                    return {
                        response: `🏠 Дом "${res.oldName}" переименован в "${res.newName}"!\n${syncText}\n💡 Теперь можно открывать: \`go to ${res.newName}\` или просто \`${res.newName}\`.`,
                        style: 'output-success',
                        houseMutation: {
                            action: 'rename_house',
                            houseId: res.house.id,
                            oldName: res.oldName,
                            newName: res.newName
                        }
                    };
                } catch (err) {
                    return {
                        response: '❌ ' + (err && err.message ? err.message : String(err)) + `\nДоступны: ${formatHousesSummary(user)}`,
                        style: 'output-error'
                    };
                }
            };

            // Однострочный режим: Rename Дом 1 to Чапаева
            if ((!options || !options.fromTwoStepBar) && rawArgs) {
                const sepMatch = rawArgs.match(/^(.*?)\s+(?:to|->|→|=>|в|на)\s+(.+)$/i);
                if (sepMatch) {
                    const oldRef = sepMatch[1].trim();
                    const newName = sepMatch[2].trim();
                    if (oldRef && newName) {
                        return await executeHouseRename(oldRef, newName);
                    }
                }
                // Если bare `rename oldFolder newFolder` (без `to`) — пробуем папку LocalFS
                if (matchedCmd === 'rename' && parameters.args && parameters.args.length === 2 && window.LocalFS && typeof window.LocalFS.rename === 'function') {
                    try {
                        const fsRes = await window.LocalFS.rename(parameters.args[0], parameters.args[1]);
                        return {
                            response: `✏️ Папка '${fsRes.oldName}' переименована в '${fsRes.newName}'`,
                            style: 'output-success',
                            undoAction: {
                                type: 'local_fs_rename',
                                oldName: fsRes.oldName,
                                newName: fsRes.newName,
                                description: `переименование папки ${fsRes.oldName} → ${fsRes.newName}`
                            }
                        };
                    } catch (e) {}
                }
                return {
                    response: '⚠️ Укажите формат: `Rename <текущий дом> to <новое название>`\nПример: `Rename Дом 1 to Чапаева`, `Rename Дом 2 to Строителей`, `Rename Дом 3 to Аврора`.',
                    style: 'output-error'
                };
            }

            // Поэтапный режим: rename house -> <дом> -> (авто: to) -> <новое имя>
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = matchedCmd.includes('house') || matchedCmd.includes('home') ? matchedCmd : 'rename house';
            if (!options || !options.fromTwoStepBar) {
                return {
                    response: `🏠 Rename (Шаг 1/2): введите номер или название дома для переименования (доступны: ${formatHousesSummary(user)}).\n💡 Или одной строкой: \`Rename Дом 1 to Чапаева\`.`,
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Какой дом переименовать (напр: Дом 1)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            if (steps.length === 1) {
                const cleanOld = (typeof window.stripLeadingValidArticle === 'function')
                    ? window.stripLeadingValidArticle(payload, { allowTheBeforeAny: true })
                    : payload;
                if (!cleanOld) {
                    return {
                        response: `⚠️ Укажите дом (${formatHousesSummary(user)}).`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Какой дом переименовать...'
                    };
                }
                return {
                    response: `🏠 Выбран дом: "${cleanOld}" ➔ парсер добавил \`to\`.\n✏️ Шаг 2/2: введите новое название дома (напр: \`Чапаева\`, \`Строителей\`, \`Аврора\`).`,
                    style: 'output-info',
                    commandSteps: [...steps, cleanOld, 'to'],
                    inputValue: '',
                    inputPlaceholder: 'Новое название (напр: Чапаева)...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['to', 'в', 'на', '->'])) {
                    return {
                        response: '⚠️ Введите `to` (или сразу новое название).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Введите to...'
                    };
                }
                return {
                    response: '✏️ Введите новое название дома (напр: `Чапаева`).',
                    style: 'output-info',
                    commandSteps: [...steps, 'to'],
                    inputValue: '',
                    inputPlaceholder: 'Новое название (напр: Чапаева)...'
                };
            }

            return await executeHouseRename(steps[1], payload);
        }
    });
})();
