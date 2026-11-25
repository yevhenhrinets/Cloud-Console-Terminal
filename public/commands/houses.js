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

            // Этап 2 -> получили название комнаты
            if (steps.length === 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Введите название комнаты (например: `kitchen`).',
                        style: 'output-error',
                        commandSteps: [steps[0] || baseLabel],
                        inputValue: '',
                        inputPlaceholder: 'Этап 2/4: название комнаты (напр: kitchen)...'
                    };
                }
                return {
                    response: `🚪 Комната: "${payload}" (Этап 2/4 выполнен).\n➡️ Этап 3/4: введите \`to house\` и нажмите Enter или ✅.`,
                    style: 'output-info',
                    commandSteps: [steps[0] || baseLabel, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/4: введите to house...'
                };
            }

            // Этап 3 -> ждём ключевую фразу `to house`
            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['to house', 'to home', 'в дом', 'до дому', 'до будинку'])) {
                    return {
                        response: `⚠️ На этапе 3/4 необходимо ввести \`to house\` (чтобы выбрать дом для комнаты "${steps[1]}").`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 3/4: введите to house...'
                    };
                }
                return {
                    response: `🏠 Этап 4/4: введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [steps[0], steps[1], 'to house'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/4: номер или название дома (напр: 2)...'
                };
            }

            // Этап 4 -> создаём комнату в выбранном доме
            const roomName = String(steps[1] || '').trim();
            if (!payload) {
                return {
                    response: `⚠️ Укажите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/4: номер или название дома...'
                };
            }

            try {
                const res = await window.UserHousesSync.addRoom(user, roomName, payload);
                const syncText = res.synced ? '💾 Синхронизировано с БД.' : '💾 Сохранено локально (отправится в БД при подключении).';
                return {
                    response: `✅ Комната "${res.room.name}" добавлена в "${res.house.name}" (всего комнат: ${res.house.rooms.length}).\n${syncText}\n💡 Добавить предмет: \`add thing\` ➔ \`desk\` ➔ \`to room\` ➔ \`${res.room.name}\` ➔ \`of house\` ➔ \`${res.house.number || res.house.name}\` ➔ \`queue id\` ➔ \`2\`.`,
                    style: 'output-success'
                };
            } catch (err) {
                const msg = err && err.message ? err.message : String(err);
                return {
                    response: `❌ ${msg}\nДоступные дома: ${formatHousesSummary(user)}`,
                    style: 'output-error',
                    commandSteps: steps,
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/4: номер или название дома...'
                };
            }
        }
    });

    // 3. Add thing (8 этапов: 1: add thing -> 2: desk -> 3: to room -> 4: kitchen/2 -> 5: of house -> 6: 2/House_name -> 7: queue id -> <id>)
    CommandRegistry.register({
        names: ['add thing', 'add item', 'add furniture', 'new thing', 'добавить предмет', 'добавить вещь', 'додати річ', 'додати предмет'],
        description: 'Добавить предмет в комнату дома (строго поэтапно: add thing ➔ вещь ➔ to room ➔ комната ➔ of house ➔ дом ➔ queue id ➔ номер)',
        category: 'House',
        usage: 'add thing -> desk -> to room -> kitchen -> of house -> 2 -> queue id -> 2',
        handler: async (parameters, options = {}) => {
            const { user, error } = await requireAuthedUserForHouses();
            if (error) return error;

            const baseLabel = 'add thing';
            const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

            if (!options || !options.fromTwoStepBar) {
                if (rawArgs) {
                    return {
                        response: '⚠️ Команда `add thing` выполняется строго поэтапно (однострочный синтаксис не используется)!\nЭтапы:\n1️⃣ `add thing`\n2️⃣ предмет (`table` / `desk` / `stove` / `fridge` / `bed` / `sofa` / `laptop`...)\n3️⃣ `to room`\n4️⃣ комната (`kitchen` или номер)\n5️⃣ `of house`\n6️⃣ дом (`2` или название)\n7️⃣ `queue id`\n➡️ затем номер очереди (например: `2`, или `0` если без привязки).',
                        style: 'output-error'
                    };
                }
                return {
                    response: '🪑 add thing (Этап 1/7): введите название предмета (напр: `table`, `desk`, `stove`, `fridge`, `bed`, `sofa`, `closet`, `laptop`, `tv`) и нажмите Enter или ✅.',
                    style: 'output-info',
                    commandSteps: [baseLabel],
                    inputValue: '',
                    inputPlaceholder: 'Этап 2: название предмета (напр: desk)...'
                };
            }

            const steps = Array.isArray(options.pendingSteps) ? options.pendingSteps : [baseLabel];
            const payload = String(options.stepPayload !== undefined ? options.stepPayload : rawArgs).trim();

            // Этап 2: название предмета
            if (steps.length === 1) {
                if (!payload) {
                    return {
                        response: '⚠️ Введите название предмета (например: `desk` или `table`).',
                        style: 'output-error',
                        commandSteps: [steps[0] || baseLabel],
                        inputValue: '',
                        inputPlaceholder: 'Этап 2: название предмета (напр: desk)...'
                    };
                }
                return {
                    response: `🪑 Предмет: "${payload}" (Этап 2 выполнен).\n➡️ Этап 3: введите \`to room\` и нажмите Enter или ✅.`,
                    style: 'output-info',
                    commandSteps: [steps[0] || baseLabel, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3: введите to room...'
                };
            }

            // Этап 3: ключевая фраза `to room`
            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['to room', 'в комнату', 'до кімнати'])) {
                    return {
                        response: `⚠️ На этапе 3 необходимо ввести \`to room\` (чтобы указать комнату для "${steps[1]}").`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 3: введите to room...'
                    };
                }
                return {
                    response: '🚪 Этап 4: введите название или номер комнаты (например: `kitchen` или `2`).',
                    style: 'output-info',
                    commandSteps: [...steps, 'to room'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 4: комната (напр: kitchen или 2)...'
                };
            }

            // Этап 4: комната
            if (steps.length === 3) {
                if (!payload) {
                    return {
                        response: '⚠️ Введите название или номер комнаты (например: `kitchen` или `2`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 4: комната (напр: kitchen или 2)...'
                    };
                }
                return {
                    response: `🚪 Комната: "${payload}" (Этап 4 выполнен).\n➡️ Этап 5: введите \`of house\` и нажмите Enter или ✅.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 5: введите of house...'
                };
            }

            // Этап 5: ключевая фраза `of house`
            if (steps.length === 4) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'из дома', 'в доме', 'будинку'])) {
                    return {
                        response: '⚠️ На этапе 5 необходимо ввести `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 5: введите of house...'
                    };
                }
                return {
                    response: `🏠 Этап 6: введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 6: номер или название дома (напр: 2)...'
                };
            }

            // Этап 6: дом
            if (steps.length === 5) {
                if (!payload) {
                    return {
                        response: `⚠️ Введите номер или название дома (доступны: ${formatHousesSummary(user)}).`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 6: номер или название дома...'
                    };
                }
                const targetHouse = window.UserHousesSync ? window.UserHousesSync.findHouse(user, payload) : null;
                if (!targetHouse) {
                    return {
                        response: `❌ Дом "${payload}" не найден в вашем аккаунте. Доступны: ${formatHousesSummary(user)}.`,
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 6: номер или название дома...'
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
                        inputPlaceholder: 'Этап 6: другой дом...'
                    };
                }
                return {
                    response: `🏠 Дом: "${targetHouse.name}" (Этап 6 выполнен).\n🔢 Этап 7: введите \`queue id\` и нажмите Enter или ✅.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 7: введите queue id...'
                };
            }

            // Этап 7: ключевая фраза `queue id`
            if (steps.length === 6) {
                if (!isKeywordStep(payload, ['queue id', 'queue', 'id очереди', 'очередь'])) {
                    return {
                        response: '⚠️ На этапе 7 необходимо ввести `queue id` (после чего на финальном шаге указать номер, например `2`).',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 7: введите queue id...'
                    };
                }
                return {
                    response: '🔢 Финальный шаг: введите номер очереди (например: `2`, или `0` / `-` если предмет без привязки к очереди).',
                    style: 'output-info',
                    commandSteps: [...steps, 'queue id'],
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
                const qText = queueNum > 0 ? `привязан к Queue #${queueNum}` : 'без привязки к очереди';
                const doorText = Math.min(res.thing.w, res.thing.h) <= 2 ? 'проходит в двери (≤ 2 пл.)' : 'не проходит в двери (> 2 пл.)';
                return {
                    response: `✅ Предмет "${res.thing.name}" (${res.thing.w}×${res.thing.h}, ${qText}, ${doorText}) размещён в комнате "${res.room.name}" дома "${res.house.name}" (коорд. ${res.thing.col},${res.thing.row}).\n${syncText}`,
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
                const typeNote = h.builtin ? 'встроенный шаблон + ваши добавления' : (rooms.length === 0 ? 'пустой' : `${rooms.length} комн.`);
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
                        inputPlaceholder: 'Этап 3/5: +90 или -90...'
                    };
                }
                return {
                    response: `↻ Направление: ${parseRotationDelta(payload) > 0 ? '+90°' : '-90°'}.\n➡️ Этап 4/5: введите \`of house\`.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/5: введите of house...'
                };
            }

            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return {
                        response: '⚠️ На этапе 4/5 введите `of house`.',
                        style: 'output-error',
                        commandSteps: steps,
                        inputValue: '',
                        inputPlaceholder: 'Этап 4/5: введите of house...'
                    };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Этап 5/5: введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 5/5: номер или название дома...'
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
                    return { response: '⚠️ Укажите предмет.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/4: предмет...' };
                }
                return {
                    response: `🙈 Предмет: "${payload}".\n➡️ Этап 3/4: введите \`of house\`.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/4: введите of house...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ На этапе 3/4 введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 3/4: введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Этап 4/4: введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/4: номер или название дома...'
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
                    return { response: '⚠️ Укажите предмет или `all`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/4: предмет или all...' };
                }
                return {
                    response: `👁️ Возврат: "${payload}".\n➡️ Этап 3/4: введите \`of house\`.`,
                    style: 'output-info',
                    commandSteps: [...steps, payload],
                    inputValue: '',
                    inputPlaceholder: 'Этап 3/4: введите of house...'
                };
            }

            if (steps.length === 2) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ На этапе 3/4 введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 3/4: введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return {
                    response: `🏠 Этап 4/4: введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`,
                    style: 'output-info',
                    commandSteps: [...steps, 'of house'],
                    inputValue: '',
                    inputPlaceholder: 'Этап 4/4: номер или название дома...'
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
                if (!payload) return { response: '⚠️ Укажите предмет.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 2/5: предмет...' };
                return { response: `↔️ Предмет: "${payload}".\n➡️ Этап 3/5: введите координаты \`col,row\` (напр: \`2,1\`).`, style: 'output-info', commandSteps: [...steps, payload], inputValue: '', inputPlaceholder: 'Этап 3/5: col,row...' };
            }
            if (steps.length === 2) {
                if (!parseMoveCoords(payload)) {
                    return { response: '⚠️ Введите координаты в формате `col,row` (напр: `2,1`).', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 3/5: col,row...' };
                }
                return { response: `↔️ Координаты: ${payload}.\n➡️ Этап 4/5: введите \`of house\`.`, style: 'output-info', commandSteps: [...steps, payload], inputValue: '', inputPlaceholder: 'Этап 4/5: введите of house...' };
            }
            if (steps.length === 3) {
                if (!isKeywordStep(payload, ['of house', 'of home', 'in house', 'in home', 'дома', 'в доме'])) {
                    return { response: '⚠️ На этапе 4/5 введите `of house`.', style: 'output-error', commandSteps: steps, inputValue: '', inputPlaceholder: 'Этап 4/5: введите of house...' };
                }
                const { user } = await requireAuthedUserForHouses();
                return { response: `🏠 Этап 5/5: введите номер или название дома (доступны: ${user ? formatHousesSummary(user) : '1, 2, 3'}).`, style: 'output-info', commandSteps: [...steps, 'of house'], inputValue: '', inputPlaceholder: 'Этап 5/5: дом...' };
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
})();
