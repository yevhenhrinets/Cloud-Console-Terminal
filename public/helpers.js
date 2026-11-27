// helpers.js — утилиты, парсер, сессия Supabase Auth и работа с ID

let currentUserCache = null;
const CACHED_AUTH_USER_KEY = 'terminal_cached_auth_user';

function getCachedAuthUser() {
    try {
        const raw = localStorage.getItem(CACHED_AUTH_USER_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.id !== 'guest') return parsed;
    } catch (e) {}
    return null;
}

function setCachedAuthUser(userObj) {
    try {
        if (userObj && !userObj.isGuest && userObj.id && userObj.id !== 'guest') {
            localStorage.setItem(CACHED_AUTH_USER_KEY, JSON.stringify({
                id: userObj.id,
                email: userObj.email,
                name: userObj.name,
                nickname: userObj.nickname,
                role: userObj.role,
                isGuest: false
            }));
        }
    } catch (e) {}
}

function clearCachedAuthUser() {
    try {
        localStorage.removeItem(CACHED_AUTH_USER_KEY);
    } catch (e) {}
}

function clearCurrentUserCache() {
    currentUserCache = null;
    clearCachedAuthUser();
}

// Функция безопасного выхода из системы
async function performLogout() {
    try {
        const userId = currentUserCache ? currentUserCache.id : null;

        if (userId && userId !== 'guest' && window.supabaseClient && navigator.onLine !== false) {
            await window.supabaseClient
                .from('profiles')
                .update({ status: 'offline' })
                .eq('id', userId);
        }

        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.auth.signOut();
            if (error) throw error;
        }
    } catch (err) {
        if (typeof printOutput === 'function') {
            printOutput('❌ Ошибка выхода: ' + err.message, 'output-error', true);
        }
    } finally {
        clearCurrentUserCache();
    }
}

const GUEST_USER = {
    id: 'guest',
    email: 'guest@demo.terminal',
    name: 'Гість (Демо Root)',
    nickname: 'DemoRoot',
    role: 'root',
    isGuest: true
};

async function fetchCurrentUser(requireRealAuth = false) {
    if (currentUserCache && !currentUserCache.isGuest) {
        return currentUserCache;
    }
    const cachedAuth = getCachedAuthUser();

    try {
        if (!window.supabaseClient) {
            if (cachedAuth) {
                currentUserCache = cachedAuth;
                return currentUserCache;
            }
            currentUserCache = requireRealAuth ? null : GUEST_USER;
            return currentUserCache;
        }

        const sessionPromise = window.supabaseClient.auth.getSession();
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ data: { session: null }, error: { message: 'timeout' } }), 2000));
        const res = await Promise.race([sessionPromise, timeoutPromise]);
        const session = res?.data?.session;

        if (!session) {
            if (cachedAuth && (navigator.onLine === false || res?.error)) {
                currentUserCache = cachedAuth;
                return currentUserCache;
            }
            currentUserCache = requireRealAuth ? null : GUEST_USER;
            return currentUserCache;
        }

        const authUser = session.user;
        const emailLower = String(authUser.email || '').toLowerCase();
        const fallbackRole = (emailLower === 'e.grinec@gmail.com' || emailLower === 'yevhenhrinets@gmail.com') ? 'root' : 'user';

        let profile = null;
        if (navigator.onLine !== false) {
            try {
                const { data: profiles, error: profileError } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', authUser.id);
                if (!profileError && profiles && profiles.length > 0) {
                    profile = profiles[0];
                }
            } catch (profErr) {
                console.warn('Оффлайн / сбой загрузки профиля из Supabase:', profErr);
            }
        }

        const userObj = {
            id: authUser.id,
            email: authUser.email,
            name: profile?.name || cachedAuth?.name || authUser.user_metadata?.full_name || authUser.email.split('@')[0],
            nickname: profile?.nickname || cachedAuth?.nickname || 'Не задан',
            role: profile?.role || cachedAuth?.role || fallbackRole,
            isGuest: false
        };

        currentUserCache = userObj;
        setCachedAuthUser(userObj);
        return userObj;
    } catch (err) {
        console.error('❌ Ошибка в fetchCurrentUser:', err);
        if (cachedAuth) {
            currentUserCache = cachedAuth;
            return currentUserCache;
        }
        currentUserCache = requireRealAuth ? null : GUEST_USER;
        return currentUserCache;
    }
}

const ROOT_OWNER_EMAILS = ['yevhenhrinets@gmail.com', 'e.grinec@gmail.com'];
const USER_HOUSES_STORAGE_PREFIX = 'terminal_user_houses_v2';
const USER_HOUSES_PENDING_PREFIX = 'terminal_user_houses_pending_v2';
let cachedSupabaseAccessToken = null;

const HOUSE_DEFINITIONS = [
    {
        id: 'house1',
        number: 1,
        roomId: 'house1_square',
        name: 'Дом 1',
        url: '/house/index.html',
        builtin: true,
        ownerRole: 'root',
        ownerEmails: ROOT_OWNER_EMAILS
    },
    {
        id: 'house2',
        number: 2,
        roomId: 'house2_square',
        name: 'Дом 2',
        url: '/house2/index.html',
        builtin: true,
        ownerRole: 'root',
        ownerEmails: ROOT_OWNER_EMAILS
    },
    {
        id: 'house3',
        number: 3,
        roomId: 'house3_square_v2',
        name: 'Дом 3',
        url: '/house3/index.html',
        builtin: true,
        ownerRole: 'root',
        ownerEmails: ROOT_OWNER_EMAILS
    }
];

function isRootUser(user) {
    if (!user || user.isGuest || !user.id || user.id === 'guest') return false;
    const role = String(user.role || '').toLowerCase().trim();
    const email = String(user.email || '').toLowerCase().trim();
    return role === 'root' || ROOT_OWNER_EMAILS.includes(email);
}

function isAdminUser(user) {
    if (!user || user.isGuest || user.id === 'guest') return false;
    const role = String(user.role || '').toLowerCase();
    const email = String(user.email || '').toLowerCase();
    return ['root', 'support', 'admin'].includes(role) || ROOT_OWNER_EMAILS.includes(email);
}

function normalizeHouseRefId(houseIdOrRef) {
    const raw = String(houseIdOrRef || '').trim().toLowerCase();
    if (!raw || raw === '1' || raw === 'house' || raw === 'home' || raw === 'house 1' || raw === 'home 1' || raw === 'house1' || raw === 'home1' || raw === 'дом' || raw === 'дом 1' || raw === 'дім' || raw === 'дім 1' || raw === 'house1_square' || raw.includes('/house/') || raw === '/house' || raw.includes('kitchen.html') || raw.includes('hall.html')) {
        return 'house1';
    }
    if (raw === '2' || raw === 'house2' || raw === 'home2' || raw === 'house 2' || raw === 'home 2' || raw === 'дом 2' || raw === 'дом2' || raw === 'дім 2' || raw === 'house2_square' || raw.includes('/house2')) {
        return 'house2';
    }
    if (raw === '3' || raw === 'house3' || raw === 'home3' || raw === 'house 3' || raw === 'home 3' || raw === 'дом 3' || raw === 'дом3' || raw === 'дім 3' || raw === 'house3_square' || raw === 'house3_square_v2' || raw.includes('/house3')) {
        return 'house3';
    }
    if (/^\d+$/.test(raw)) {
        return `house${parseInt(raw, 10)}`;
    }
    return raw;
}

function makeHouseSlugId(nameOrNum) {
    const clean = String(nameOrNum || '').trim();
    if (/^\d+$/.test(clean)) {
        return `house${parseInt(clean, 10)}`;
    }
    const normRef = normalizeHouseRefId(clean);
    if (normRef === 'house1' || normRef === 'house2' || normRef === 'house3') {
        return normRef;
    }
    const slug = clean.toLowerCase().replace(/[^a-z0-9а-яєіїё]+/gi, '_').replace(/^_+|_+$/g, '');
    return `house_${slug || Date.now()}`;
}

function getHouseUrlByRecord(h) {
    if (!h) return '/house/index.html';
    if (h.id === 'house1') return '/house/index.html';
    if (h.id === 'house2') return '/house2/index.html';
    if (h.id === 'house3') return '/house3/index.html';
    return `/house/index.html?house=${encodeURIComponent(h.id)}`;
}

function buildDefaultUserHousesState(user) {
    const isRoot = isRootUser(user);
    const nowIso = new Date().toISOString();
    if (isRoot) {
        return {
            version: 2,
            updatedAt: nowIso,
            ts: Date.now(),
            houses: HOUSE_DEFINITIONS.map(def => ({
                id: def.id,
                number: def.number,
                roomId: def.roomId,
                name: def.name,
                url: def.url,
                builtin: true,
                rooms: [],
                things: [],
                createdAt: nowIso
            }))
        };
    }
    // По умолчанию для нового/обычного аккаунта — 1 пустой Дом 1
    return {
        version: 2,
        updatedAt: nowIso,
        ts: Date.now(),
        houses: [
            {
                id: 'house1',
                number: 1,
                roomId: 'house1_square',
                name: 'Дом 1',
                url: '/house/index.html',
                builtin: false,
                rooms: [],
                things: [],
                createdAt: nowIso
            }
        ]
    };
}

function loadUserHousesState(user) {
    if (!user || user.isGuest || !user.id || user.id === 'guest') return null;
    const key = `${USER_HOUSES_STORAGE_PREFIX}::${user.id}`;
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.houses)) {
                // Для root гарантируем наличие встроенных house1, house2, house3
                if (isRootUser(user)) {
                    HOUSE_DEFINITIONS.forEach(def => {
                        let existing = parsed.houses.find(h => h.id === def.id);
                        if (!existing) {
                            parsed.houses.unshift({
                                id: def.id,
                                number: def.number,
                                roomId: def.roomId,
                                name: def.name,
                                url: def.url,
                                builtin: true,
                                rooms: [],
                                things: [],
                                createdAt: new Date().toISOString()
                            });
                        } else {
                            existing.builtin = true;
                            existing.roomId = def.roomId;
                            if (!existing.url) existing.url = def.url;
                            if (!existing.number) existing.number = def.number;
                        }
                    });
                } else {
                    // Для обычного аккаунта гарантируем хотя бы пустой Дом 1
                    if (!parsed.houses.some(h => h.id === 'house1')) {
                        parsed.houses.unshift({
                            id: 'house1',
                            number: 1,
                            roomId: 'house1_square',
                            name: 'Дом 1',
                            url: '/house/index.html',
                            builtin: false,
                            rooms: [],
                            things: [],
                            createdAt: new Date().toISOString()
                        });
                    }
                    parsed.houses.forEach(h => {
                        h.builtin = false;
                    });
                }
                return parsed;
            }
        }
    } catch (e) {}
    const fresh = buildDefaultUserHousesState(user);
    try {
        localStorage.setItem(key, JSON.stringify(fresh));
    } catch (e) {}
    return fresh;
}

function saveUserHousesStateLocal(user, state) {
    if (!user || user.isGuest || !user.id || user.id === 'guest' || !state) return;
    try {
        localStorage.setItem(`${USER_HOUSES_STORAGE_PREFIX}::${user.id}`, JSON.stringify(state));
    } catch (e) {}
}

function findUserHouseByRef(housesList, ref) {
    if (!Array.isArray(housesList) || housesList.length === 0) return null;
    const raw = String(ref || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const norm = normalizeHouseRefId(raw);
    return housesList.find(h =>
        String(h.id || '').toLowerCase() === lower ||
        String(h.id || '').toLowerCase() === norm ||
        String(h.name || '').toLowerCase() === lower ||
        (h.number !== undefined && String(h.number) === lower) ||
        (`дом ${h.number}` === lower) ||
        (`house ${h.number}` === lower) ||
        (`home ${h.number}` === lower)
    ) || null;
}

function getHouseDefinition(houseIdOrPath) {
    const raw = String(houseIdOrPath || '').toLowerCase().trim();
    if (!raw) return HOUSE_DEFINITIONS[0];
    if (raw === 'house3' || raw === 'home3' || raw === '3' || raw === 'house3_square' || raw === 'house3_square_v2' || raw.includes('/house3')) {
        return HOUSE_DEFINITIONS[2];
    }
    if (raw === 'house2' || raw === 'home2' || raw === '2' || raw === 'house2_square' || raw.includes('/house2')) {
        return HOUSE_DEFINITIONS[1];
    }
    if (raw === 'house1' || raw === 'home1' || raw === '1' || raw === 'house' || raw === 'home' || raw === 'house1_square' || raw.includes('/house/') || raw === '/house' || raw.includes('kitchen.html') || raw.includes('hall.html')) {
        return HOUSE_DEFINITIONS[0];
    }
    return {
        id: raw,
        roomId: `${raw}_square`,
        name: raw,
        url: `/house/index.html?house=${encodeURIComponent(raw)}`,
        builtin: false
    };
}

function getUserBoundHouses(user) {
    if (!user || user.isGuest || !user.id || user.id === 'guest') return [];
    const state = loadUserHousesState(user);
    const list = (state && Array.isArray(state.houses)) ? state.houses : [];
    return list.map(h => ({
        ...h,
        url: getHouseUrlByRecord(h),
        roomId: h.roomId || `${h.id}_square`,
        ownerId: user.id,
        ownerEmail: user.email || '',
        ownerRole: user.role || 'user'
    }));
}

function canAccessHouse(user, houseIdOrPath = 'house1') {
    const baseDef = getHouseDefinition(houseIdOrPath) || HOUSE_DEFINITIONS[0];
    if (!user || user.isGuest || !user.id || user.id === 'guest') {
        return {
            allowed: false,
            reason: 'unauthenticated',
            house: baseDef,
            message: '🔒 Доступ к Домам открыт только авторизованным пользователям. Выполните вход через Google (команда `login`).'
        };
    }
    const bound = getUserBoundHouses(user);
    const normRef = normalizeHouseRefId(baseDef.id || houseIdOrPath);
    const found = findUserHouseByRef(bound, normRef) || findUserHouseByRef(bound, houseIdOrPath);
    if (!found) {
        return {
            allowed: false,
            reason: 'not_owned_or_created',
            house: baseDef,
            message: `🔒 ${baseDef.name} ещё не создан для аккаунта ${user.email || user.id}.\nСоздайте его пошагово: \`Add house\` ➔ введите номер/название, а затем \`Add room\` и \`Add thing\`.`
        };
    }
    return {
        allowed: true,
        reason: 'ok',
        house: found,
        user
    };
}

function updateGlobalAuthBadge(user) {
    if (typeof document === 'undefined') return;
    const isAuthed = Boolean(user && !user.isGuest && user.id && user.id !== 'guest');
    const email = isAuthed ? String(user.email || user.name || user.id).trim() : '';
    const text = isAuthed ? `🟢 ${email}` : '🔴 Не авторизован';
    const title = isAuthed
        ? `Авторизован: ${email}`
        : 'Вы не авторизованы (войдите командой login)';

    const targets = [];
    const primary = document.getElementById('global-auth-profile');
    if (primary) targets.push(primary);
    document.querySelectorAll('[data-global-auth-profile]').forEach(el => {
        if (!targets.includes(el)) targets.push(el);
    });

    targets.forEach(el => {
        el.textContent = text;
        el.title = title;
        el.classList.toggle('is-authed', isAuthed);
        el.classList.toggle('is-guest', !isAuthed);
    });
}

function applyHouseNavVisibility(user) {
    if (typeof document === 'undefined') return;
    const isAuthed = Boolean(user && !user.isGuest && user.id && user.id !== 'guest');
    const bound = isAuthed ? getUserBoundHouses(user) : [];
    const house1 = bound.find(h => h.id === 'house1');
    const house2 = bound.find(h => h.id === 'house2');
    const house3 = bound.find(h => h.id === 'house3');

    const mapSelectors = [
        {
            show: Boolean(house1),
            label: `🏠 ${(house1 && house1.name) || 'Дом 1'}`,
            sel: '.quick-bar a[href="/house/index.html"], .header a[href="/house/index.html"], .nav-links a[href="/house/index.html"]'
        },
        {
            show: Boolean(house2),
            label: `🏡 ${(house2 && house2.name) || 'Дом 2'}`,
            sel: '.quick-bar a[href="/house2/index.html"], .header a[href="/house2/index.html"], .nav-links a[href="/house2/index.html"]'
        },
        {
            show: Boolean(house3),
            label: `🏘️ ${(house3 && house3.name) || 'Дом 3'}`,
            sel: '.quick-bar a[href="/house3/index.html"], .header a[href="/house3/index.html"], .nav-links a[href="/house3/index.html"]'
        }
    ];
    try {
        mapSelectors.forEach(entry => {
            document.querySelectorAll(entry.sel).forEach(el => {
                el.style.display = entry.show ? '' : 'none';
                el.setAttribute('aria-hidden', entry.show ? 'false' : 'true');
                if (entry.show && entry.label) {
                    el.textContent = entry.label;
                }
            });
        });

        // Добавляем кнопки для пользовательских домов (>3 или с именами) в quick-bar
        const quickBar = document.getElementById('quick-bar');
        if (quickBar) {
            quickBar.querySelectorAll('a.dynamic-house-chip').forEach(el => el.remove());
            if (isAuthed) {
                const anchorBefore = quickBar.querySelector('a[href="/house3/index.html"]') || quickBar.querySelector('a[href="/house/index.html"]');
                const customHouses = bound.filter(h => !['house1', 'house2', 'house3'].includes(h.id));
                customHouses.forEach(h => {
                    const a = document.createElement('a');
                    a.className = 'quick-chip dynamic-house-chip';
                    a.href = getHouseUrlByRecord(h);
                    a.textContent = `🏠 ${h.name}`;
                    a.onclick = (e) => {
                        if (typeof handleQuickNav === 'function') {
                            return handleQuickNav(e, `go to home ${h.number || h.id}`);
                        }
                        return true;
                    };
                    if (anchorBefore && anchorBefore.parentNode === quickBar) {
                        quickBar.insertBefore(a, anchorBefore.nextSibling);
                    } else {
                        quickBar.appendChild(a);
                    }
                });
            }
        }
    } catch (e) {}

    updateGlobalAuthBadge(user);
}

if (typeof window !== 'undefined') {
    window.ROOT_OWNER_EMAILS = ROOT_OWNER_EMAILS;
    window.HOUSE_DEFINITIONS = HOUSE_DEFINITIONS;
    window.isRootUser = isRootUser;
    window.isAdminUser = isAdminUser;
    window.getHouseDefinition = getHouseDefinition;
    window.getUserBoundHouses = getUserBoundHouses;
    window.canAccessHouse = canAccessHouse;
    window.applyHouseNavVisibility = applyHouseNavVisibility;
    window.updateGlobalAuthBadge = updateGlobalAuthBadge;
    window.clearCurrentUserCache = clearCurrentUserCache;
}

function parseCommand(rawText) {
    if (!rawText) return { cmd: '', parameters: { args: [], raw_args: '' } };

    const parts = rawText.trim().split(/\s+/);

    // Очищаем первые слова от двоеточий на конце (например, "note:", "add:")
    for (let i = 0; i < Math.min(parts.length, 12); i++) {
        if (parts[i].endsWith(':')) {
            parts[i] = parts[i].slice(0, -1);
        }
    }

    const lowerParts = parts.map(p => p.toLowerCase());
    const cmd = lowerParts[0] || '';
    let actualCmd = cmd;
    let prefixWordsCount = 1;

    // Самое длинное совпадение (до 12 слов включительно, с учётом артиклей a/an/the)
    if (parts.length > 1 && window.CommandRegistry) {
        const maxWords = Math.min(parts.length, 12);
        for (let wordCount = maxWords; wordCount >= 2; wordCount--) {
            const candidate = lowerParts.slice(0, wordCount).join(' ');
            if (window.CommandRegistry.getHandler(candidate)) {
                actualCmd = candidate;
                prefixWordsCount = wordCount;
                break;
            }
        }
    }

    // Получаем чистый остаток строки после prefixWordsCount слов команды
    const trimmedRaw = rawText.trim();
    const raw_args = prefixWordsCount >= parts.length
        ? ''
        : trimmedRaw.replace(new RegExp(`^(?:\\S+\\s+){${prefixWordsCount}}`), '').trim();

    // 💡 Умный разбор аргументов: делит по пробелам, но объединяет текст внутри кавычек в один аргумент
    const args = [];
    const regex = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
    let match;
    while ((match = regex.exec(raw_args)) !== null) {
        args.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]));
    }

    return {
        cmd: actualCmd,
        parameters: {
            args,
            raw_args
        }
    };
}

function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/*
// Улучшенный экстрактор ID: поддерживает запятые и синоним number / id
function extractNumericIds(argsArray) {
    const stopWords = [
        'note', 'notes', 'history', 'id', 'number', 'номер', '№', 'user', 'of', 'as', 'for',
        'заметку', 'заметки', 'заметка', 'нотатку', 'нотатки', 'нотатка', 
        'историю', 'история', 'історію', 'історія', 'пользователя', 'користувача'
    ];

    // Разворачиваем аргументы, разделяя их по запятым (на случай "3,5,7" или "3, 5, 7")
    const cleanedArgs = [];
    for (const arg of argsArray) {
        const splitByComma = arg.split(',');
        for (const part of splitByComma) {
            if (part.trim() !== '') {
                cleanedArgs.push(part.trim());
            }
        }
    }

    return cleanedArgs
        .filter(arg => !stopWords.includes(arg.toLowerCase()))
        .map(arg => Number(arg))
        .filter(num => !isNaN(num) && num > 0);
}
*/

// Вспомогательная функция для определения ID (поддерживает числа и ключевое слово "last")
// Вспомогательный резолвер ID (поддерживает числа и ключевое слово "last")
async function resolveTargetId(args, tableName, targetUserId) {
    const argsLower = args.map(a => String(a).toLowerCase());
    const isLastKeyword = argsLower.some(w => ['last', 'последняя', 'последний', 'посл', 'остання', 'останній'].includes(w));
    
    if (isLastKeyword) {
        if (window.supabaseClient && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
            try {
                const { data, error } = await window.supabaseClient
                    .from(tableName)
                    .select('inner_id')
                    .eq('created_by', targetUserId)
                    .order('inner_id', { ascending: false })
                    .limit(1);
                    
                if (error) throw error;
                if (data && data.length > 0) return data[0].inner_id;
            } catch (err) {
                console.warn('Ошибка поиска последнего ID (пробую кэш):', err);
            }
        }
        if (tableName === 'notes' && window.OfflineNotesSync) {
            const cached = window.OfflineNotesSync.getNotesCache(targetUserId).filter(n => !n.deleted_at);
            if (cached.length > 0) {
                cached.sort((a, b) => Number(b.inner_id) - Number(a.inner_id));
                return cached[0].inner_id;
            }
        }
        return null;
    }
    
    const ids = extractNumericIds(args);
    return ids.length > 0 ? ids[0] : null;
}

function extractNumericIds(args) {
    // Собираем всё в единую строку (неважно, массив это или строка)
    const text = Array.isArray(args) ? args.join(' ') : String(args || '');
    
    // Находим абсолютно все последовательности цифр в тексте
    const matches = text.match(/\d+/g);
    
    // Превращаем их в числа и убираем дубликаты (если вдруг ввели два раза одно и то же)
    return matches ? [...new Set(matches.map(Number))] : [];
}

function checkPlurality(argsArray) {
    const singularWords = ['note', 'заметку', 'заметка', 'нотатку', 'нотатка'];
    const pluralWords = ['notes', 'заметки', 'нотатки'];

    for (const arg of argsArray) {
        const lower = arg.toLowerCase();
        if (pluralWords.includes(lower)) return 'plural';
        if (singularWords.includes(lower)) return 'singular';
    }
    return 'neutral';
}

function rejectInlineParamsError(cmdPrefix, step2Example = '6', extraHint = '') {
    const cleanPrefix = String(cmdPrefix || '').trim() || 'команда';
    const examplePart = step2Example ? ` (например: \`${step2Example}\`)` : '';
    const extraPart = extraHint ? `\n${extraHint}` : '';
    return {
        response: `⚠️ Все параметры (включая числа и текст) вводятся строго на 2-м этапе!\n1) Введите сначала только словесную команду: \`${cleanPrefix}\`\n2) После появления команды под строкой ввода введите параметр${examplePart}.${extraPart}`,
        style: 'output-error'
    };
}
if (typeof window !== 'undefined') {
    window.rejectInlineParamsError = rejectInlineParamsError;
}

const LOCAL_ACTIONS_KEY = 'terminal_actions_history';
const PENDING_CLOUD_ACTIONS_KEY = 'terminal_pending_cloud_actions';
const MAX_LOCAL_ACTIONS = 200;
let pendingActionFlushPromise = null;
let actionSeqCounter = 0;

function getLocalActionsHistory() {
    try {
        const raw = localStorage.getItem(LOCAL_ACTIONS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Ошибка чтения local actions history:', e);
        return [];
    }
}

function getPendingCloudActions() {
    try {
        const raw = localStorage.getItem(PENDING_CLOUD_ACTIONS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingCloudActions(list) {
    try {
        localStorage.setItem(PENDING_CLOUD_ACTIONS_KEY, JSON.stringify(list));
    } catch (e) {}
}

function getCanonicalNavKey(rawText) {
    const lower = String(rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!lower) return '';
    if ([
        'go to missions', 'go missions', 'missions.html', 'open missions',
        'todo', 'go to todo', 'go todo', 'open todo',
        'список дел', 'страница заданий', 'страница поручений', 'missions page',
        'go to задания', 'go to поручения'
    ].includes(lower)) {
        return 'nav:missions';
    }
    if ([
        'go to dashboard', 'dashboard', 'dashboard.html', 'дашборд', 'дашбоард',
        'панель', 'gui', 'go dashboard', 'open dashboard', 'go to дашборд'
    ].includes(lower)) {
        return 'nav:dashboard';
    }
    if ([
        'go to house 3 kitchen', 'go to house3 kitchen', 'go to home 3 kitchen', 'go to kitchen 3', 'go to kitchen3',
        'kitchen 3', 'kitchen3', 'кухня 3', 'кухня3', 'go kitchen 3', 'open kitchen 3', 'go to кухня 3'
    ].includes(lower)) {
        return 'nav:house3_kitchen';
    }
    if ([
        'go to house 3 hall', 'go to house3 hall', 'go to home 3 hall', 'go to hall 3', 'go to hall3',
        'hall 3', 'hall3', 'зал 3', 'зала 3', 'зал3', 'go hall 3', 'open hall 3', 'go to зал 3'
    ].includes(lower)) {
        return 'nav:house3_hall';
    }
    if ([
        'go to home 3', 'go to home3', 'go to house 3', 'go to house3', 'home 3', 'home3', 'house 3', 'house3',
        'дом 3', 'дом3', 'дім 3', 'дім3', 'будинок 3', 'go home 3', 'go house 3', 'open home 3', 'open house 3', 'go to дом 3'
    ].includes(lower)) {
        return 'nav:house3';
    }
    if ([
        'go to house 2 kitchen', 'go to house2 kitchen', 'go to home 2 kitchen', 'go to kitchen 2', 'go to kitchen2',
        'kitchen 2', 'kitchen2', 'кухня 2', 'кухня2', 'go kitchen 2', 'open kitchen 2', 'go to кухня 2'
    ].includes(lower)) {
        return 'nav:house2_kitchen';
    }
    if ([
        'go to house 2 hall', 'go to house2 hall', 'go to home 2 hall', 'go to hall 2', 'go to hall2',
        'hall 2', 'hall2', 'зал 2', 'зала 2', 'зал2', 'go hall 2', 'open hall 2', 'go to зал 2'
    ].includes(lower)) {
        return 'nav:house2_hall';
    }
    if ([
        'go to home 2', 'go to home2', 'go to house 2', 'go to house2', 'home 2', 'home2', 'house 2', 'house2',
        'дом 2', 'дом2', 'дім 2', 'дім2', 'будинок 2', 'go home 2', 'go house 2', 'open home 2', 'open house 2', 'go to дом 2'
    ].includes(lower)) {
        return 'nav:house2';
    }
    if ([
        'go to kitchen', 'go to kitchen 1', 'kitchen', 'kitchen 1', 'kitchen.html', 'кухня', 'кухня 1', 'go kitchen', 'open kitchen', 'go to кухня'
    ].includes(lower)) {
        return 'nav:kitchen';
    }
    if ([
        'go to hall', 'go to hall 1', 'hall', 'hall 1', 'hall.html', 'parlor', 'parlour', 'go to parlor', 'go to parlour',
        'зал', 'зала', 'зал 1', 'гостиная', 'вітальня', 'go hall', 'open hall', 'go to зал'
    ].includes(lower)) {
        return 'nav:hall';
    }
    if ([
        'go to home', 'go to home 1', 'go to house', 'go to house 1', 'home', 'home 1', 'house', 'house 1',
        'дом', 'дом 1', 'дім', 'дім 1', 'будинок', 'будинок 1', 'go home', 'go house', 'open home', 'open house', 'go to дом'
    ].includes(lower)) {
        return 'nav:house';
    }
    if ([
        'go to terminal', 'go to console', 'go terminal', 'go console', 'terminal.html', 'terminal', 'console', 'консоль', 'терминал'
    ].includes(lower)) {
        return 'nav:terminal';
    }
    if (lower.startsWith('select ')) {
        const m = lower.match(/(\d+)\s*$/);
        if (m) return `nav:select:${m[1]}`;
    }
    return '';
}

function saveLocalAction(actionItem) {
    try {
        const list = getLocalActionsHistory();
        list.unshift(actionItem);
        if (list.length > MAX_LOCAL_ACTIONS) {
            list.length = MAX_LOCAL_ACTIONS;
        }
        localStorage.setItem(LOCAL_ACTIONS_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('Ошибка сохранения local action:', e);
    }
}

async function flushPendingActionsToCloud() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    if (pendingActionFlushPromise) {
        return pendingActionFlushPromise;
    }

    pendingActionFlushPromise = (async () => {
        try {
            const queue = getPendingCloudActions();
            if (!queue || queue.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') {
                return 0;
            }

            // Гарантируем строгий хронологический порядок отправки
            queue.sort((a, b) => (Number(a.ts || 0) - Number(b.ts || 0)) || (Number(a.seq || 0) - Number(b.seq || 0)));

            let flushedCount = 0;
            const remaining = [];
            let networkFailed = false;

            for (const item of queue) {
                if (networkFailed) {
                    remaining.push(item);
                    continue;
                }
                try {
                    const { error } = await window.supabaseClient
                        .from('commands_history')
                        .insert([{
                            raw_text: item.raw_text,
                            command: item.command,
                            parameters: item.parameters,
                            output: item.output,
                            result: item.result,
                            status: item.status,
                            created_at: item.created_at,
                            created_by: user.id
                        }]);

                    if (error) {
                        const msg = String(error.message || '').toLowerCase();
                        if (msg.includes('failed to fetch') || msg.includes('network')) {
                            networkFailed = true;
                            remaining.push(item);
                        } else {
                            console.warn('Supabase commands_history insert error:', error.message);
                            // Не зацикливаем невосстановимую ошибку схемы/валидации
                        }
                    } else {
                        flushedCount++;
                    }
                } catch (err) {
                    networkFailed = true;
                    remaining.push(item);
                }
            }

            // Объединяем с элементами, которые могли быть добавлены во время отправки
            const currentQueue = getPendingCloudActions();
            const processedIds = new Set(queue.map(q => q.id));
            const newlyAdded = currentQueue.filter(q => !processedIds.has(q.id));
            savePendingCloudActions([...remaining, ...newlyAdded]);

            return flushedCount;
        } catch (err) {
            console.warn('flushPendingActionsToCloud error:', err);
            return 0;
        } finally {
            pendingActionFlushPromise = null;
        }
    })();

    return pendingActionFlushPromise;
}

async function recordCommandAction(rawText, outputText = '', status = 'success', parameters = null) {
    if (!rawText) return;
    const cleanRaw = String(rawText).trim();
    const cmd = cleanRaw.split(/\s+/)[0] || '';
    const navKey = getCanonicalNavKey(cleanRaw);
    const nowMs = Date.now();

    // Предотвращаем дублирование одного и того же перехода (например, команда из консоли + автолог загрузки страницы)
    if (navKey) {
        const recent = getLocalActionsHistory();
        const duplicateNav = recent.slice(0, 10).find(item => {
            const itemNav = getCanonicalNavKey(item.raw_text || item.command);
            if (itemNav !== navKey) return false;
            const ts = item.created_at ? new Date(item.created_at).getTime() : 0;
            return Math.abs(nowMs - ts) <= 4000;
        });
        if (duplicateNav) return;
    }

    let user = currentUserCache || getCachedAuthUser();
    if (!user && window.supabaseClient && window.supabaseClient.auth) {
        try {
            const sessionRes = window.supabaseClient.auth.getSession();
            if (sessionRes && typeof sessionRes.then === 'function') {
                sessionRes.then(({ data }) => {
                    if (data && data.session && data.session.user) {
                        const u = {
                            id: data.session.user.id,
                            email: data.session.user.email,
                            isGuest: false
                        };
                        currentUserCache = u;
                        setCachedAuthUser(u);
                    }
                }).catch(() => {});
            }
        } catch (e) {}
    }

    const isGuest = !user || user.isGuest || user.id === 'guest';
    const userId = isGuest ? 'guest' : user.id;
    const createdAtIso = new Date(nowMs).toISOString();

    const actionItem = {
        id: 'act_' + nowMs + '_' + (++actionSeqCounter) + '_' + Math.random().toString(36).substr(2, 4),
        raw_text: cleanRaw,
        command: cmd,
        parameters: parameters || { raw_args: cleanRaw.slice(cmd.length).trim() },
        output: outputText || '',
        status: status || 'success',
        created_at: createdAtIso,
        created_by: userId
    };

    // 1. Всегда МГНОВЕННО и синхронно сохраняем в локальную историю
    saveLocalAction(actionItem);

    // 2. Если пользователь авторизован (или был авторизован до отключения интернета) — ставим в упорядоченную облачную очередь
    if (!isGuest && userId !== 'guest') {
        const queue = getPendingCloudActions();
        queue.push({
            id: actionItem.id,
            seq: actionSeqCounter,
            ts: nowMs,
            raw_text: cleanRaw,
            command: cmd,
            parameters: actionItem.parameters,
            output: outputText || '',
            result: `[${(status || 'SUCCESS').toUpperCase()}] ${outputText || ''}`,
            status: status || 'success',
            created_at: createdAtIso
        });
        savePendingCloudActions(queue);

        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
            flushPendingActionsToCloud().catch(() => {});
        }
    }
}

window.getCanonicalNavKey = getCanonicalNavKey;
window.recordCommandAction = recordCommandAction;
window.getLocalActionsHistory = getLocalActionsHistory;
window.flushPendingActionsToCloud = flushPendingActionsToCloud;

// =========================================================================
// Оффлайн-кэш и упорядоченная очередь синхронизации для заметок (Notes)
// =========================================================================
const NOTES_OPS_KEY = 'terminal_pending_notes_ops';
let notesSeqCounter = 0;
let notesFlushPromise = null;

function isOfflineNetworkError(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (!window.supabaseClient) return true;
    const msg = String(err && (err.message || err) || '').toLowerCase();
    return (
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('network request failed') ||
        msg.includes('load failed') ||
        msg.includes('fetch') ||
        msg.includes('offline')
    );
}

function getNotesCacheKey(userId) {
    return `terminal_notes_cache_${userId || 'guest'}`;
}

function getNotesCache(userId) {
    try {
        const raw = localStorage.getItem(getNotesCacheKey(userId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveNotesCache(userId, notes) {
    try {
        localStorage.setItem(getNotesCacheKey(userId), JSON.stringify(notes || []));
    } catch (e) {}
}

function getPendingNoteOps() {
    try {
        const raw = localStorage.getItem(NOTES_OPS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingNoteOps(ops) {
    try {
        localStorage.setItem(NOTES_OPS_KEY, JSON.stringify(ops || []));
    } catch (e) {}
}

function enqueueNoteOp(userId, type, payload) {
    const nowMs = Date.now();
    const ops = getPendingNoteOps();
    const op = {
        opId: 'noteop_' + nowMs + '_' + (++notesSeqCounter),
        seq: notesSeqCounter,
        ts: nowMs,
        userId: String(userId),
        type,
        payload
    };
    ops.push(op);
    savePendingNoteOps(ops);
    return op;
}

function queueAddNoteOffline(userId, content) {
    const list = getNotesCache(userId);
    const maxId = list.reduce((m, n) => Math.max(m, Number(n.inner_id) || 0), 0);
    const tempInnerId = maxId + 1;
    const nowIso = new Date().toISOString();
    const item = {
        inner_id: tempInnerId,
        _tempInnerId: tempInnerId,
        _pendingOffline: true,
        content: String(content),
        is_pinned: false,
        version: 1,
        created_at: nowIso,
        updated_at: null,
        deleted_at: null,
        created_by: userId
    };
    list.push(item);
    saveNotesCache(userId, list);
    enqueueNoteOp(userId, 'add_note', { tempInnerId, content: String(content), created_at: nowIso });
    return item;
}

function queueEditNoteOffline(userId, innerId, newContent) {
    const list = getNotesCache(userId);
    const target = list.find(n => Number(n.inner_id) === Number(innerId) && !n.deleted_at);
    if (!target) return null;
    target.content = newContent;
    target.version = (Number(target.version) || 1) + 1;
    target.updated_at = new Date().toISOString();
    saveNotesCache(userId, list);
    enqueueNoteOp(userId, 'edit_note', { innerId: Number(innerId), content: newContent, updated_at: target.updated_at });
    return target;
}

function queuePinNotesOffline(userId, ids, isPin) {
    const list = getNotesCache(userId);
    const matched = [];
    list.forEach(n => {
        if (ids.includes(Number(n.inner_id)) && !n.deleted_at) {
            n.is_pinned = Boolean(isPin);
            matched.push(Number(n.inner_id));
        }
    });
    if (matched.length === 0) return [];
    saveNotesCache(userId, list);
    enqueueNoteOp(userId, 'pin_note', { ids: matched, is_pinned: Boolean(isPin) });
    return matched;
}

function queueDeleteNotesOffline(userId, ids) {
    const list = getNotesCache(userId);
    const nowIso = new Date().toISOString();
    const matched = [];
    list.forEach(n => {
        if (ids.includes(Number(n.inner_id)) && !n.deleted_at) {
            n.deleted_at = nowIso;
            matched.push(Number(n.inner_id));
        }
    });
    if (matched.length === 0) return [];
    saveNotesCache(userId, list);
    enqueueNoteOp(userId, 'del_note', { ids: matched, deleted_at: nowIso });
    return matched;
}

function queueRestoreNotesOffline(userId, ids) {
    const list = getNotesCache(userId);
    const matched = [];
    list.forEach(n => {
        if (ids.includes(Number(n.inner_id)) && n.deleted_at) {
            n.deleted_at = null;
            matched.push(Number(n.inner_id));
        }
    });
    if (matched.length === 0) return [];
    saveNotesCache(userId, list);
    enqueueNoteOp(userId, 'restore_note', { ids: matched });
    return matched;
}

async function flushPendingNotes() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    if (notesFlushPromise) return notesFlushPromise;

    notesFlushPromise = (async () => {
        try {
            const ops = getPendingNoteOps();
            if (!ops || ops.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') return 0;

            ops.sort((a, b) => (Number(a.ts || 0) - Number(b.ts || 0)) || (Number(a.seq || 0) - Number(b.seq || 0)));

            const tempIdMap = new Map();
            const resolveId = (id) => tempIdMap.has(Number(id)) ? tempIdMap.get(Number(id)) : Number(id);

            let flushedCount = 0;
            const remaining = [];
            let networkFailed = false;

            for (const op of ops) {
                if (networkFailed) {
                    remaining.push(op);
                    continue;
                }
                const p = op.payload || {};
                try {
                    if (op.type === 'add_note') {
                        const { data, error } = await window.supabaseClient
                            .from('notes')
                            .insert([{ content: p.content, created_by: user.id, created_at: p.created_at }])
                            .select('inner_id');
                        if (error) throw error;
                        if (data && data[0] && data[0].inner_id && p.tempInnerId) {
                            tempIdMap.set(Number(p.tempInnerId), Number(data[0].inner_id));
                        }
                        flushedCount++;
                    } else if (op.type === 'edit_note') {
                        const targetInnerId = resolveId(p.innerId);
                        const { data: items, error: fetchErr } = await window.supabaseClient
                            .from('notes')
                            .select('*')
                            .eq('inner_id', targetInnerId)
                            .eq('created_by', user.id)
                            .is('deleted_at', null)
                            .order('version', { ascending: false })
                            .limit(1);
                        if (fetchErr) throw fetchErr;
                        if (items && items[0]) {
                            const latest = items[0];
                            const { error: insErr } = await window.supabaseClient
                                .from('notes')
                                .insert([{
                                    inner_id: latest.inner_id,
                                    version: (latest.version || 1) + 1,
                                    created_by: latest.created_by,
                                    created_at: latest.created_at,
                                    content: p.content,
                                    is_pinned: latest.is_pinned,
                                    updated_by: user.id
                                }]);
                            if (insErr) throw insErr;
                        }
                        flushedCount++;
                    } else if (op.type === 'pin_note') {
                        const mappedIds = (p.ids || []).map(resolveId);
                        const { error } = await window.supabaseClient
                            .from('notes')
                            .update({ is_pinned: Boolean(p.is_pinned) })
                            .in('inner_id', mappedIds)
                            .eq('created_by', user.id)
                            .is('deleted_at', null);
                        if (error) throw error;
                        flushedCount++;
                    } else if (op.type === 'del_note') {
                        const mappedIds = (p.ids || []).map(resolveId);
                        const { error } = await window.supabaseClient
                            .from('notes')
                            .update({ deleted_at: p.deleted_at || new Date().toISOString() })
                            .in('inner_id', mappedIds)
                            .eq('created_by', user.id);
                        if (error) throw error;
                        flushedCount++;
                    } else if (op.type === 'restore_note') {
                        const mappedIds = (p.ids || []).map(resolveId);
                        const { error } = await window.supabaseClient
                            .from('notes')
                            .update({ deleted_at: null })
                            .in('inner_id', mappedIds)
                            .eq('created_by', user.id);
                        if (error) throw error;
                        flushedCount++;
                    }
                } catch (err) {
                    if (isOfflineNetworkError(err)) {
                        networkFailed = true;
                        remaining.push(op);
                    } else {
                        console.warn('Offline note replay error:', err);
                    }
                }
            }

            const currentOps = getPendingNoteOps();
            const processedIds = new Set(ops.map(o => o.opId));
            const newlyAdded = currentOps.filter(o => !processedIds.has(o.opId));
            savePendingNoteOps([...remaining, ...newlyAdded]);

            return flushedCount;
        } catch (err) {
            console.warn('flushPendingNotes error:', err);
            return 0;
        } finally {
            notesFlushPromise = null;
        }
    })();

    return notesFlushPromise;
}

window.OfflineNotesSync = {
    isOfflineError: isOfflineNetworkError,
    getNotesCache,
    saveNotesCache,
    getPendingNoteOps,
    queueAddNoteOffline,
    queueEditNoteOffline,
    queuePinNotesOffline,
    queueDeleteNotesOffline,
    queueRestoreNotesOffline,
    flushPendingNotes
};

// =========================================================================
// Синхронизация расположения объектов в House (единый 16×16 дом и legacy комнаты) с БД
// =========================================================================
const HOUSE_PENDING_LAYOUTS_LEGACY_KEY = 'terminal_pending_house_layouts';
const HOUSE_BOUND_REGISTRY_KEY_PREFIX = 'terminal_user_houses_v1';
const HOUSE_TABLES_MISSING_COOLDOWN_MS = 30000;
let houseLayoutsFlushPromise = null;
let houseLayoutsTableMissingUntil = 0;
let userHousesTableMissingUntil = 0;

try {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('terminal_house_layouts_missing_v1');
    }
} catch (e) {}

function isHouseLayoutsTableMissing() {
    return Date.now() < houseLayoutsTableMissingUntil;
}

function markHouseLayoutsTableMissing() {
    houseLayoutsTableMissingUntil = Date.now() + HOUSE_TABLES_MISSING_COOLDOWN_MS;
}

function clearHouseLayoutsTableMissing() {
    houseLayoutsTableMissingUntil = 0;
}

function isUserHousesTableMissing() {
    return Date.now() < userHousesTableMissingUntil;
}

function markUserHousesTableMissing() {
    userHousesTableMissingUntil = Date.now() + HOUSE_TABLES_MISSING_COOLDOWN_MS;
}

function clearUserHousesTableMissing() {
    userHousesTableMissingUntil = 0;
}

function getHousesDatabaseSetupSql() {
    return [
        "create table if not exists public.user_houses (user_id text primary key, user_email text, houses jsonb not null default '[]'::jsonb, ts bigint not null default 0, updated_at timestamptz not null default now());",
        "create table if not exists public.house_layouts (id text primary key, user_id text not null, user_email text, room text not null, layout jsonb not null default '{}'::jsonb, ts bigint not null default 0, updated_at timestamptz not null default now());",
        "alter table public.user_houses add column if not exists user_email text;",
        "alter table public.user_houses add column if not exists ts bigint not null default 0;",
        "alter table public.house_layouts add column if not exists user_email text;",
        "alter table public.house_layouts add column if not exists ts bigint not null default 0;",
        "create index if not exists idx_house_layouts_user_id on public.house_layouts (user_id);",
        "create index if not exists idx_house_layouts_user_room on public.house_layouts (user_id, room);",
        "grant usage on schema public to authenticated, service_role;",
        "grant all on table public.user_houses to authenticated, service_role;",
        "grant all on table public.house_layouts to authenticated, service_role;",
        "alter table public.user_houses enable row level security;",
        "alter table public.house_layouts enable row level security;",
        "drop policy if exists \"Users manage own houses\" on public.user_houses;",
        "create policy \"Users manage own houses\" on public.user_houses for all to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);",
        "drop policy if exists \"Users manage own house layouts\" on public.house_layouts;",
        "create policy \"Users manage own house layouts\" on public.house_layouts for all to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);"
    ].join('\n');
}

function getPendingHouseLayoutsStorageKey(userId) {
    const uid = String(userId || '').trim();
    if (!uid || uid === 'guest') return null;
    return `terminal_pending_house_layouts_${uid}`;
}

function resolveUserSyncIdHint(userIdOverride = null) {
    if (typeof userIdOverride === 'string' && userIdOverride.trim() && userIdOverride !== 'guest') {
        return userIdOverride.trim();
    }
    if (userIdOverride && typeof userIdOverride === 'object' && userIdOverride.id && userIdOverride.id !== 'guest') {
        return String(userIdOverride.id);
    }
    if (currentUserCache && !currentUserCache.isGuest && currentUserCache.id && currentUserCache.id !== 'guest') {
        return String(currentUserCache.id);
    }
    const cached = getCachedAuthUser();
    if (cached && cached.id && cached.id !== 'guest') {
        return String(cached.id);
    }
    return null;
}

function migrateLegacyPendingHouseLayoutsForRoot(user) {
    if (!isRootUser(user)) return;
    try {
        const legacyRaw = localStorage.getItem(HOUSE_PENDING_LAYOUTS_LEGACY_KEY);
        if (!legacyRaw) return;
        const legacyParsed = JSON.parse(legacyRaw);
        const targetKey = getPendingHouseLayoutsStorageKey(user.id);
        if (targetKey && legacyParsed && typeof legacyParsed === 'object' && !Array.isArray(legacyParsed)) {
            let currentMap = {};
            try {
                const existingRaw = localStorage.getItem(targetKey);
                if (existingRaw) currentMap = JSON.parse(existingRaw) || {};
            } catch (e) {}
            const merged = { ...legacyParsed, ...currentMap };
            localStorage.setItem(targetKey, JSON.stringify(merged));
        }
        localStorage.removeItem(HOUSE_PENDING_LAYOUTS_LEGACY_KEY);
    } catch (e) {}
}

function getPendingHouseLayouts(userIdOverride = null) {
    try {
        const uid = resolveUserSyncIdHint(userIdOverride);
        const key = getPendingHouseLayoutsStorageKey(uid);
        if (!key) return {};
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function savePendingHouseLayouts(map, userIdOverride = null) {
    try {
        const uid = resolveUserSyncIdHint(userIdOverride);
        const key = getPendingHouseLayoutsStorageKey(uid);
        if (!key) return;
        localStorage.setItem(key, JSON.stringify(map || {}));
    } catch (e) {}
}

function syncUserHouseRegistryLocal(user) {
    try {
        if (!user || user.isGuest || !user.id || user.id === 'guest') return [];
        const bound = getUserBoundHouses(user);
        localStorage.setItem(`${HOUSE_BOUND_REGISTRY_KEY_PREFIX}::${user.id}`, JSON.stringify({
            ownerId: user.id,
            ownerEmail: user.email || '',
            ownerRole: user.role || 'user',
            houses: bound,
            updatedAt: new Date().toISOString()
        }));
        return bound;
    } catch (e) {
        return [];
    }
}

function isMissingTableError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || '').toLowerCase();
    return (
        code === 'PGRST205' ||
        code === '42P01' ||
        err.status === 404 ||
        msg.includes('could not find the table') ||
        msg.includes('does not exist')
    );
}

async function resolveAuthenticatedDbUser() {
    if (window.supabaseClient && window.supabaseClient.auth) {
        try {
            const { data } = await window.supabaseClient.auth.getSession();
            if (data && data.session && data.session.user && data.session.user.id) {
                if (data.session.access_token) {
                    cachedSupabaseAccessToken = data.session.access_token;
                }
                const authUser = data.session.user;
                const emailLower = String(authUser.email || '').toLowerCase().trim();
                const cached = getCachedAuthUser();
                const fallbackRole = ROOT_OWNER_EMAILS.includes(emailLower) ? 'root' : 'user';
                const cachedRole = (cached && cached.id === authUser.id && cached.role) ? cached.role : null;
                const currentRole = (currentUserCache && currentUserCache.id === authUser.id && currentUserCache.role) ? currentUserCache.role : null;
                return {
                    id: authUser.id,
                    email: authUser.email || '',
                    role: currentRole || cachedRole || fallbackRole,
                    isGuest: false
                };
            }
        } catch (e) {}
    }
    const user = await fetchCurrentUser(true);
    if (user && !user.isGuest && user.id && user.id !== 'guest') {
        return user;
    }
    return null;
}

function getHouseLayoutRowIdCacheKey(userId, room) {
    return `terminal_house_layout_rowid::${userId}::${room}`;
}

function isMissingColumnError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || '').toLowerCase();
    return code === 'PGRST204' || code === '42703' || msg.includes('could not find the') && msg.includes('column');
}

function flushPendingHouseLayoutsKeepalive(userOverride = null) {
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const uid = resolveUserSyncIdHint(userOverride);
        if (!uid || uid === 'guest') return;
        const pendingMap = getPendingHouseLayouts(uid);
        const rooms = Object.keys(pendingMap);
        if (rooms.length === 0) return;

        const apiUrl = window.SUPABASE_URL;
        const apiKey = window.SUPABASE_ANON_KEY;
        const bearer = cachedSupabaseAccessToken || apiKey;
        if (!apiUrl || !apiKey) return;

        if (!isHouseLayoutsTableMissing()) {
            rooms.forEach(room => {
                const entry = pendingMap[room];
                if (!entry || !entry.layout) return;
                const updatedAt = entry.updatedAt || new Date(entry.ts || Date.now()).toISOString();
                const body = JSON.stringify([{
                    id: `${uid}_${room}`,
                    user_id: uid,
                    room,
                    layout: entry.layout,
                    updated_at: updatedAt
                }]);
                if (body.length < 60000) {
                    fetch(`${apiUrl}/rest/v1/house_layouts?on_conflict=id`, {
                        method: 'POST',
                        keepalive: true,
                        headers: {
                            'apikey': apiKey,
                            'Authorization': `Bearer ${bearer}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates,return=minimal'
                        },
                        body
                    }).catch(() => {});
                }
            });
            return;
        }

        rooms.forEach(room => {
            const entry = pendingMap[room];
            if (!entry || !entry.layout) return;
            const updatedAt = entry.updatedAt || new Date(entry.ts || Date.now()).toISOString();
            const markerRawText = `__house_layout__:${room}`;
            const payloadParams = {
                room,
                layout: entry.layout,
                user_id: uid,
                owner_email: entry.owner_email || '',
                bound_role: entry.bound_role || 'user',
                ts: Number(entry.ts || Date.now()),
                updated_at: updatedAt
            };
            const cachedRowId = localStorage.getItem(getHouseLayoutRowIdCacheKey(uid, room));
            const headers = {
                'apikey': apiKey,
                'Authorization': `Bearer ${bearer}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            };
            if (cachedRowId) {
                const body = JSON.stringify({ parameters: payloadParams, created_at: updatedAt });
                if (body.length < 60000) {
                    fetch(`${apiUrl}/rest/v1/commands_history?id=eq.${encodeURIComponent(cachedRowId)}`, {
                        method: 'PATCH',
                        keepalive: true,
                        headers,
                        body
                    }).catch(() => {});
                }
            } else {
                const body = JSON.stringify([{
                    raw_text: markerRawText,
                    command: '__house_layout__',
                    parameters: payloadParams,
                    output: 'house_layout',
                    result: 'OK',
                    status: 'success',
                    created_at: updatedAt,
                    created_by: uid
                }]);
                if (body.length < 60000) {
                    fetch(`${apiUrl}/rest/v1/commands_history`, {
                        method: 'POST',
                        keepalive: true,
                        headers,
                        body
                    }).catch(() => {});
                }
            }
        });
    } catch (e) {}
}

async function upsertHouseLayoutRow(user, room, layout, entryTs, updatedAt) {
    const richRow = {
        id: `${user.id}_${room}`,
        user_id: user.id,
        user_email: user.email || '',
        room,
        layout,
        ts: entryTs,
        updated_at: updatedAt
    };
    let { error } = await window.supabaseClient
        .from('house_layouts')
        .upsert([richRow], { onConflict: 'id' });

    if (error && isMissingColumnError(error)) {
        const coreRow = {
            id: `${user.id}_${room}`,
            user_id: user.id,
            room,
            layout,
            updated_at: updatedAt
        };
        const retry = await window.supabaseClient
            .from('house_layouts')
            .upsert([coreRow], { onConflict: 'id' });
        error = retry.error;
    }
    return error || null;
}

async function flushPendingHouseLayouts() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    if (houseLayoutsFlushPromise) return houseLayoutsFlushPromise;

    houseLayoutsFlushPromise = (async () => {
        try {
            const user = await resolveAuthenticatedDbUser();
            if (!user) return 0;
            migrateLegacyPendingHouseLayoutsForRoot(user);
            syncUserHouseRegistryLocal(user);

            const pendingMap = getPendingHouseLayouts(user.id);
            const rooms = Object.keys(pendingMap);
            if (rooms.length === 0) return 0;

            let syncedCount = 0;

            for (const room of rooms) {
                const entry = pendingMap[room];
                if (!entry || !entry.layout) continue;

                const entryTs = Number(entry.ts || (entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0) || Date.now());
                const updatedAt = entry.updatedAt || new Date(entryTs).toISOString();
                let savedOk = false;

                if (!isHouseLayoutsTableMissing()) {
                    try {
                        const error = await upsertHouseLayoutRow(user, room, entry.layout, entryTs, updatedAt);
                        if (!error) {
                            clearHouseLayoutsTableMissing();
                            savedOk = true;
                        } else if (isMissingTableError(error)) {
                            markHouseLayoutsTableMissing();
                        } else if (isOfflineNetworkError(error)) {
                            throw error;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) throw e;
                    }
                }

                if (!savedOk) {
                    const markerRawText = `__house_layout__:${room}`;
                    const payloadParams = {
                        room,
                        layout: entry.layout,
                        user_id: user.id,
                        owner_email: user.email || '',
                        bound_role: user.role || 'user',
                        ts: entryTs,
                        updated_at: updatedAt
                    };

                    const { data: existingRows, error: selErr } = await window.supabaseClient
                        .from('commands_history')
                        .select('id')
                        .eq('created_by', user.id)
                        .eq('command', '__house_layout__')
                        .eq('raw_text', markerRawText)
                        .is('deleted_at', null)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (selErr && isOfflineNetworkError(selErr)) {
                        throw selErr;
                    }

                    let updatedInPlace = false;
                    if (!selErr && existingRows && existingRows[0] && existingRows[0].id) {
                        try {
                            localStorage.setItem(getHouseLayoutRowIdCacheKey(user.id, room), String(existingRows[0].id));
                        } catch (e) {}
                        const { data: updData, error: updErr } = await window.supabaseClient
                            .from('commands_history')
                            .update({
                                parameters: payloadParams,
                                created_at: updatedAt
                            })
                            .eq('id', existingRows[0].id)
                            .select('id');

                        if (!updErr && updData && updData.length > 0) {
                            updatedInPlace = true;
                            savedOk = true;
                        } else if (updErr && isOfflineNetworkError(updErr)) {
                            throw updErr;
                        }
                    }

                    if (!updatedInPlace) {
                        const { data: insData, error: insErr } = await window.supabaseClient
                            .from('commands_history')
                            .insert([{
                                raw_text: markerRawText,
                                command: '__house_layout__',
                                parameters: payloadParams,
                                output: 'house_layout',
                                result: 'OK',
                                status: 'success',
                                created_at: updatedAt,
                                created_by: user.id
                            }])
                            .select('id');

                        if (insErr) {
                            if (isOfflineNetworkError(insErr)) throw insErr;
                            console.warn('House layout DB save error:', insErr.message);
                        } else {
                            if (insData && insData[0] && insData[0].id) {
                                try {
                                    localStorage.setItem(getHouseLayoutRowIdCacheKey(user.id, room), String(insData[0].id));
                                } catch (e) {}
                            }
                            savedOk = true;
                        }
                    }
                }

                if (savedOk) {
                    const latestPending = getPendingHouseLayouts(user.id);
                    if (latestPending[room] && Number(latestPending[room].ts || 0) <= Number(entry.ts || 0)) {
                        delete latestPending[room];
                        savePendingHouseLayouts(latestPending, user.id);
                    }
                    syncedCount++;
                }
            }

            return syncedCount;
        } catch (err) {
            if (!isOfflineNetworkError(err)) {
                console.warn('flushPendingHouseLayouts error:', err);
            }
            return 0;
        } finally {
            houseLayoutsFlushPromise = null;
        }
    })();

    return houseLayoutsFlushPromise;
}

async function fetchAllHouseLayoutsFromDb(roomIds = []) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return {};
    if (!window.supabaseClient) return {};

    const resultMap = {};
    const tableMap = {};
    let houseLayoutsTableReady = false;

    try {
        const user = await resolveAuthenticatedDbUser();
        if (!user) return {};

        const cleanRoomIds = Array.isArray(roomIds) ? roomIds.map(String).filter(Boolean) : [];

        if (!isHouseLayoutsTableMissing() && cleanRoomIds.length > 0) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('house_layouts')
                    .select('*')
                    .eq('user_id', user.id)
                    .in('room', cleanRoomIds);

                if (!error && Array.isArray(data)) {
                    clearHouseLayoutsTableMissing();
                    houseLayoutsTableReady = true;
                    data.forEach(row => {
                        if (row && row.room && row.layout) {
                            const ts = Number(row.ts) || (row.updated_at ? new Date(row.updated_at).getTime() : 0);
                            const prev = resultMap[row.room];
                            const prevTs = prev ? (Number(prev.ts) || (prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0)) : 0;
                            if (!prev || ts >= prevTs) {
                                const entry = { layout: row.layout, updatedAt: row.updated_at || null, ts };
                                resultMap[row.room] = entry;
                                tableMap[row.room] = entry;
                            }
                        }
                    });
                } else if (error && isMissingTableError(error)) {
                    markHouseLayoutsTableMissing();
                }
            } catch (e) {}
        }

        let query = window.supabaseClient
            .from('commands_history')
            .select('id, raw_text, parameters, created_at')
            .eq('created_by', user.id)
            .eq('command', '__house_layout__')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(100);

        if (cleanRoomIds.length > 0) {
            query = query.in('raw_text', cleanRoomIds.map(r => `__house_layout__:${r}`));
        }

        const { data: rows, error: histErr } = await query;
        if (!histErr && Array.isArray(rows)) {
            rows.forEach(row => {
                const p = row && row.parameters;
                const roomName = (p && p.room) || (row.raw_text ? String(row.raw_text).replace(/^__house_layout__:/, '') : '');
                if (!roomName || !p || !p.layout) return;
                if (row.id) {
                    try {
                        localStorage.setItem(getHouseLayoutRowIdCacheKey(user.id, roomName), String(row.id));
                    } catch (e) {}
                }
                const updatedAt = p.updated_at || row.created_at || null;
                const ts = Number(p.ts) || (updatedAt ? new Date(updatedAt).getTime() : 0);
                const prev = resultMap[roomName];
                const prevTs = prev ? (Number(prev.ts) || (prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0)) : 0;
                if (!prev || ts >= prevTs) {
                    resultMap[roomName] = { layout: p.layout, updatedAt, ts };
                }
            });
        }

        // Если таблица house_layouts существует, автоматически переносим в неё расклады из legacy commands_history
        if (houseLayoutsTableReady) {
            for (const roomName of Object.keys(resultMap)) {
                const chosen = resultMap[roomName];
                const inTable = tableMap[roomName];
                if (chosen && chosen.layout && (!inTable || Number(chosen.ts || 0) > Number(inTable.ts || 0))) {
                    const chosenTs = Number(chosen.ts || Date.now());
                    const updatedAt = chosen.updatedAt || new Date(chosenTs).toISOString();
                    upsertHouseLayoutRow(user, roomName, chosen.layout, chosenTs, updatedAt).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.warn('fetchAllHouseLayoutsFromDb error:', e);
    }
    return resultMap;
}

async function fetchRoomLayoutFromDb(room) {
    if (!room) return null;
    const map = await fetchAllHouseLayoutsFromDb([room]);
    return map[room] || null;
}

function saveAndSyncHouseLayout(room, layoutObj, userOverride = null, customTs = null) {
    if (!room || !layoutObj) return Promise.resolve(0);
    const uid = resolveUserSyncIdHint(userOverride);
    if (!uid || uid === 'guest') return Promise.resolve(0);
    const nowMs = customTs ? Number(customTs) : Date.now();
    const updatedAt = new Date(nowMs).toISOString();
    const pendingMap = getPendingHouseLayouts(uid);
    pendingMap[room] = {
        room,
        layout: layoutObj,
        user_id: uid,
        updatedAt,
        ts: nowMs
    };
    savePendingHouseLayouts(pendingMap, uid);

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        return flushPendingHouseLayouts().catch(() => 0);
    }
    return Promise.resolve(0);
}

window.HouseLayoutSync = {
    getPendingHouseLayouts,
    saveAndSyncHouseLayout,
    flushPendingHouseLayouts,
    flushPendingHouseLayoutsKeepalive,
    fetchRoomLayoutFromDb,
    fetchAllHouseLayoutsFromDb,
    syncUserHouseRegistryLocal,
    migrateLegacyPendingHouseLayoutsForRoot,
    isHouseLayoutsTableMissing,
    getSetupSql: getHousesDatabaseSetupSql
};

// =========================================================================
// Аккаунт-зависимые Дома, Комнаты и Предметы (Add house / Add room / Add thing)
// =========================================================================
const THING_CATALOG_PRESETS = {
    table: { type: 'table', label: 'Стол', w: 2, h: 1, defaultColor: 'brown' },
    desk: { type: 'desk', label: 'Столик', w: 2, h: 1, defaultColor: 'brown' },
    стол: { type: 'table', label: 'Стол', w: 2, h: 1, defaultColor: 'brown' },
    стіл: { type: 'table', label: 'Стол', w: 2, h: 1, defaultColor: 'brown' },
    столик: { type: 'desk', label: 'Столик', w: 2, h: 1, defaultColor: 'brown' },
    stove: { type: 'stove', label: 'Плита', w: 2, h: 2 },
    oven: { type: 'stove', label: 'Печь', w: 2, h: 2 },
    печь: { type: 'stove', label: 'Печь', w: 2, h: 2 },
    плита: { type: 'stove', label: 'Плита', w: 2, h: 2 },
    піч: { type: 'stove', label: 'Печь', w: 2, h: 2 },
    fridge: { type: 'fridge', label: 'Холодильник', w: 2, h: 2 },
    refrigerator: { type: 'fridge', label: 'Холодильник', w: 2, h: 2 },
    холодильник: { type: 'fridge', label: 'Холодильник', w: 2, h: 2 },
    washer: { type: 'washer', label: 'Стиральная машина', w: 2, h: 2 },
    washing_machine: { type: 'washer', label: 'Стиральная машина', w: 2, h: 2 },
    стиралка: { type: 'washer', label: 'Стиральная машина', w: 2, h: 2 },
    boiler: { type: 'boiler', label: 'Бойлер', w: 2, h: 2 },
    бойлер: { type: 'boiler', label: 'Бойлер', w: 2, h: 2 },
    multicooker: { type: 'multicooker', label: 'Мультиварка', w: 1, h: 1 },
    мультиварка: { type: 'multicooker', label: 'Мультиварка', w: 1, h: 1 },
    sofa: { type: 'sofa', label: 'Диван', w: 4, h: 2 },
    couch: { type: 'sofa', label: 'Диван', w: 4, h: 2 },
    диван: { type: 'sofa', label: 'Диван', w: 4, h: 2 },
    armchair: { type: 'armchair', label: 'Кресло', w: 2, h: 2 },
    chair: { type: 'armchair', label: 'Кресло', w: 2, h: 2 },
    кресло: { type: 'armchair', label: 'Кресло', w: 2, h: 2 },
    крісло: { type: 'armchair', label: 'Кресло', w: 2, h: 2 },
    bed: { type: 'bed', label: 'Кровать', w: 2, h: 2 },
    кровать: { type: 'bed', label: 'Кровать', w: 2, h: 2 },
    ліжко: { type: 'bed', label: 'Кровать', w: 2, h: 2 },
    closet: { type: 'closet', label: 'Шкаф', w: 2, h: 2 },
    wardrobe: { type: 'closet', label: 'Шкаф', w: 2, h: 2 },
    cabinet: { type: 'closet', label: 'Шкаф', w: 2, h: 2 },
    шкаф: { type: 'closet', label: 'Шкаф', w: 2, h: 2 },
    шафа: { type: 'closet', label: 'Шкаф', w: 2, h: 2 },
    tv: { type: 'tv', label: 'Телевизор', w: 2, h: 2 },
    television: { type: 'tv', label: 'Телевизор', w: 2, h: 2 },
    телевизор: { type: 'tv', label: 'Телевизор', w: 2, h: 2 },
    тв: { type: 'tv', label: 'Телевизор', w: 2, h: 2 },
    laptop: { type: 'laptop', label: 'Ноутбук', w: 1, h: 1 },
    ноутбук: { type: 'laptop', label: 'Ноутбук', w: 1, h: 1 },
    pc: { type: 'laptop', label: 'Ноутбук', w: 1, h: 1 },
    computer: { type: 'laptop', label: 'Компьютер', w: 1, h: 1 },
    router: { type: 'router', label: 'Роутер', w: 1, h: 1 },
    роутер: { type: 'router', label: 'Роутер', w: 1, h: 1 },
    radiator: { type: 'radiator', label: 'Батарея', w: 2, h: 1 },
    батарея: { type: 'radiator', label: 'Батарея', w: 2, h: 1 },
    window: { type: 'window', label: 'Окно', w: 1, h: 2 },
    окно: { type: 'window', label: 'Окно', w: 1, h: 2 },
    вікно: { type: 'window', label: 'Окно', w: 1, h: 2 },
    conditioner: { type: 'conditioner', label: 'Кондиционер', w: 2, h: 1 },
    ac: { type: 'conditioner', label: 'Кондиционер', w: 2, h: 1 },
    кондиционер: { type: 'conditioner', label: 'Кондиционер', w: 2, h: 1 }
};

const THING_COLOR_ALIASES = {
    brown: 'brown', oak: 'brown', wood: 'brown', wooden: 'brown', коричневый: 'brown', коричневая: 'brown', коричневое: 'brown', коричневого: 'brown', дуб: 'brown', дубовый: 'brown', деревянный: 'brown',
    green: 'green', emerald: 'green', зеленый: 'green', зелёный: 'green', зеленая: 'green', зелёная: 'green', зеленого: 'green', зелёного: 'green', зелений: 'green',
    blue: 'blue', cyan: 'blue', sky: 'blue', синий: 'blue', синяя: 'blue', голубой: 'blue', голубая: 'blue', синій: 'blue', блакитний: 'blue',
    red: 'red', crimson: 'red', красный: 'red', красная: 'red', красное: 'red', червоний: 'red', бордовый: 'red',
    yellow: 'yellow', gold: 'yellow', amber: 'yellow', желтый: 'yellow', жёлтый: 'yellow', желтая: 'yellow', жёлтая: 'yellow', жовтий: 'yellow', золотой: 'yellow',
    white: 'white', light: 'white', белый: 'white', белая: 'white', белое: 'white', білий: 'white', светлый: 'white',
    gray: 'gray', grey: 'gray', silver: 'gray', серый: 'gray', серая: 'gray', серое: 'gray', сірий: 'gray',
    black: 'black', dark: 'black', charcoal: 'black', черный: 'black', чёрный: 'black', черная: 'black', чёрная: 'black', чорний: 'black', тёмный: 'black', темный: 'black',
    orange: 'orange', оранжевый: 'orange', оранжевая: 'orange', помаранчевий: 'orange',
    purple: 'purple', violet: 'purple', фиолетовый: 'purple', фиолетовая: 'purple', фіолетовий: 'purple'
};

const THING_SHAPE_ALIASES = {
    rect: 'rect', rectangle: 'rect', standard: 'rect', normal: 'rect', прямоугольный: 'rect', прямоугольная: 'rect', прямоугольник: 'rect', обычный: 'rect', стандартный: 'rect', прямокутний: 'rect',
    corner: 'corner', lshape: 'corner', 'l-shape': 'corner', gshape: 'corner', угловой: 'corner', угловая: 'corner', кутовий: 'corner', уголок: 'corner',
    round: 'round', circle: 'round', oval: 'round', круглый: 'round', круглая: 'round', круглое: 'round', круг: 'round', округлый: 'round', круглий: 'round'
};

function parseThingColorInput(rawColor) {
    const clean = String(rawColor || '').trim().toLowerCase();
    if (!clean) return null;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean)) {
        if (clean.length === 4) {
            return '#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
        }
        return clean;
    }
    if (THING_COLOR_ALIASES[clean]) return THING_COLOR_ALIASES[clean];
    const tokens = clean.split(/[\s,;]+/).filter(Boolean);
    for (const tok of tokens) {
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(tok)) {
            return tok.length === 4 ? ('#' + tok[1] + tok[1] + tok[2] + tok[2] + tok[3] + tok[3]) : tok;
        }
        if (THING_COLOR_ALIASES[tok]) return THING_COLOR_ALIASES[tok];
    }
    return null;
}

function parseThingShapeInput(rawShape) {
    const clean = String(rawShape || '').trim().toLowerCase();
    if (!clean) return null;
    const tokens = clean.split(/[\s,;]+/).filter(Boolean);
    let shape = null;
    let w = null;
    let h = null;

    for (const tok of tokens) {
        const sizeMatch = tok.match(/^([1-8])\s*[*xх×]\s*([1-8])$/i);
        if (sizeMatch) {
            w = Math.max(1, Math.min(8, parseInt(sizeMatch[1], 10)));
            h = Math.max(1, Math.min(8, parseInt(sizeMatch[2], 10)));
            continue;
        }
        if (THING_SHAPE_ALIASES[tok]) {
            shape = THING_SHAPE_ALIASES[tok];
            continue;
        }
        if (tok === 'square' || tok === 'квадрат' || tok === 'квадратный' || tok === 'квадратная') {
            shape = 'rect';
            if (w === null && h === null) { w = 2; h = 2; }
            continue;
        }
        if (tok === 'small' || tok === 'mini' || tok === 'маленький' || tok === 'мини') {
            if (w === null && h === null) { w = 1; h = 1; }
            continue;
        }
    }

    if (!shape && w === null && h === null) {
        const fullMatch = clean.match(/^([1-8])\s*[*xх×]\s*([1-8])$/i);
        if (fullMatch) {
            w = parseInt(fullMatch[1], 10);
            h = parseInt(fullMatch[2], 10);
        } else {
            return null;
        }
    }
    return {
        shape: shape || (w !== null ? 'rect' : null),
        w,
        h
    };
}

function inferBuiltinThingType(itemId) {
    const id = String(itemId || '').toLowerCase();
    if (id.includes('table') || id.includes('desk')) return 'table';
    if (id.includes('washer')) return 'washer';
    if (id.includes('stove')) return 'stove';
    if (id.includes('fridge')) return 'fridge';
    if (id.includes('boiler')) return 'boiler';
    if (id.includes('multicooker')) return 'multicooker';
    if (id.includes('armchair')) return 'armchair';
    if (id.includes('sofa')) return 'sofa';
    if (id.includes('bed')) return 'bed';
    if (id.includes('closet')) return 'closet';
    if (id.includes('tv')) return 'tv';
    if (id.includes('laptop')) return 'laptop';
    if (id.includes('router')) return 'router';
    if (id.includes('radiator')) return 'radiator';
    if (id.includes('window')) return 'window';
    if (id.includes('conditioner')) return 'conditioner';
    return 'custom';
}

function getThingPreset(rawThingName) {
    const clean = String(rawThingName || '').trim();
    const rawTokens = clean.split(/\s+/).filter(Boolean);
    let parsedColor = null;
    let parsedShape = null;
    let parsedW = null;
    let parsedH = null;
    const baseTokens = [];

    rawTokens.forEach(tok => {
        const lower = tok.toLowerCase();
        const c = (!parsedColor) ? parseThingColorInput(lower) : null;
        if (c) {
            parsedColor = c;
            return;
        }
        const s = parseThingShapeInput(lower);
        if (s) {
            if (s.shape && !parsedShape) parsedShape = s.shape;
            if (s.w !== null && s.h !== null && parsedW === null) {
                parsedW = s.w;
                parsedH = s.h;
            }
            return;
        }
        baseTokens.push(tok);
    });

    const basePhrase = baseTokens.join(' ').trim();
    const fullKey = clean.toLowerCase().replace(/\s+/g, '_');
    const baseKey = basePhrase.toLowerCase().replace(/\s+/g, '_');
    const exact = THING_CATALOG_PRESETS[fullKey] ||
        THING_CATALOG_PRESETS[clean.toLowerCase()] ||
        THING_CATALOG_PRESETS[baseKey] ||
        THING_CATALOG_PRESETS[basePhrase.toLowerCase()];

    const resolvedType = exact ? exact.type : 'custom';
    const resolvedLabel = exact ? exact.label : (basePhrase || clean);
    let resolvedW = parsedW !== null ? parsedW : (exact ? exact.w : 2);
    let resolvedH = parsedH !== null ? parsedH : (exact ? exact.h : 2);
    if ((parsedShape === 'corner' || parsedShape === 'round') && parsedW === null && (resolvedType === 'table' || resolvedType === 'desk')) {
        resolvedW = 2;
        resolvedH = 2;
    }
    const resolvedColor = parsedColor || (exact && exact.defaultColor) || null;
    const resolvedShape = parsedShape || 'rect';

    return {
        type: resolvedType,
        label: resolvedLabel,
        displayName: clean,
        w: resolvedW,
        h: resolvedH,
        color: resolvedColor,
        shape: resolvedShape
    };
}

function getRoomsForHouseGridGeometry(houseRecord) {
    const rooms = Array.isArray(houseRecord && houseRecord.rooms) ? houseRecord.rooms : [];
    const total = rooms.length;
    if (total === 0) return { colsPerSide: 1, rowsPerSide: 1, gridW: 16, gridH: 16 };
    if (total <= 4) return { colsPerSide: 2, rowsPerSide: 2, gridW: 16, gridH: 16 };
    const colsPerSide = Math.max(2, Math.ceil(Math.sqrt(total)));
    const rowsPerSide = Math.max(2, Math.ceil(total / colsPerSide));
    return { colsPerSide, rowsPerSide, gridW: colsPerSide * 8, gridH: rowsPerSide * 8 };
}

function findRoomInHouseRecord(house, roomRef) {
    if (!house || !Array.isArray(house.rooms)) return null;
    const raw = String(roomRef || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    // 1) Совпадение по id или имени
    let match = house.rooms.find(r =>
        String(r.id || '').toLowerCase() === lower ||
        String(r.name || '').toLowerCase() === lower
    );
    if (match) return match;
    // 2) Синонимы kitchen/hall/room/corridor (включая падежи)
    const roomSyn = {
        kitchen: ['кухня', 'кухне', 'кухню', 'кухні', 'kitchen'],
        hall: ['зал', 'зале', 'зала', 'залу', 'залі', 'гостиная', 'гостиной', 'вітальня', 'hall', 'parlor'],
        room: ['комната', 'комнате', 'комнату', 'кімната', 'спальня', 'спальне', 'спальню', 'room', 'bedroom'],
        corridor: ['коридор', 'коридоре', 'коридорі', 'corridor', 'hallway']
    };
    for (const group of Object.values(roomSyn)) {
        if (group.includes(lower)) {
            match = house.rooms.find(r => group.includes(String(r.name || '').toLowerCase()));
            if (match) return match;
        }
    }
    // 3) Номер комнаты 1..N (для явно созданных комнат)
    if (/^\d+$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        if (idx >= 0 && idx < house.rooms.length) {
            return house.rooms[idx];
        }
    }
    // 4) Встроенные комнаты по умолчанию (kitchen/hall/room/corridor) для builtin-домов
    if (house.builtin) {
        const blueprint = BUILTIN_HOUSE_BLUEPRINTS[house.id] || {};
        const ql = hlResolveQuadrantLayout(house.quadrantLayout, blueprint.quadrantLayout);
        const builtinLabels = {
            kitchen: 'Кухня',
            hall: 'Зал',
            room: 'Комната',
            corridor: 'Коридор'
        };
        for (const [key, group] of Object.entries(roomSyn)) {
            if (group.includes(lower) && ql[key]) {
                const slotIdx = ql[key][1] * 2 + ql[key][0];
                return { id: key, name: builtinLabels[key] || key, slotIndex: slotIdx, builtinRoom: true };
            }
        }
        if (/^[1-4]$/.test(lower)) {
            const slotCoords = [[0, 0], [1, 0], [0, 1], [1, 1]][parseInt(lower, 10) - 1];
            const key = Object.keys(ql).find(k => ql[k][0] === slotCoords[0] && ql[k][1] === slotCoords[1]) || 'kitchen';
            const slotIdx = slotCoords[1] * 2 + slotCoords[0];
            return { id: key, name: builtinLabels[key] || key, slotIndex: slotIdx, builtinRoom: true };
        }
    }
    return null;
}

async function syncUserHousesToDb(user, state) {
    if (!user || user.isGuest || !user.id || user.id === 'guest' || !state) return false;
    try {
        localStorage.setItem(`${USER_HOUSES_PENDING_PREFIX}::${user.id}`, JSON.stringify(state));
    } catch (e) {}
    if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;

    try {
        const dbUser = await resolveAuthenticatedDbUser();
        const uid = (dbUser && dbUser.id) ? dbUser.id : user.id;
        const email = (dbUser && dbUser.email) || user.email || '';
        const tsNum = Number(state.ts || Date.now());
        const updatedAt = state.updatedAt || new Date(tsNum).toISOString();
        let ok = false;

        if (!isUserHousesTableMissing()) {
            const richRow = {
                user_id: uid,
                user_email: email,
                houses: Array.isArray(state.houses) ? state.houses : [],
                ts: tsNum,
                updated_at: updatedAt
            };
            let { error: uhErr } = await window.supabaseClient
                .from('user_houses')
                .upsert([richRow], { onConflict: 'user_id' });

            if (uhErr && isMissingColumnError(uhErr)) {
                const retry = await window.supabaseClient
                    .from('user_houses')
                    .upsert([{
                        user_id: uid,
                        houses: Array.isArray(state.houses) ? state.houses : [],
                        updated_at: updatedAt
                    }], { onConflict: 'user_id' });
                uhErr = retry.error;
            }

            if (!uhErr) {
                clearUserHousesTableMissing();
                ok = true;
            } else if (isMissingTableError(uhErr)) {
                markUserHousesTableMissing();
            } else if (isOfflineNetworkError(uhErr)) {
                return false;
            }
        }

        if (!ok) {
            const { data: existingRows, error: selErr } = await window.supabaseClient
                .from('commands_history')
                .select('id')
                .eq('created_by', uid)
                .eq('command', '__user_houses__')
                .eq('raw_text', '__user_houses__')
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (selErr && isOfflineNetworkError(selErr)) return false;

            if (!selErr && existingRows && existingRows[0] && existingRows[0].id) {
                const { data: updData, error: updErr } = await window.supabaseClient
                    .from('commands_history')
                    .update({
                        parameters: state,
                        created_at: updatedAt
                    })
                    .eq('id', existingRows[0].id)
                    .select('id');
                if (!updErr && updData && updData.length > 0) ok = true;
            }
            if (!ok) {
                const { error: insErr } = await window.supabaseClient
                    .from('commands_history')
                    .insert([{
                        raw_text: '__user_houses__',
                        command: '__user_houses__',
                        parameters: state,
                        output: 'user_houses',
                        result: 'OK',
                        status: 'success',
                        created_at: updatedAt,
                        created_by: uid
                    }]);
                if (!insErr) ok = true;
            }
        }

        if (ok) {
            try {
                const pendingRaw = localStorage.getItem(`${USER_HOUSES_PENDING_PREFIX}::${user.id}`);
                const pendingParsed = pendingRaw ? JSON.parse(pendingRaw) : null;
                if (pendingParsed && Number(pendingParsed.ts || 0) <= Number(state.ts || 0)) {
                    localStorage.removeItem(`${USER_HOUSES_PENDING_PREFIX}::${user.id}`);
                }
            } catch (e) {}
        }
        return ok;
    } catch (e) {
        return false;
    }
}

async function syncUserHousesFromDb(user) {
    if (!user || user.isGuest || !user.id || user.id === 'guest') return null;
    let localState = loadUserHousesState(user);

    // Если есть неотправленные локальные изменения — сначала отправляем их в облако
    try {
        const pendingRaw = localStorage.getItem(`${USER_HOUSES_PENDING_PREFIX}::${user.id}`);
        if (pendingRaw) {
            const pendingState = JSON.parse(pendingRaw);
            if (pendingState && Array.isArray(pendingState.houses)) {
                await syncUserHousesToDb(user, pendingState);
                localState = loadUserHousesState(user);
            }
        }
    } catch (e) {}

    if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        return localState;
    }

    try {
        const dbUser = await resolveAuthenticatedDbUser();
        const uid = (dbUser && dbUser.id) ? dbUser.id : user.id;

        let tableState = null;
        let tableTs = 0;
        let userHousesTableReady = false;

        if (!isUserHousesTableMissing()) {
            const { data: uhRows, error: uhErr } = await window.supabaseClient
                .from('user_houses')
                .select('*')
                .eq('user_id', uid)
                .limit(1);

            if (!uhErr && Array.isArray(uhRows)) {
                clearUserHousesTableMissing();
                userHousesTableReady = true;
                if (uhRows[0] && Array.isArray(uhRows[0].houses)) {
                    tableTs = Number(uhRows[0].ts || (uhRows[0].updated_at ? new Date(uhRows[0].updated_at).getTime() : 0));
                    tableState = {
                        version: 2,
                        updatedAt: uhRows[0].updated_at || new Date(tableTs || Date.now()).toISOString(),
                        ts: tableTs,
                        houses: uhRows[0].houses
                    };
                }
            } else if (uhErr && isMissingTableError(uhErr)) {
                markUserHousesTableMissing();
            }
        }

        let legacyState = null;
        let legacyTs = 0;
        const { data: rows, error } = await window.supabaseClient
            .from('commands_history')
            .select('parameters, created_at')
            .eq('created_by', uid)
            .eq('command', '__user_houses__')
            .eq('raw_text', '__user_houses__')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1);

        if (!error && rows && rows[0] && rows[0].parameters && Array.isArray(rows[0].parameters.houses)) {
            legacyState = rows[0].parameters;
            legacyTs = Number(legacyState.ts || (legacyState.updatedAt ? new Date(legacyState.updatedAt).getTime() : 0) || (rows[0].created_at ? new Date(rows[0].created_at).getTime() : 0));
        }

        const remote = (legacyTs > tableTs && legacyState) ? legacyState : (tableState || legacyState);
        const remoteTs = Math.max(tableTs, legacyTs);
        const localTs = Number((localState && (localState.ts || (localState.updatedAt ? new Date(localState.updatedAt).getTime() : 0))) || 0);

        if (remote && remoteTs > localTs) {
            saveUserHousesStateLocal(user, remote);
            localState = loadUserHousesState(user);
            if (userHousesTableReady && (!tableState || legacyTs > tableTs)) {
                await syncUserHousesToDb(user, localState);
            }
        } else if (localState && (!remote || localTs > remoteTs || (userHousesTableReady && !tableState))) {
            // Записываем дома пользователя в таблицу БД, если в ней ещё нет записи или локальная новее
            await syncUserHousesToDb(user, localState);
        }
    } catch (e) {}

    applyHouseNavVisibility(user);
    return localState;
}

window.UserHousesSync = {
    getState: (user) => loadUserHousesState(user),
    syncFromDb: syncUserHousesFromDb,
    syncToDb: syncUserHousesToDb,
    getSetupSql: getHousesDatabaseSetupSql,
    isTableMissing: isUserHousesTableMissing,
    findHouse: (user, ref) => {
        const st = loadUserHousesState(user);
        return findUserHouseByRef(st ? st.houses : [], ref);
    },
    findRoom: findRoomInHouseRecord,
    getThingPreset,
    parseThingColorInput,
    parseThingShapeInput,
    parseMakeSizeArgs,
    inferBuiltinThingType,
    getGridGeometry: getRoomsForHouseGridGeometry,
    addHouse: async (user, houseRef) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const clean = String(houseRef || '').trim();
        if (!clean) throw new Error('Укажите номер или название дома.');
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const existing = findUserHouseByRef(state.houses, clean);
        if (existing) {
            throw new Error(`Дом "${existing.name}" уже существует в вашем аккаунте.`);
        }
        const isNum = /^\d+$/.test(clean);
        const numVal = isNum ? parseInt(clean, 10) : (state.houses.reduce((m, h) => Math.max(m, Number(h.number) || 0), 0) + 1);
        const id = makeHouseSlugId(clean);
        const name = isNum ? `Дом ${numVal}` : clean;
        const newHouse = {
            id,
            number: numVal,
            roomId: `${id}_square`,
            name,
            url: getHouseUrlByRecord({ id }),
            builtin: false,
            rooms: [],
            things: [],
            createdAt: new Date().toISOString()
        };
        state.houses.push(newHouse);
        state.ts = Date.now();
        state.updatedAt = new Date(state.ts).toISOString();
        saveUserHousesStateLocal(user, state);
        applyHouseNavVisibility(user);
        const synced = await syncUserHousesToDb(user, state);
        return { house: newHouse, synced };
    },
    renameHouse: async (user, houseRef, newNameInput) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const cleanRef = String(houseRef || '').trim();
        const cleanNewName = String(newNameInput || '').trim();
        if (!cleanRef) throw new Error('Укажите дом, который нужно переименовать.');
        if (!cleanNewName) throw new Error('Укажите новое название дома.');

        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, cleanRef);
        if (!house) {
            throw new Error(`Дом "${cleanRef}" не найден в вашем аккаунте.`);
        }

        const dup = state.houses.find(h =>
            h.id !== house.id &&
            String(h.name || '').trim().toLowerCase() === cleanNewName.toLowerCase()
        );
        if (dup) {
            throw new Error(`Дом с названием "${dup.name}" уже существует в вашем аккаунте.`);
        }

        const oldName = house.name;
        house.name = cleanNewName;
        state.ts = Date.now();
        state.updatedAt = new Date(state.ts).toISOString();
        saveUserHousesStateLocal(user, state);
        applyHouseNavVisibility(user);
        const synced = await syncUserHousesToDb(user, state);
        return { house, oldName, newName: cleanNewName, synced };
    },
    addRoom: async (user, roomName, houseRef) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const cleanRoom = String(roomName || '').trim();
        if (!cleanRoom) throw new Error('Укажите название комнаты.');
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) {
            throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте. Сначала создайте его: \`Add house\` ➔ \`${houseRef}\`.`);
        }
        if (!Array.isArray(house.rooms)) house.rooms = [];
        const dup = house.rooms.find(r => String(r.name || '').toLowerCase() === cleanRoom.toLowerCase());
        if (dup) {
            throw new Error(`Комната "${dup.name}" уже есть в "${house.name}".`);
        }
        const slotIndex = house.rooms.length;
        const roomSlug = cleanRoom.toLowerCase().replace(/[^a-z0-9а-яєіїё]+/gi, '_').replace(/^_+|_+$/g, '') || `r_${slotIndex + 1}`;
        const newRoom = {
            id: `room_${roomSlug}_${slotIndex + 1}`,
            name: cleanRoom,
            slotIndex,
            createdAt: new Date().toISOString()
        };
        house.rooms.push(newRoom);
        state.ts = Date.now();
        state.updatedAt = new Date(state.ts).toISOString();
        saveUserHousesStateLocal(user, state);
        const synced = await syncUserHousesToDb(user, state);
        return { house, room: newRoom, synced };
    },
    addThing: async (user, thingName, roomRef, houseRef, queueIdInput = 0) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const cleanThing = String(thingName || '').trim();
        if (!cleanThing) throw new Error('Укажите название предмета.');
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) {
            throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);
        }

        const headlessRoom = hlLoadHeadlessHouseRoom(user, house);
        const colsPerSide = (headlessRoom && headlessRoom.colsPerSide)
            ? headlessRoom.colsPerSide
            : (((house.rooms && house.rooms.length > 0) ? house.rooms.length : 4) <= 4 ? 2 : Math.max(2, Math.ceil(Math.sqrt(house.rooms.length))));

        let room = findRoomInHouseRecord(house, roomRef);
        let qCol = 0;
        let qRow = 0;
        let slotIdx = 0;

        if (!room && house.builtin) {
            const blueprint = BUILTIN_HOUSE_BLUEPRINTS[house.id] || {};
            const ql = (headlessRoom && headlessRoom.quadrantLayout) ||
                hlResolveQuadrantLayout(house.quadrantLayout, blueprint.quadrantLayout);
            const lowerRef = String(roomRef || '').trim().toLowerCase();
            const builtinKeyMap = {
                kitchen: 'kitchen', кухня: 'kitchen', кухню: 'kitchen',
                hall: 'hall', зал: 'hall', зала: 'hall', залу: 'hall', гостиная: 'hall', parlor: 'hall',
                room: 'room', комната: 'room', комнату: 'room', спальня: 'room', кімната: 'room', bedroom: 'room',
                corridor: 'corridor', коридор: 'corridor', hallway: 'corridor'
            };
            let key = builtinKeyMap[lowerRef] || null;
            if (!key && /^[1-4]$/.test(lowerRef)) {
                const slotCoords = [[0, 0], [1, 0], [0, 1], [1, 1]][parseInt(lowerRef, 10) - 1];
                key = Object.keys(ql).find(k => ql[k][0] === slotCoords[0] && ql[k][1] === slotCoords[1]) || 'kitchen';
            }
            if (key && ql[key]) {
                qCol = ql[key][0];
                qRow = ql[key][1];
                slotIdx = qRow * colsPerSide + qCol;
                room = { id: `builtin_${key}`, name: key, slotIndex: slotIdx };
            }
        } else if (room) {
            slotIdx = Number(room.slotIndex) || 0;
            qCol = slotIdx % colsPerSide;
            qRow = Math.floor(slotIdx / colsPerSide);
        }

        if (!room) {
            throw new Error(`Комната "${roomRef}" не найдена в "${house.name}". Сначала создайте комнату: \`Add room\` ➔ \`${roomRef}\` ➔ \`to house\` ➔ \`${house.number || house.name}\`.`);
        }

        if (!Array.isArray(house.things)) house.things = [];
        const preset = getThingPreset(cleanThing);
        const queueNum = parseInt(String(queueIdInput || '0').replace(/[^\d]/g, ''), 10) || 0;

        // Вычисляем свободное место внутри подквадрата 8×8 этой комнаты с учётом ВСЕХ предметов (включая встроенные)
        const minC = qCol * 8;
        const minR = qRow * 8;
        const maxC = minC + 8;
        const maxR = minR + 8;

        const obstacles = (headlessRoom && Array.isArray(headlessRoom.items) && headlessRoom.items.length > 0)
            ? headlessRoom.items.filter(it => !it.hidden)
            : house.things.filter(it => !it.hidden);

        let placedCol = minC;
        let placedRow = minR;
        let foundSpot = false;
        for (let r = minR; r <= maxR - preset.h && !foundSpot; r++) {
            for (let c = minC; c <= maxC - preset.w && !foundSpot; c++) {
                const overlaps = obstacles.some(t =>
                    c < (t.col + t.w) && (c + preset.w) > t.col &&
                    r < (t.row + t.h) && (r + preset.h) > t.row
                );
                if (!overlaps) {
                    placedCol = c;
                    placedRow = r;
                    foundSpot = true;
                }
            }
        }

        const thingId = `thing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newThing = {
            id: thingId,
            type: preset.type,
            name: cleanThing,
            label: preset.label,
            roomId: room.id,
            roomName: room.name,
            slotIndex: slotIdx,
            queueId: queueNum,
            w: preset.w,
            h: preset.h,
            ...(preset.color ? { color: preset.color } : {}),
            ...(preset.shape && preset.shape !== 'rect' ? { shape: preset.shape } : {}),
            col: placedCol,
            row: placedRow,
            createdAt: new Date().toISOString()
        };

        house.things.push(newThing);
        state.ts = Date.now();
        state.updatedAt = new Date(state.ts).toISOString();
        saveUserHousesStateLocal(user, state);
        const synced = await syncUserHousesToDb(user, state);
        return { house, room, thing: newThing, foundSpot, synced };
    },
    setThingColor: async (user, houseRef, itemRef, colorInput, liveRoom = null) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const parsedColor = parseThingColorInput(colorInput);
        if (!parsedColor) {
            throw new Error(`Неизвестный цвет "${colorInput}". Доступны: brown, green, blue, red, yellow, white, gray, black, orange, purple или #hex.`);
        }
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);

        const room = liveRoom || hlLoadHeadlessHouseRoom(user, house);
        if (!room) throw new Error(`Не удалось загрузить расстановку дома "${house.name}".`);

        const item = hlResolveItemInRoom(room, itemRef);
        if (!item) throw new Error(`Предмет "${itemRef}" не найден в "${house.name}".`);

        item.color = parsedColor;
        if (!item.thingType) item.thingType = inferBuiltinThingType(item.id);
        item.customStyled = true;

        if (Array.isArray(house.things)) {
            const userThing = house.things.find(t => t.id === item.id);
            if (userThing) userThing.color = parsedColor;
        }

        const nowTs = Date.now();
        state.ts = nowTs;
        state.updatedAt = new Date(nowTs).toISOString();
        saveUserHousesStateLocal(user, state);
        const cloudOk = await syncUserHousesToDb(user, state);
        const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
        return { house, room, item, itemName: hlGetItemLabel(item), color: parsedColor, synced: Boolean(cloudOk && persisted.synced) };
    },
    setThingShape: async (user, houseRef, itemRef, shapeInput, liveRoom = null, options = {}) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const parsedShape = parseThingShapeInput(shapeInput);
        if (!parsedShape) {
            throw new Error(`Неизвестная форма/размер "${shapeInput}". Примеры: \`1x2\`, \`2x1\`, \`2x2\`, \`1x1\`, \`rect\`, \`corner\`, \`round\`.`);
        }
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);

        let targetRoomObj = null;
        if (options && options.roomRef) {
            targetRoomObj = findRoomInHouseRecord(house, options.roomRef);
            if (!targetRoomObj) {
                const avail = Array.isArray(house.rooms) && house.rooms.length
                    ? house.rooms.map(r => `"${r.name}"`).join(', ')
                    : 'kitchen, hall, room, corridor';
                throw new Error(`Комната "${options.roomRef}" не найдена в "${house.name}". Доступны: ${avail}.`);
            }
        }

        const room = liveRoom || hlLoadHeadlessHouseRoom(user, house);
        if (!room) throw new Error(`Не удалось загрузить расстановку дома "${house.name}".`);

        const item = hlResolveItemInRoom(room, itemRef, targetRoomObj, house);
        if (!item) {
            const roomSuffix = targetRoomObj ? ` в комнате "${targetRoomObj.name}"` : '';
            throw new Error(`Предмет "${itemRef}" не найден${roomSuffix} дома "${house.name}".`);
        }

        const hasExplicitDims = parsedShape.w !== null && parsedShape.h !== null;
        let nextBaseW = parsedShape.w !== null ? parsedShape.w : (Number(item.baseW) || Number(item.w) || 2);
        let nextBaseH = parsedShape.h !== null ? parsedShape.h : (Number(item.baseH) || Number(item.h) || 2);
        const nextShape = parsedShape.shape || item.shape || 'rect';
        if ((nextShape === 'corner' || nextShape === 'round') && parsedShape.w === null && (nextBaseW === 2 && nextBaseH === 1 || nextBaseW === 1 && nextBaseH === 2)) {
            nextBaseW = 2;
            nextBaseH = 2;
        }

        // При явном задании размера (X×Y) сбрасываем поворот в 0°, чтобы X всегда был шириной (слева-направо), а Y — высотой (сверху-вниз)
        const shouldResetRot = hasExplicitDims && !(options && options.resetRot === false);
        const nextRot = shouldResetRot ? 0 : hlNormalizeRotationDeg(item.rot || 0);
        const dims = hlGetRotatedDimensions(nextBaseW, nextBaseH, nextRot);
        const activeOthers = room.items.filter(x => !x.hidden && x.id !== item.id);
        let nextCol = item.col;
        let nextRow = item.row;

        if (!item.hidden) {
            const fitsInPlace = hlCanPlaceItem(room, item.id, nextCol, nextRow, dims.w, dims.h, activeOthers) &&
                !(room.quadrants && hlStraddlesQuadrantWall(room, nextCol, nextRow, dims.w, dims.h));
            if (!fitsInPlace) {
                const tempItem = { ...item, w: dims.w, h: dims.h };
                const spot = hlFindFreePlacementInRoom(room, tempItem, activeOthers);
                if (!spot) {
                    throw new Error(`⚠️ Нет свободного места в комнате для размера ${dims.w}×${dims.h}.`);
                }
                nextCol = spot.col;
                nextRow = spot.row;
            }
        }

        item.shape = nextShape;
        item.baseW = nextBaseW;
        item.baseH = nextBaseH;
        item.rot = nextRot;
        item.w = dims.w;
        item.h = dims.h;
        item.col = nextCol;
        item.row = nextRow;
        if (!item.thingType) item.thingType = inferBuiltinThingType(item.id);
        item.customStyled = true;

        if (Array.isArray(house.things)) {
            const userThing = house.things.find(t => t.id === item.id);
            if (userThing) {
                userThing.shape = nextShape;
                userThing.w = nextBaseW;
                userThing.h = nextBaseH;
                userThing.rot = nextRot;
                userThing.col = nextCol;
                userThing.row = nextRow;
            }
        }

        const nowTs = Date.now();
        state.ts = nowTs;
        state.updatedAt = new Date(nowTs).toISOString();
        saveUserHousesStateLocal(user, state);
        const cloudOk = await syncUserHousesToDb(user, state);
        const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
        return {
            house,
            targetRoom: targetRoomObj,
            room,
            item,
            itemName: hlGetItemLabel(item),
            shape: nextShape,
            w: nextBaseW,
            h: nextBaseH,
            rot: nextRot,
            synced: Boolean(cloudOk && persisted.synced)
        };
    },
    setThingQueue: async (user, houseRef, itemRef, queueInput, liveRoom = null) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const lowerQ = String(queueInput === undefined || queueInput === null ? '' : queueInput).trim().toLowerCase();
        let queueNum = 0;
        if (lowerQ !== '0' && lowerQ !== '-' && lowerQ !== 'none' && lowerQ !== 'нет' && lowerQ !== 'без' && lowerQ !== 'unlink') {
            if (!/^\d+$/.test(lowerQ)) {
                throw new Error('⚠️ Укажите числовой номер очереди (например: `2`) или `0` / `-` чтобы отвязать.');
            }
            queueNum = parseInt(lowerQ, 10) || 0;
        }
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);

        const room = liveRoom || hlLoadHeadlessHouseRoom(user, house);
        if (!room) throw new Error(`Не удалось загрузить расстановку дома "${house.name}".`);

        const item = hlResolveItemInRoom(room, itemRef);
        if (!item) throw new Error(`Предмет "${itemRef}" не найден в "${house.name}".`);

        item.queueId = queueNum;
        if (Array.isArray(house.things)) {
            const userThing = house.things.find(t => t.id === item.id);
            if (userThing) userThing.queueId = queueNum;
        }

        const nowTs = Date.now();
        state.ts = nowTs;
        state.updatedAt = new Date(nowTs).toISOString();
        saveUserHousesStateLocal(user, state);
        const cloudOk = await syncUserHousesToDb(user, state);
        const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
        return {
            house,
            room,
            item,
            itemName: hlGetItemLabel(item),
            queueId: queueNum,
            synced: Boolean(cloudOk && persisted.synced)
        };
    },
    updateThingPositionsFromLayout: (user, houseRef, layoutMap, asyncCloud = true) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest' || !layoutMap || typeof layoutMap !== 'object') return false;
        const state = loadUserHousesState(user);
        if (!state || !Array.isArray(state.houses)) return false;
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house || !Array.isArray(house.things) || house.things.length === 0) return false;
        let changed = false;
        house.things.forEach(t => {
            const pos = layoutMap[t.id];
            if (pos && Number.isInteger(pos.col) && Number.isInteger(pos.row)) {
                const nextRot = ((Math.round((Number(pos.rot) || 0) / 90) * 90) % 360 + 360) % 360;
                const nextHidden = Boolean(pos.hidden);
                const nextW = (Number(pos.baseW) >= 1 && Number(pos.baseW) <= 8) ? Number(pos.baseW) : (Number(t.w) || 2);
                const nextH = (Number(pos.baseH) >= 1 && Number(pos.baseH) <= 8) ? Number(pos.baseH) : (Number(t.h) || 2);
                const nextColor = typeof pos.color === 'string' ? pos.color : t.color;
                const nextShape = typeof pos.shape === 'string' ? pos.shape : t.shape;
                const nextQueue = pos.queueId !== undefined ? (Number(pos.queueId) || 0) : (Number(t.queueId) || 0);
                if (t.col !== pos.col || t.row !== pos.row || (Number(t.rot) || 0) !== nextRot || Boolean(t.hidden) !== nextHidden ||
                    t.w !== nextW || t.h !== nextH || t.color !== nextColor || t.shape !== nextShape || (Number(t.queueId) || 0) !== nextQueue) {
                    t.col = pos.col;
                    t.row = pos.row;
                    t.rot = nextRot;
                    t.hidden = nextHidden;
                    t.w = nextW;
                    t.h = nextH;
                    if (nextColor) t.color = nextColor;
                    if (nextShape) t.shape = nextShape;
                    t.queueId = nextQueue;
                    changed = true;
                }
            }
        });
        if (!changed) return false;
        state.ts = Date.now();
        state.updatedAt = new Date(state.ts).toISOString();
        saveUserHousesStateLocal(user, state);
        if (asyncCloud) {
            syncUserHousesToDb(user, state).catch(() => {});
            return true;
        }
        return syncUserHousesToDb(user, state);
    },
    markHouseReady: async (user, houseRef) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        if (!isAdminUser(user)) {
            throw new Error('🔒 Завершение настройки дома доступно только администраторам.');
        }
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) {
            throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);
        }
        if (house.isReady || house.ready || house.locked) {
            return { house, alreadyReady: true, synced: true };
        }
        house.isReady = true;
        house.readyAt = new Date().toISOString();
        state.ts = Date.now();
        state.updatedAt = house.readyAt;
        saveUserHousesStateLocal(user, state);
        const synced = await syncUserHousesToDb(user, state);
        return { house, alreadyReady: false, synced };
    },
    swapRooms: async (user, houseRef, roomARef, roomBRef, liveRoom = null) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        if (!isAdminUser(user)) {
            throw new Error('🔒 Смена комнат местами (позиционирование дома) — привилегия администраторов.');
        }
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) {
            throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);
        }
        if (house.isReady || house.ready || house.locked) {
            throw new Error(`🔒 Дом "${house.name}" уже готов — менять комнаты местами больше нельзя.`);
        }

        const room = liveRoom || hlLoadHeadlessHouseRoom(user, house);
        if (!room) {
            throw new Error(`Не удалось загрузить расстановку дома "${house.name}".`);
        }

        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();

        if (house.builtin) {
            const blueprint = BUILTIN_HOUSE_BLUEPRINTS[house.id] || {};
            const ql = hlResolveQuadrantLayout(
                (liveRoom && liveRoom.quadrantLayout) || house.quadrantLayout || blueprint.quadrantLayout,
                blueprint.quadrantLayout
            );
            const resolveBuiltinKey = (ref) => {
                const lower = String(ref || '').trim().toLowerCase();
                if (!lower) return null;
                const aliases = {
                    kitchen: ['kitchen', 'кухня', 'кухню'],
                    hall: ['hall', 'зал', 'зала', 'залу', 'гостиная', 'parlor'],
                    room: ['room', 'комната', 'комнату', 'спальня', 'кімната', 'bedroom'],
                    corridor: ['corridor', 'коридор', 'hallway']
                };
                for (const [k, list] of Object.entries(aliases)) {
                    if (list.includes(lower)) return k;
                }
                if (/^[1-4]$/.test(lower)) {
                    const slotCoords = [[0, 0], [1, 0], [0, 1], [1, 1]][parseInt(lower, 10) - 1];
                    return Object.keys(ql).find(k => ql[k][0] === slotCoords[0] && ql[k][1] === slotCoords[1]) || null;
                }
                return null;
            };

            const keyA = resolveBuiltinKey(roomARef);
            const keyB = resolveBuiltinKey(roomBRef);
            const labelsRu = { kitchen: 'Кухня', hall: 'Зал', room: 'Комната', corridor: 'Коридор' };

            if (!keyA) throw new Error(`Комната "${roomARef}" не найдена (доступны: kitchen, hall, room, corridor).`);
            if (!keyB) throw new Error(`Комната "${roomBRef}" не найдена (доступны: kitchen, hall, room, corridor).`);
            if (keyA === keyB) throw new Error('⚠️ Укажите две разные комнаты.');

            const [ax, ay] = ql[keyA];
            const [bx, by] = ql[keyB];
            const dxA = (bx - ax) * 8;
            const dyA = (by - ay) * 8;
            const dxB = (ax - bx) * 8;
            const dyB = (ay - by) * 8;

            let movedCount = 0;
            room.items.forEach(item => {
                const qx = Math.floor((Number(item.col) || 0) / 8);
                const qy = Math.floor((Number(item.row) || 0) / 8);
                if (qx === ax && qy === ay) {
                    item.col += dxA;
                    item.row += dyA;
                    movedCount++;
                } else if (qx === bx && qy === by) {
                    item.col += dxB;
                    item.row += dyB;
                    movedCount++;
                }
            });

            if (Array.isArray(house.things)) {
                house.things.forEach(t => {
                    const qx = Math.floor((Number(t.col) || 0) / 8);
                    const qy = Math.floor((Number(t.row) || 0) / 8);
                    if (qx === ax && qy === ay) {
                        t.col += dxA;
                        t.row += dyA;
                        t.slotIndex = by * 2 + bx;
                    } else if (qx === bx && qy === by) {
                        t.col += dxB;
                        t.row += dyB;
                        t.slotIndex = ay * 2 + ax;
                    }
                });
            }

            ql[keyA] = [bx, by];
            ql[keyB] = [ax, ay];
            room.quadrantLayout = ql;
            house.quadrantLayout = ql;

            state.ts = nowTs;
            state.updatedAt = nowIso;
            saveUserHousesStateLocal(user, state);
            const cloudOk = await syncUserHousesToDb(user, state);
            const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
            return {
                house,
                room,
                roomAName: labelsRu[keyA] || keyA,
                roomBName: labelsRu[keyB] || keyB,
                keyA,
                keyB,
                movedCount,
                synced: Boolean(cloudOk && persisted.synced)
            };
        }

        // Пользовательский (не встроенный) дом
        if (!Array.isArray(house.rooms) || house.rooms.length < 2) {
            throw new Error(`⚠️ В доме "${house.name}" должно быть минимум 2 комнаты для смены местами.`);
        }
        house.rooms.forEach((r, idx) => {
            if (!Number.isInteger(r.slotIndex)) r.slotIndex = idx;
        });

        const roomA = findRoomInHouseRecord(house, roomARef);
        const roomB = findRoomInHouseRecord(house, roomBRef);
        if (!roomA) throw new Error(`Комната "${roomARef}" не найдена в "${house.name}".`);
        if (!roomB) throw new Error(`Комната "${roomBRef}" не найдена в "${house.name}".`);
        if (roomA.id === roomB.id) throw new Error('⚠️ Укажите две разные комнаты.');

        const geom = getRoomsForHouseGridGeometry(house);
        const colsPerSide = geom.colsPerSide || 2;
        const slotA = Number(roomA.slotIndex);
        const slotB = Number(roomB.slotIndex);
        const ax = slotA % colsPerSide;
        const ay = Math.floor(slotA / colsPerSide);
        const bx = slotB % colsPerSide;
        const by = Math.floor(slotB / colsPerSide);
        const dxA = (bx - ax) * 8;
        const dyA = (by - ay) * 8;
        const dxB = (ax - bx) * 8;
        const dyB = (ay - by) * 8;

        let movedCount = 0;
        room.items.forEach(item => {
            const qx = Math.floor((Number(item.col) || 0) / 8);
            const qy = Math.floor((Number(item.row) || 0) / 8);
            if (qx === ax && qy === ay) {
                item.col += dxA;
                item.row += dyA;
                movedCount++;
            } else if (qx === bx && qy === by) {
                item.col += dxB;
                item.row += dyB;
                movedCount++;
            }
        });

        if (Array.isArray(house.things)) {
            house.things.forEach(t => {
                const qx = Math.floor((Number(t.col) || 0) / 8);
                const qy = Math.floor((Number(t.row) || 0) / 8);
                if (t.roomId === roomA.id || (qx === ax && qy === ay)) {
                    t.col += dxA;
                    t.row += dyA;
                    t.slotIndex = slotB;
                } else if (t.roomId === roomB.id || (qx === bx && qy === by)) {
                    t.col += dxB;
                    t.row += dyB;
                    t.slotIndex = slotA;
                }
            });
        }

        roomA.slotIndex = slotB;
        roomB.slotIndex = slotA;
        house.rooms.sort((a, b) => (Number(a.slotIndex) || 0) - (Number(b.slotIndex) || 0));

        state.ts = nowTs;
        state.updatedAt = nowIso;
        saveUserHousesStateLocal(user, state);
        const cloudOk = await syncUserHousesToDb(user, state);
        const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
        return {
            house,
            room,
            roomAName: roomA.name,
            roomBName: roomB.name,
            slotA,
            slotB,
            movedCount,
            synced: Boolean(cloudOk && persisted.synced)
        };
    },
    rotateRoom: async (user, houseRef, roomRef, deltaDegInput, liveRoom = null) => {
        if (!user || user.isGuest || !user.id || user.id === 'guest') {
            throw new Error('Требуется авторизация через Google (`login`).');
        }
        const deltaDeg = Number(deltaDegInput) >= 0 ? 90 : -90;
        const state = loadUserHousesState(user) || buildDefaultUserHousesState(user);
        const house = findUserHouseByRef(state.houses, houseRef);
        if (!house) {
            throw new Error(`Дом "${houseRef}" не найден в вашем аккаунте.`);
        }

        const room = liveRoom || hlLoadHeadlessHouseRoom(user, house);
        if (!room) {
            throw new Error(`Не удалось загрузить расстановку дома "${house.name}".`);
        }

        let targetQx = 0;
        let targetQy = 0;
        let roomDisplayName = String(roomRef || '').trim();
        let targetRoomObj = null;

        if (house.builtin) {
            const blueprint = BUILTIN_HOUSE_BLUEPRINTS[house.id] || {};
            const ql = hlResolveQuadrantLayout(
                (liveRoom && liveRoom.quadrantLayout) || room.quadrantLayout || house.quadrantLayout || blueprint.quadrantLayout,
                blueprint.quadrantLayout
            );
            const lower = roomDisplayName.toLowerCase();
            const aliases = {
                kitchen: ['kitchen', 'кухня', 'кухню'],
                hall: ['hall', 'зал', 'зала', 'залу', 'гостиная', 'parlor'],
                room: ['room', 'комната', 'комнату', 'спальня', 'кімната', 'bedroom'],
                corridor: ['corridor', 'коридор', 'hallway']
            };
            let matchedKey = null;
            for (const [k, list] of Object.entries(aliases)) {
                if (list.includes(lower)) {
                    matchedKey = k;
                    break;
                }
            }
            if (!matchedKey && /^[1-4]$/.test(lower)) {
                const slotCoords = [[0, 0], [1, 0], [0, 1], [1, 1]][parseInt(lower, 10) - 1];
                matchedKey = Object.keys(ql).find(k => ql[k][0] === slotCoords[0] && ql[k][1] === slotCoords[1]) || null;
            }
            if (!matchedKey || !ql[matchedKey]) {
                throw new Error(`Комната "${roomRef}" не найдена (доступны: kitchen, hall, room, corridor).`);
            }
            const labelsRu = { kitchen: 'Кухня', hall: 'Зал', room: 'Комната', corridor: 'Коридор' };
            targetQx = ql[matchedKey][0];
            targetQy = ql[matchedKey][1];
            roomDisplayName = labelsRu[matchedKey] || matchedKey;
        } else {
            if (!Array.isArray(house.rooms) || house.rooms.length === 0) {
                throw new Error(`В доме "${house.name}" пока нет комнат.`);
            }
            house.rooms.forEach((r, idx) => {
                if (!Number.isInteger(r.slotIndex)) r.slotIndex = idx;
            });
            targetRoomObj = findRoomInHouseRecord(house, roomRef);
            if (!targetRoomObj) {
                throw new Error(`Комната "${roomRef}" не найдена в "${house.name}".`);
            }
            const geom = getRoomsForHouseGridGeometry(house);
            const colsPerSide = geom.colsPerSide || 2;
            const slotIdx = Number(targetRoomObj.slotIndex) || 0;
            targetQx = slotIdx % colsPerSide;
            targetQy = Math.floor(slotIdx / colsPerSide);
            roomDisplayName = targetRoomObj.name;
        }

        const originX = targetQx * 8;
        const originY = targetQy * 8;
        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();

        let rotatedCount = 0;
        const rotatedMap = new Map();

        room.items.forEach(item => {
            const oldW = Number(item.w) || 1;
            const oldH = Number(item.h) || 1;
            const itemQx = Math.floor((Number(item.col) + oldW * 0.5) / 8);
            const itemQy = Math.floor((Number(item.row) + oldH * 0.5) / 8);
            if (itemQx !== targetQx || itemQy !== targetQy) return;

            const localX = (Number(item.col) || 0) - originX;
            const localY = (Number(item.row) || 0) - originY;
            const nextRot = hlNormalizeRotationDeg((item.rot || 0) + deltaDeg);
            const nextDims = hlGetRotatedDimensions(item.baseW || oldW, item.baseH || oldH, nextRot);

            let newLocalX = deltaDeg > 0 ? (8 - localY - oldH) : localY;
            let newLocalY = deltaDeg > 0 ? localX : (8 - localX - oldW);
            newLocalX = Math.max(0, Math.min(8 - nextDims.w, newLocalX));
            newLocalY = Math.max(0, Math.min(8 - nextDims.h, newLocalY));

            item.col = originX + newLocalX;
            item.row = originY + newLocalY;
            item.rot = nextDims.rot;
            item.w = nextDims.w;
            item.h = nextDims.h;
            rotatedCount++;
            rotatedMap.set(item.id, { col: item.col, row: item.row, rot: item.rot });
        });

        let synced = true;
        if (rotatedCount > 0) {
            if (Array.isArray(house.things)) {
                house.things.forEach(t => {
                    const upd = rotatedMap.get(t.id);
                    if (upd) {
                        t.col = upd.col;
                        t.row = upd.row;
                        t.rot = upd.rot;
                    }
                });
            }
            state.ts = nowTs;
            state.updatedAt = nowIso;
            saveUserHousesStateLocal(user, state);
            const cloudOk = await syncUserHousesToDb(user, state);
            const persisted = await hlPersistRoomLayout(user, house, room, { asyncCloud: false, customTs: nowTs });
            synced = Boolean(cloudOk && persisted.synced);
        }

        return {
            house,
            room,
            roomName: roomDisplayName,
            deltaDeg,
            rotatedCount,
            synced
        };
    }
};

// =========================================================================
// Общее ядро геометрии, поворотов, скрытия и расстановки Домов (для консоли и UI)
// =========================================================================
const HOUSE_DOOR_WIDTH_TILES = 2;

const BUILTIN_HOUSE_BLUEPRINTS = {
    house1: {
        id: 'house1_square',
        storageKey: 'room_layout_house1_square_v1',
        tsKey: 'room_layout_house1_square_v1_ts',
        quadrants: true,
        quadrantLayout: {
            kitchen: [0, 0],
            hall: [1, 0],
            room: [0, 1],
            corridor: [1, 1]
        },
        gridW: 16,
        gridH: 16,
        colsPerSide: 2,
        rowsPerSide: 2,
        items: [
            { id: 'washer', label: 'Стиральная машина', thingType: 'washer', w: 2, h: 2, col: 0, row: 0 },
            { id: 'stove', label: 'Печь', thingType: 'stove', w: 2, h: 2, col: 5, row: 0 },
            { id: 'table', label: 'Зелёный столик', thingType: 'table', color: 'green', shape: 'rect', w: 2, h: 1, col: 0, row: 5 },
            { id: 'table_brown', label: 'Коричневый столик', thingType: 'table', color: 'brown', shape: 'rect', w: 2, h: 1, col: 0, row: 6 },
            { id: 'multicooker', label: 'Мультиварка', thingType: 'multicooker', w: 1, h: 1, col: 3, row: 5 },
            { id: 'tv', label: 'Телевизор', thingType: 'tv', w: 2, h: 2, col: 9, row: 0 },
            { id: 'router', label: 'Роутер', thingType: 'router', w: 1, h: 1, col: 14, row: 0 },
            { id: 'hall_table', label: 'Коричневый столик', thingType: 'table', color: 'brown', shape: 'rect', w: 2, h: 1, col: 9, row: 3 },
            { id: 'armchair', label: 'Кресло', thingType: 'armchair', w: 2, h: 2, col: 13, row: 3 },
            { id: 'sofa', label: 'Диван', thingType: 'sofa', w: 5, h: 2, col: 8, row: 6 },
            { id: 'armchair2', label: 'Кресло справа', thingType: 'armchair', w: 2, h: 2, col: 13, row: 6 }
        ]
    },
    house2: {
        id: 'house2_square',
        storageKey: 'room_layout_house2_square_v1',
        tsKey: 'room_layout_house2_square_v1_ts',
        quadrants: true,
        quadrantLayout: {
            kitchen: [0, 0],
            hall: [1, 0],
            room: [0, 1],
            corridor: [1, 1]
        },
        gridW: 16,
        gridH: 16,
        colsPerSide: 2,
        rowsPerSide: 2,
        items: [
            { id: 'fridge2', label: 'Холодильник', thingType: 'fridge', w: 2, h: 2, col: 0, row: 0 },
            { id: 'stove2', label: 'Печь', thingType: 'stove', w: 2, h: 2, col: 2, row: 0 },
            { id: 'boiler2', label: 'Бойлер', thingType: 'boiler', w: 2, h: 2, col: 0, row: 3 },
            { id: 'table2', label: 'Столик', thingType: 'table', color: 'brown', shape: 'rect', w: 2, h: 1, col: 2, row: 3 },
            { id: 'closet2_1', label: 'Шкаф 1', thingType: 'closet', w: 2, h: 2, col: 8, row: 0 },
            { id: 'closet2_2', label: 'Шкаф 2', thingType: 'closet', w: 2, h: 2, col: 10, row: 0 },
            { id: 'closet2_3', label: 'Шкаф 3', thingType: 'closet', w: 2, h: 2, col: 12, row: 0 },
            { id: 'closet2_4', label: 'Шкаф 4', thingType: 'closet', w: 2, h: 2, col: 8, row: 3 },
            { id: 'hall2_table', label: 'Столик в зале', thingType: 'table', color: 'brown', shape: 'rect', w: 2, h: 1, col: 11, row: 3 },
            { id: 'armchair_h2', label: 'Кресло', thingType: 'armchair', w: 2, h: 2, col: 10, row: 5 },
            { id: 'laptop2', label: 'Ноутбук', thingType: 'laptop', w: 1, h: 1, col: 13, row: 2 },
            { id: 'desk2', label: 'Столик у окна', thingType: 'table', color: 'brown', shape: 'rect', w: 1, h: 2, col: 14, row: 2 },
            { id: 'window2_1', label: 'Правое окно 1', thingType: 'window', w: 1, h: 2, col: 15, row: 2 },
            { id: 'window2_2', label: 'Правое окно 2', thingType: 'window', w: 1, h: 2, col: 15, row: 5 },
            { id: 'bed2', label: 'Двуспальная кровать', thingType: 'bed', w: 2, h: 2, col: 1, row: 10 }
        ]
    },
    house3: {
        id: 'house3_square_v2',
        storageKey: 'room_layout_house3_square_v2',
        tsKey: 'room_layout_house3_square_v2_ts',
        quadrants: true,
        quadrantLayout: {
            kitchen: [0, 0],
            corridor: [1, 0],
            hall: [0, 1],
            room: [1, 1]
        },
        gridW: 16,
        gridH: 16,
        colsPerSide: 2,
        rowsPerSide: 2,
        items: [
            { id: 'washer3', label: 'Стиральная машина', thingType: 'washer', w: 2, h: 2, col: 0, row: 0 },
            { id: 'stove3', label: 'Печь', thingType: 'stove', w: 2, h: 2, col: 3, row: 0 },
            { id: 'fridge3', label: 'Холодильник', thingType: 'fridge', w: 2, h: 2, col: 5, row: 0 },
            { id: 'window3', label: 'Окно', thingType: 'window', w: 1, h: 2, col: 2, row: 2 },
            { id: 'table3', label: 'Столик', thingType: 'table', color: 'green', shape: 'rect', w: 2, h: 1, col: 0, row: 4 },
            { id: 'laptop3', label: 'Ноутбук', thingType: 'laptop', w: 1, h: 1, col: 0, row: 8 },
            { id: 'conditioner3', label: 'Кондиционер', thingType: 'conditioner', w: 2, h: 1, col: 2, row: 8 },
            { id: 'radiator3', label: 'Батарея', thingType: 'radiator', w: 1, h: 2, col: 4, row: 8 },
            { id: 'router3', label: 'Роутер', thingType: 'router', w: 1, h: 1, col: 6, row: 8 },
            { id: 'hall3_table', label: 'Угловой стол', thingType: 'table', color: 'brown', shape: 'corner', w: 2, h: 2, col: 0, row: 10 },
            { id: 'bed3', label: 'Кровать', thingType: 'bed', w: 3, h: 3, col: 4, row: 10 },
            { id: 'room3_closet', label: 'Шкаф', thingType: 'closet', w: 2, h: 2, col: 8, row: 8 },
            { id: 'room3_radiator', label: 'Батарея в комнате', thingType: 'radiator', w: 2, h: 1, col: 13, row: 8 },
            { id: 'room3_window', label: 'Окно в комнате', thingType: 'window', w: 1, h: 2, col: 15, row: 9 },
            { id: 'room3_bed', label: 'Одноместная кровать', thingType: 'bed', w: 1, h: 2, col: 9, row: 11 }
        ]
    }
};

function hlResolveQuadrantLayout(customLayout, baseLayout = null) {
    const def = baseLayout || {
        kitchen: [0, 0],
        hall: [1, 0],
        room: [0, 1],
        corridor: [1, 1]
    };
    const result = {
        kitchen: [...(def.kitchen || [0, 0])],
        hall: [...(def.hall || [1, 0])],
        room: [...(def.room || [0, 1])],
        corridor: [...(def.corridor || [1, 1])]
    };
    if (customLayout && typeof customLayout === 'object') {
        Object.keys(result).forEach(key => {
            const coords = customLayout[key];
            if (Array.isArray(coords) && coords.length === 2 &&
                (coords[0] === 0 || coords[0] === 1) &&
                (coords[1] === 0 || coords[1] === 1)) {
                result[key] = [coords[0], coords[1]];
            }
        });
    }
    return result;
}

function hlNormalizeRotationDeg(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
}

function hlGetRotatedDimensions(baseW, baseH, rotDeg) {
    const rot = hlNormalizeRotationDeg(rotDeg);
    const bw = Number(baseW) || 2;
    const bh = Number(baseH) || 2;
    if (rot === 90 || rot === 270) {
        return { w: bh, h: bw, rot };
    }
    return { w: bw, h: bh, rot };
}

function hlRectanglesOverlap(a, b) {
    return a.col < b.col + b.w &&
           a.col + a.w > b.col &&
           a.row < b.row + b.h &&
           a.row + a.h > b.row;
}

function hlCanItemPassThroughDoor(item) {
    if (!item) return false;
    return Math.min(Number(item.w) || 0, Number(item.h) || 0) <= HOUSE_DOOR_WIDTH_TILES;
}

function hlStraddlesQuadrantWall(room, col, row, w, h) {
    if (!room || !room.quadrants) return false;
    const c1 = Math.floor(col / 8);
    const c2 = Math.floor((col + w - 1) / 8);
    const r1 = Math.floor(row / 8);
    const r2 = Math.floor((row + h - 1) / 8);
    return c1 !== c2 || r1 !== r2;
}

function hlGetItemQuadrant(room, col, row, w, h) {
    if (!room || !room.quadrants) return 0;
    if (hlStraddlesQuadrantWall(room, col, row, w, h)) return -1;
    const colsPerSide = room.colsPerSide || Math.max(2, Math.round(room.gridW / 8));
    const qCol = Math.floor(col / 8);
    const qRow = Math.floor(row / 8);
    return qRow * colsPerSide + qCol;
}

function hlCanPlaceItem(room, id, col, row, w, h, list = room.items) {
    if (col < 0 || row < 0 || col + w > room.gridW || row + h > room.gridH) return false;
    const candidate = { col, row, w, h };
    for (const other of list) {
        if (!other || other.id === id || other.hidden) continue;
        if (hlRectanglesOverlap(candidate, other)) return false;
    }
    return true;
}

function hlCanMoveItemTo(room, item, originCol, originRow, targetCol, targetRow, list = room.items) {
    if (!hlCanPlaceItem(room, item.id, targetCol, targetRow, item.w, item.h, list)) {
        return { ok: false, reason: 'overlap_or_bounds' };
    }
    if (!room || !room.quadrants) {
        return { ok: true, reason: '' };
    }
    if (hlStraddlesQuadrantWall(room, targetCol, targetRow, item.w, item.h)) {
        return { ok: false, reason: 'wall' };
    }
    const origQuad = hlGetItemQuadrant(room, originCol, originRow, item.w, item.h);
    const destQuad = hlGetItemQuadrant(room, targetCol, targetRow, item.w, item.h);
    if (origQuad !== -1 && destQuad !== origQuad && !hlCanItemPassThroughDoor(item)) {
        return { ok: false, reason: 'door_size' };
    }
    return { ok: true, reason: '' };
}

function hlFindFreePlacementInRoom(room, item, acceptedList) {
    const prefQ = room.quadrants ? hlGetItemQuadrant(room, item.col, item.row, item.w, item.h) : 0;
    const candidates = [];
    for (let r = 0; r <= room.gridH - item.h; r++) {
        for (let c = 0; c <= room.gridW - item.w; c++) {
            if (!hlCanPlaceItem(room, item.id, c, r, item.w, item.h, acceptedList)) continue;
            if (room.quadrants && hlStraddlesQuadrantWall(room, c, r, item.w, item.h)) continue;
            const q = room.quadrants ? hlGetItemQuadrant(room, c, r, item.w, item.h) : 0;
            const sameQuadPenalty = (prefQ !== -1 && q !== prefQ) ? 1000 : 0;
            const dist = Math.abs(c - item.col) + Math.abs(r - item.row) + sameQuadPenalty;
            candidates.push({ col: c, row: r, dist });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.dist - b.dist);
    return { col: candidates[0].col, row: candidates[0].row };
}

function hlFindRotationSpot(room, item, newW, newH) {
    const origQuad = room.quadrants ? hlGetItemQuadrant(room, item.col, item.row, item.w, item.h) : 0;
    const origCenterX = item.col + item.w / 2;
    const origCenterY = item.row + item.h / 2;

    const isSpotValid = (c, r) => {
        if (!hlCanPlaceItem(room, item.id, c, r, newW, newH, room.items)) return false;
        if (room.quadrants && hlStraddlesQuadrantWall(room, c, r, newW, newH)) return false;
        if (room.quadrants && origQuad !== -1 && hlGetItemQuadrant(room, c, r, newW, newH) !== origQuad) return false;
        return true;
    };

    if (isSpotValid(item.col, item.row)) {
        return { col: item.col, row: item.row };
    }

    const candidates = [];
    for (let dr = -4; dr <= 4; dr++) {
        for (let dc = -4; dc <= 4; dc++) {
            const c = item.col + dc;
            const r = item.row + dr;
            if (!isSpotValid(c, r)) continue;
            const cx = c + newW / 2;
            const cy = r + newH / 2;
            const dist = Math.hypot(cx - origCenterX, cy - origCenterY) + (Math.abs(dc) + Math.abs(dr)) * 0.05;
            candidates.push({ col: c, row: r, dist });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.dist - b.dist);
    return { col: candidates[0].col, row: candidates[0].row };
}

function hlApplyLayoutMap(room, savedMap) {
    if (!savedMap || typeof savedMap !== 'object') return false;
    const accepted = [];
    let changed = false;

    if (savedMap.__quadrantLayout && typeof savedMap.__quadrantLayout === 'object' && !room.dynamicRooms) {
        const nextQl = hlResolveQuadrantLayout(savedMap.__quadrantLayout, room.quadrantLayout);
        if (JSON.stringify(nextQl) !== JSON.stringify(room.quadrantLayout)) {
            changed = true;
        }
        room.quadrantLayout = nextQl;
    }

    for (const item of room.items) {
        const candidate = savedMap[item.id];
        if (candidate && typeof candidate === 'object') {
            if (Number(candidate.baseW) >= 1 && Number(candidate.baseW) <= 8) {
                if (item.baseW !== Number(candidate.baseW)) changed = true;
                item.baseW = Number(candidate.baseW);
                item.customStyled = true;
            }
            if (Number(candidate.baseH) >= 1 && Number(candidate.baseH) <= 8) {
                if (item.baseH !== Number(candidate.baseH)) changed = true;
                item.baseH = Number(candidate.baseH);
                item.customStyled = true;
            }
            if (typeof candidate.color === 'string' && candidate.color) {
                if (item.color !== candidate.color) changed = true;
                item.color = candidate.color;
                item.customStyled = true;
            }
            if (typeof candidate.shape === 'string' && candidate.shape) {
                if (item.shape !== candidate.shape) changed = true;
                item.shape = candidate.shape;
                item.customStyled = true;
            }
            if (candidate.queueId !== undefined && Number.isFinite(Number(candidate.queueId))) {
                const nextQ = Math.max(0, parseInt(candidate.queueId, 10) || 0);
                if (item.queueId !== nextQ) changed = true;
                item.queueId = nextQ;
            }
            const nextRot = hlNormalizeRotationDeg(candidate.rot);
            const nextHidden = Boolean(candidate.hidden);
            const dims = hlGetRotatedDimensions(item.baseW, item.baseH, nextRot);
            if (item.rot !== dims.rot || item.hidden !== nextHidden || item.w !== dims.w || item.h !== dims.h) {
                changed = true;
            }
            item.rot = dims.rot;
            item.w = dims.w;
            item.h = dims.h;
            item.hidden = nextHidden;
        }
    }

    for (const item of room.items) {
        const candidate = savedMap[item.id];
        if (item.hidden) {
            if (candidate && Number.isInteger(candidate.col) && Number.isInteger(candidate.row)) {
                const hCol = Math.max(0, Math.min(room.gridW - item.w, candidate.col));
                const hRow = Math.max(0, Math.min(room.gridH - item.h, candidate.row));
                if (item.col !== hCol || item.row !== hRow) changed = true;
                item.col = hCol;
                item.row = hRow;
            }
            accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: true });
            continue;
        }

        if (candidate && Number.isInteger(candidate.col) && Number.isInteger(candidate.row)) {
            const cCol = Math.max(0, Math.min(room.gridW - item.w, candidate.col));
            const cRow = Math.max(0, Math.min(room.gridH - item.h, candidate.row));
            const wallBlocked = room.quadrants && hlStraddlesQuadrantWall(room, cCol, cRow, item.w, item.h);
            if (!wallBlocked && hlCanPlaceItem(room, item.id, cCol, cRow, item.w, item.h, accepted)) {
                if (item.col !== cCol || item.row !== cRow) changed = true;
                accepted.push({ id: item.id, col: cCol, row: cRow, w: item.w, h: item.h, hidden: false });
                continue;
            }
        }
        if (hlCanPlaceItem(room, item.id, item.col, item.row, item.w, item.h, accepted)) {
            accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: false });
        } else {
            const fallback = hlFindFreePlacementInRoom(room, item, accepted);
            if (fallback) {
                changed = true;
                accepted.push({ id: item.id, col: fallback.col, row: fallback.row, w: item.w, h: item.h, hidden: false });
            } else {
                accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: false });
            }
        }
    }

    const finalPositions = [];
    for (const entry of accepted) {
        if (entry.hidden) {
            finalPositions.push(entry);
            continue;
        }
        if (hlCanPlaceItem(room, entry.id, entry.col, entry.row, entry.w, entry.h, finalPositions)) {
            finalPositions.push(entry);
        } else {
            const orig = room.items.find(i => i.id === entry.id);
            if (orig && hlCanPlaceItem(room, orig.id, orig.col, orig.row, orig.w, orig.h, finalPositions)) {
                finalPositions.push({ id: orig.id, col: orig.col, row: orig.row, w: orig.w, h: orig.h, hidden: false });
            }
        }
    }

    if (finalPositions.length === room.items.length) {
        finalPositions.forEach(pos => {
            const target = room.items.find(i => i.id === pos.id);
            if (target) {
                if (target.col !== pos.col || target.row !== pos.row) changed = true;
                target.col = pos.col;
                target.row = pos.row;
            }
        });
    }
    return changed;
}

function hlGetCurrentLayoutPayload(room) {
    const payload = {};
    (room && Array.isArray(room.items) ? room.items : []).forEach(item => {
        const entry = { col: item.col, row: item.row };
        if (item.rot) entry.rot = item.rot;
        if (item.hidden) entry.hidden = true;
        if (item.color && (item.customStyled || item.isUserThing)) entry.color = item.color;
        if (item.shape && (item.customStyled || item.shape !== 'rect')) entry.shape = item.shape;
        if (item.customStyled && item.baseW) entry.baseW = item.baseW;
        if (item.customStyled && item.baseH) entry.baseH = item.baseH;
        if (item.queueId !== undefined) entry.queueId = Number(item.queueId) || 0;
        payload[item.id] = entry;
    });
    if (room && room.quadrantLayout && !room.dynamicRooms) {
        payload.__quadrantLayout = hlResolveQuadrantLayout(room.quadrantLayout);
    }
    return payload;
}

function hlGetItemLabel(item) {
    if (!item) return 'Предмет';
    if (item.el) {
        const svgLabel = item.el.querySelector && item.el.querySelector('.appliance-object')
            ? item.el.querySelector('.appliance-object').getAttribute('aria-label')
            : null;
        const caption = item.el.querySelector && item.el.querySelector('.house-thing-caption')
            ? item.el.querySelector('.house-thing-caption').textContent
            : null;
        if (svgLabel) return svgLabel;
        if (caption) return caption;
    }
    return item.label || item.name || item.id || 'Предмет';
}

const ITEM_TYPE_SEARCH_SYNONYMS = {
    bed: ['кровать', 'кроватка', 'ліжко', 'bed', 'beds', 'двуспальная', 'одноместная'],
    table: ['стол', 'столик', 'стіл', 'table', 'desk', 'угловой'],
    closet: ['шкаф', 'шкафчик', 'шафа', 'closet', 'wardrobe', 'cabinet'],
    sofa: ['диван', 'софа', 'sofa', 'couch'],
    armchair: ['кресло', 'крісло', 'armchair', 'chair'],
    fridge: ['холодильник', 'fridge', 'refrigerator'],
    stove: ['плита', 'печь', 'піч', 'stove', 'oven'],
    washer: ['стиралка', 'стиральная', 'washer', 'washing'],
    boiler: ['бойлер', 'boiler'],
    multicooker: ['мультиварка', 'multicooker'],
    laptop: ['ноутбук', 'компьютер', 'ноут', 'laptop', 'pc', 'computer'],
    tv: ['телевизор', 'телек', 'тв', 'tv', 'television'],
    router: ['роутер', 'маршрутизатор', 'router'],
    radiator: ['батарея', 'радиатор', 'radiator'],
    window: ['окно', 'вікно', 'window'],
    conditioner: ['кондиционер', 'кондей', 'conditioner']
};

function hlGetRoomQuadBounds(room, targetRoomObj, houseRecord) {
    if (!room || !targetRoomObj) return null;
    if (room.dynamicRooms && Array.isArray(room.dynamicRooms)) {
        const idx = room.dynamicRooms.findIndex(r => r && (r.id === targetRoomObj.id || String(r.name || '').toLowerCase() === String(targetRoomObj.name || '').toLowerCase()));
        if (idx === -1) return null;
        const rObj = room.dynamicRooms[idx];
        const slotIdx = (rObj && Number.isInteger(rObj.slotIndex)) ? rObj.slotIndex : idx;
        const colsPerSide = room.colsPerSide || Math.max(2, Math.round((room.gridW || 16) / 8));
        const qCol = slotIdx % colsPerSide;
        const qRow = Math.floor(slotIdx / colsPerSide);
        return { minCol: qCol * 8, maxCol: qCol * 8 + 7, minRow: qRow * 8, maxRow: qRow * 8 + 7 };
    }
    const rId = String(targetRoomObj.id || '').toLowerCase().replace(/^builtin_/, '');
    const rName = String(targetRoomObj.name || '').toLowerCase();
    let qKey = null;
    if (rId === 'kitchen' || rName.includes('кух')) qKey = 'kitchen';
    else if (rId === 'hall' || rName.includes('зал') || rName.includes('гостин')) qKey = 'hall';
    else if (rId === 'room' || rName.includes('комнат') || rName.includes('спальн')) qKey = 'room';
    else if (rId === 'corridor' || rName.includes('коридор')) qKey = 'corridor';
    if (!qKey) return null;
    const ql = hlResolveQuadrantLayout(room.quadrantLayout || (houseRecord && houseRecord.quadrantLayout));
    const coords = ql[qKey];
    if (!Array.isArray(coords) || coords.length !== 2) return null;
    return {
        minCol: coords[0] * 8,
        maxCol: coords[0] * 8 + 7,
        minRow: coords[1] * 8,
        maxRow: coords[1] * 8 + 7
    };
}

function hlIsItemInBounds(item, bounds) {
    if (!item || !bounds) return true;
    const c = Number(item.col) || 0;
    const r = Number(item.row) || 0;
    return c >= bounds.minCol && c <= bounds.maxCol && r >= bounds.minRow && r <= bounds.maxRow;
}

function hlInferQueryTypes(tokens) {
    const matched = new Set();
    tokens.forEach(tok => {
        for (const [tKey, words] of Object.entries(ITEM_TYPE_SEARCH_SYNONYMS)) {
            if (words.includes(tok)) matched.add(tKey);
        }
    });
    return matched;
}

const ARTICLE_PLURAL_NOUNS = new Set([
    'notes', 'houses', 'homes', 'rooms', 'things', 'items', 'objects', 'commands',
    'timers', 'buildings', 'tasks', 'aliases', 'missions', 'reports', 'issues',
    'users', 'logs', 'folders', 'directories', 'files', 'themes', 'languages',
    'accelerators', 'boosts', 'queues', 'cookies', 'sessions'
]);

const ARTICLE_UNCOUNTABLE_OR_UNIQUE = new Set([
    'history', 'trash', 'inventory', 'dashboard', 'status', 'profile', 'account',
    'support', 'last', 'main', 'home', 'terminal', 'console', 'admin', 'root',
    'dark', 'light', 'english', 'russian', 'ukrainian'
]);

const ARTICLE_FORBIDDEN_VERBS = new Set([
    'add', 'open', 'make', 'edit', 'pin', 'unpin', 'del', 'delete', 'rm', 'remove',
    'show', 'list', 'ls', 'read', 'cat', 'find', 'check', 'sync', 'refresh', 'update',
    'cancel', 'undo', 'rename', 'rotate', 'swap', 'move', 'hide', 'unhide', 'color',
    'shape', 'queue', 'finish', 'complete', 'done', 'take', 'resolve', 'close',
    'clear', 'cls', 'help', 'login', 'logout', 'exit', 'go', 'back', 'return',
    'select', 'set', 'switch', 'toggle', 'restore', 'create', 'write', 'mkdir',
    'whoami', 'date', 'time', 'calc', 'ping', 'echo'
]);

function startsWithEnglishVowelSound(word) {
    const w = String(word || '').toLowerCase().replace(/^[^a-z]+/, '');
    if (!w) return false;
    // Consonant /j/ or /w/ sound despite vowel spelling
    if (/^(?:user|users|use|used|using|unit|units|uni|uniform|unique|union|universe|university|utility|ukulele|euro|eulogy|one|once)/.test(w)) {
        return false;
    }
    // Silent 'h' -> vowel sound
    if (/^(?:hour|hours|honor|honour|honest|heir|herb)/.test(w)) {
        return true;
    }
    return /^[aeiou]/.test(w);
}

function isValidEnglishArticlePair(article, nextWord, restWords = []) {
    const art = String(article || '').toLowerCase().trim();
    const w = String(nextWord || '').toLowerCase().trim();
    if (!art || !w) return false;
    if (!['a', 'an', 'the'].includes(art)) return false;

    // Never strip/accept articles before verbs or numeric-only tokens
    if (ARTICLE_FORBIDDEN_VERBS.has(w) || /^\d+$/.test(w)) return false;

    const secondWord = String((Array.isArray(restWords) && restWords[0]) || '').toLowerCase().trim();
    const isNumberedEntity = Boolean(secondWord && /^\d+$/.test(secondWord));

    if (art === 'the') {
        return true;
    }

    // For indefinite articles 'a' and 'an':
    // Never valid before plurals, uncountable/unique nouns, or numbered entities like "a house 2" / "an item 3"
    if (ARTICLE_PLURAL_NOUNS.has(w)) return false;
    if (ARTICLE_UNCOUNTABLE_OR_UNIQUE.has(w)) return false;
    if (isNumberedEntity) return false;

    const vowelSound = startsWithEnglishVowelSound(w);
    if (art === 'an') return vowelSound;
    if (art === 'a') return !vowelSound;
    return false;
}

function stripLeadingValidArticle(text, opts = {}) {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    const tokens = raw.split(/\s+/);
    if (tokens.length < 2) return raw;
    const firstLower = tokens[0].toLowerCase();
    if (!['a', 'an', 'the'].includes(firstLower)) return raw;

    // Allow 'the' even for custom/non-ASCII names like "the Чапаева" or "the Кровать 2" when structural
    const nextTok = tokens[1];
    const hasLatinWord = /[a-z]/i.test(nextTok);
    if (!hasLatinWord) {
        if (firstLower === 'the' && opts.allowTheBeforeAny !== false && !/^\d+$/.test(nextTok)) {
            return tokens.slice(1).join(' ').trim();
        }
        return raw;
    }

    if (isValidEnglishArticlePair(firstLower, nextTok, tokens.slice(2))) {
        return tokens.slice(1).join(' ').trim();
    }
    return raw;
}

if (typeof window !== 'undefined') {
    window.isValidEnglishArticlePair = isValidEnglishArticlePair;
    window.stripLeadingValidArticle = stripLeadingValidArticle;
}

function parseMakeSizeArgs(rawArgs) {
    let str = String(rawArgs || '').trim();
    if (!str) return null;

    // 1. Выделяем размер в конце после equal / equals / = / to / is (или просто <X>x<Y> в конце)
    let sizeRaw = '';
    let left = str;
    const eqMatch = str.match(/^(.*?)\s+(?:equal(?:\s+to)?|equals|=|to|is|равно|рівно)\s+([^\s]+(?:\s+[^\s]+)?)\s*$/i);
    if (eqMatch) {
        left = eqMatch[1].trim();
        sizeRaw = eqMatch[2].trim();
    } else {
        const inlineEq = str.match(/^(.*?)\s*=\s*([^\s]+(?:\s+[^\s]+)?)\s*$/);
        if (inlineEq) {
            left = inlineEq[1].trim();
            sizeRaw = inlineEq[2].trim();
        } else {
            const tailSize = str.match(/^(.*?)\s+([1-8]\s*[*xх×]\s*[1-8])\s*$/i);
            if (tailSize) {
                left = tailSize[1].trim();
                sizeRaw = tailSize[2].trim();
            }
        }
    }

    if (!sizeRaw) return null;

    // 2. Разделяем left по ключевым фразам комнаты и дома (в любом порядке, включая артикли a/the)
    const markers = [];
    const markerRe = /(?:^|\s)(in\s+(?:the|a)\s+room|in\s+room|of\s+(?:the|a)\s+room|of\s+room|в\s+комнате|в\s+кімнаті|of\s+(?:the|a)\s+house|of\s+house|in\s+(?:the|a)\s+house|in\s+house|of\s+(?:the|a)\s+home|of\s+home|in\s+(?:the|a)\s+home|in\s+home|дома|в\s+доме)(?=\s|$)/gi;
    let m;
    while ((m = markerRe.exec(left)) !== null) {
        const fullMatch = m[0];
        const phraseStart = m.index + (fullMatch.length - fullMatch.trimStart().length);
        const phraseEnd = m.index + fullMatch.length;
        const kind = /room|комнат|кімнат/i.test(m[1]) ? 'room' : 'house';
        markers.push({ kind, start: phraseStart, end: phraseEnd });
    }

    let itemRef = '';
    let roomRef = '';
    let houseRef = '';

    if (markers.length === 0) {
        itemRef = left.trim();
    } else {
        itemRef = left.slice(0, markers[0].start).trim();
        for (let i = 0; i < markers.length; i++) {
            const cur = markers[i];
            const nextStart = (i + 1 < markers.length) ? markers[i + 1].start : left.length;
            const segmentVal = left.slice(cur.end, nextStart).trim();
            if (cur.kind === 'room' && !roomRef) roomRef = segmentVal;
            if (cur.kind === 'house' && !houseRef) houseRef = segmentVal;
        }
    }

    itemRef = itemRef.replace(/^(?:of|for)\s+/i, '').trim();
    itemRef = stripLeadingValidArticle(itemRef);
    roomRef = stripLeadingValidArticle(roomRef);
    houseRef = stripLeadingValidArticle(houseRef);
    return { itemRef, roomRef, houseRef, sizeRaw };
}

function hlResolveItemInRoom(room, itemRef, targetRoomObj = null, houseRecord = null) {
    if (!room || !Array.isArray(room.items) || !itemRef) return null;
    const raw = String(itemRef || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    const bounds = targetRoomObj ? hlGetRoomQuadBounds(room, targetRoomObj, houseRecord) : null;
    const pool = bounds ? room.items.filter(i => hlIsItemInBounds(i, bounds)) : room.items;
    if (!pool.length) return null;

    // 1) Точный ID
    let match = pool.find(i => String(i.id || '').toLowerCase() === lower);
    if (match) return match;

    // 2) Точное имя или label
    match = pool.find(i => hlGetItemLabel(i).toLowerCase() === lower || String(i.name || '').toLowerCase() === lower);
    if (match) return match;

    // 3) Прямая подстрока
    match = pool.find(i =>
        String(i.id || '').toLowerCase().includes(lower) ||
        hlGetItemLabel(i).toLowerCase().includes(lower) ||
        String(i.name || '').toLowerCase().includes(lower)
    );
    if (match) return match;

    // 4) Умное сопоставление по токенам, синонимам типов, цвету и цифровому индексу (напр. "Кровать 2" -> bed2)
    const tokens = lower.split(/[\s,._-]+/).filter(Boolean);
    const numTokens = tokens.filter(t => /^\d+$/.test(t));
    const wordTokens = tokens.filter(t => !/^\d+$/.test(t));
    const queryTypes = hlInferQueryTypes(wordTokens);
    const queryColor = parseThingColorInput(lower);

    let bestItem = null;
    let bestScore = 0;

    pool.forEach(item => {
        const idStr = String(item.id || '').toLowerCase();
        const labelStr = hlGetItemLabel(item).toLowerCase();
        const nameStr = String(item.name || '').toLowerCase();
        const combined = `${idStr} ${labelStr} ${nameStr}`;
        const itemType = String(item.thingType || inferBuiltinThingType(item.id) || '').toLowerCase();

        let score = 0;
        let matchedMeaning = false;

        if (queryTypes.size > 0 && queryTypes.has(itemType)) {
            score += 40;
            matchedMeaning = true;
        }
        if (queryColor && (String(item.color || '').toLowerCase() === queryColor || combined.includes(queryColor))) {
            score += 25;
            matchedMeaning = true;
        }
        wordTokens.forEach(wt => {
            if (wt.length >= 2 && combined.includes(wt)) {
                score += 20;
                matchedMeaning = true;
            }
        });
        numTokens.forEach(nt => {
            if (combined.includes(nt)) {
                score += 15;
            }
        });

        if (matchedMeaning && score > bestScore) {
            bestScore = score;
            bestItem = item;
        }
    });

    return bestItem;
}

function hlLoadHeadlessHouseRoom(user, houseRecord) {
    if (!user || !houseRecord) return null;
    const uid = String(user.id || '').trim();
    if (!uid || uid === 'guest') return null;

    const blueprint = houseRecord.builtin ? BUILTIN_HOUSE_BLUEPRINTS[houseRecord.id] : null;
    const roomId = (blueprint && blueprint.id) || houseRecord.roomId || `${houseRecord.id}_square`;
    const baseStorageKey = (blueprint && blueprint.storageKey) || `room_layout_${roomId}_v1`;
    const baseTsKey = (blueprint && blueprint.tsKey) || `${baseStorageKey}_ts`;
    const scopedStorageKey = `${baseStorageKey}::${uid}`;
    const scopedTsKey = `${baseTsKey}::${uid}`;

    const geom = getRoomsForHouseGridGeometry(houseRecord);
    const items = [];

    if (blueprint && Array.isArray(blueprint.items)) {
        blueprint.items.forEach(spec => {
            items.push({
                id: spec.id,
                thingType: spec.thingType || inferBuiltinThingType(spec.id),
                label: spec.label,
                color: spec.color || null,
                shape: spec.shape || 'rect',
                baseW: spec.w,
                baseH: spec.h,
                w: spec.w,
                h: spec.h,
                rot: 0,
                hidden: false,
                col: spec.col,
                row: spec.row
            });
        });
    }

    const userThings = Array.isArray(houseRecord.things) ? houseRecord.things : [];
    userThings.forEach(t => {
        const bw = Number(t.w) || 2;
        const bh = Number(t.h) || 2;
        const rot = hlNormalizeRotationDeg(t.rot || 0);
        const dims = hlGetRotatedDimensions(bw, bh, rot);
        items.push({
            id: t.id,
            isUserThing: true,
            thingType: t.type || inferBuiltinThingType(t.id),
            name: t.name,
            label: t.label || t.name,
            color: t.color || null,
            shape: t.shape || 'rect',
            queueId: Number(t.queueId) || 0,
            baseW: bw,
            baseH: bh,
            w: dims.w,
            h: dims.h,
            rot: dims.rot,
            hidden: Boolean(t.hidden),
            col: Number(t.col) || 0,
            row: Number(t.row) || 0
        });
    });

    const room = {
        id: roomId,
        storageKey: scopedStorageKey,
        tsKey: scopedTsKey,
        quadrants: blueprint ? blueprint.quadrants : (Array.isArray(houseRecord.rooms) && houseRecord.rooms.length > 0),
        quadrantLayout: hlResolveQuadrantLayout(houseRecord.quadrantLayout || (blueprint && blueprint.quadrantLayout)),
        dynamicRooms: !houseRecord.builtin && Array.isArray(houseRecord.rooms) ? houseRecord.rooms : null,
        colsPerSide: blueprint ? blueprint.colsPerSide : geom.colsPerSide,
        rowsPerSide: blueprint ? blueprint.rowsPerSide : geom.rowsPerSide,
        gridW: blueprint ? blueprint.gridW : geom.gridW,
        gridH: blueprint ? blueprint.gridH : geom.gridH,
        items
    };
    items.forEach(it => { it.room = room; });

    try {
        const rawSaved = localStorage.getItem(scopedStorageKey);
        if (rawSaved) {
            const parsed = JSON.parse(rawSaved);
            if (parsed && typeof parsed === 'object') {
                hlApplyLayoutMap(room, parsed);
            }
        }
    } catch (e) {}

    return room;
}

function hlSaveRoomLayoutLocalOnly(user, room, customTs = null) {
    try {
        if (!user || user.isGuest || !user.id || user.id === 'guest') return null;
        if (!room || !room.storageKey || !room.tsKey) return null;
        const payload = hlGetCurrentLayoutPayload(room);
        localStorage.setItem(room.storageKey, JSON.stringify(payload));
        localStorage.setItem(room.tsKey, String(customTs !== null ? customTs : Date.now()));
        return payload;
    } catch (e) {
        return null;
    }
}

async function hlPersistRoomLayout(user, houseRecord, room, options = {}) {
    if (!user || user.isGuest || !user.id || user.id === 'guest' || !room) {
        return { payload: null, synced: false };
    }
    const nowTs = (options && options.customTs) ? Number(options.customTs) : Date.now();
    const payload = hlSaveRoomLayoutLocalOnly(user, room, nowTs);
    if (!payload) return { payload: null, synced: false };

    const asyncCloud = Boolean(options && options.asyncCloud);
    const promises = [];

    if (window.HouseLayoutSync && typeof window.HouseLayoutSync.saveAndSyncHouseLayout === 'function') {
        promises.push(window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, payload, user, nowTs));
    }
    if (houseRecord && window.UserHousesSync && typeof window.UserHousesSync.updateThingPositionsFromLayout === 'function') {
        const res = window.UserHousesSync.updateThingPositionsFromLayout(user, houseRecord.id, payload, asyncCloud);
        if (res && typeof res.then === 'function') promises.push(res);
    }

    if (asyncCloud || promises.length === 0) {
        return { payload, synced: typeof navigator === 'undefined' || navigator.onLine !== false };
    }
    try {
        await Promise.all(promises);
        return { payload, synced: typeof navigator === 'undefined' || navigator.onLine !== false };
    } catch (e) {
        return { payload, synced: false };
    }
}

window.HouseLayoutEngine = {
    DOOR_WIDTH_TILES: HOUSE_DOOR_WIDTH_TILES,
    BUILTIN_HOUSE_BLUEPRINTS,
    normalizeRotationDeg: hlNormalizeRotationDeg,
    getRotatedDimensions: hlGetRotatedDimensions,
    rectanglesOverlap: hlRectanglesOverlap,
    canItemPassThroughDoor: hlCanItemPassThroughDoor,
    straddlesQuadrantWall: hlStraddlesQuadrantWall,
    getItemQuadrant: hlGetItemQuadrant,
    canPlaceItem: hlCanPlaceItem,
    canMoveItemTo: hlCanMoveItemTo,
    findFreePlacementInRoom: hlFindFreePlacementInRoom,
    findRotationSpot: hlFindRotationSpot,
    applyLayoutMap: hlApplyLayoutMap,
    getCurrentLayoutPayload: hlGetCurrentLayoutPayload,
    getItemLabel: hlGetItemLabel,
    resolveItemInRoom: hlResolveItemInRoom,
    loadHeadlessHouseRoom: hlLoadHeadlessHouseRoom,
    saveRoomLayoutLocalOnly: hlSaveRoomLayoutLocalOnly,
    persistRoomLayout: hlPersistRoomLayout
};

// =========================================================================
// Запоминание последней открытой страницы для команды Continue
// =========================================================================
const LAST_PAGE_LOCAL_KEY = 'terminal_last_page_v1';
const LAST_PAGE_PENDING_KEY = 'terminal_last_page_pending_v1';
let lastPageFlushPromise = null;

function describeTrackablePage(pathname, search = '', hash = '') {
    const cleanPath = String(pathname || '').toLowerCase();
    const fullUrl = `${pathname}${search || ''}${hash || ''}`;

    if (cleanPath === '/dashboard.html') {
        const qp = new URLSearchParams(search || '');
        const q = qp.get('queue');
        return { path: fullUrl, title: q ? `🎛️ Дашборд (Постройка #${q})` : '🎛️ Дашборд' };
    }
    if (cleanPath === '/missions.html') {
        return { path: '/missions.html', title: '📋 Задания' };
    }
    if (cleanPath === '/house' || cleanPath === '/house/' || cleanPath === '/house/index.html') {
        const qp = new URLSearchParams(search || '');
        const hParam = qp.get('house');
        if (hParam) {
            return { path: `/house/index.html?house=${encodeURIComponent(hParam)}${hash || ''}`, title: `🏠 ${hParam}` };
        }
        return { path: `/house/index.html${hash || ''}`, title: '🏠 Дом 1' };
    }
    if (cleanPath === '/house2' || cleanPath === '/house2/' || cleanPath === '/house2/index.html') {
        return { path: `/house2/index.html${hash || ''}`, title: '🏡 Дом 2' };
    }
    if (cleanPath === '/house3' || cleanPath === '/house3/' || cleanPath === '/house3/index.html') {
        return { path: `/house3/index.html${hash || ''}`, title: '🏘️ Дом 3' };
    }
    if (cleanPath === '/kitchen.html') {
        return { path: '/house/index.html#kitchen', title: '🍳 Кухня — Дом 1' };
    }
    if (cleanPath === '/hall.html') {
        return { path: '/house/index.html#hall', title: '🛋️ Зал — Дом 1' };
    }
    return null;
}

function getLocalLastPage() {
    try {
        const raw = localStorage.getItem(LAST_PAGE_LOCAL_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.path) return parsed;
    } catch (e) {}
    return null;
}

function saveLocalLastPage(entry) {
    try {
        if (entry && entry.path) {
            localStorage.setItem(LAST_PAGE_LOCAL_KEY, JSON.stringify(entry));
        }
    } catch (e) {}
}

async function flushPendingLastPage() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (!window.supabaseClient) return false;
    if (lastPageFlushPromise) return lastPageFlushPromise;

    lastPageFlushPromise = (async () => {
        try {
            let pending = null;
            try {
                const raw = localStorage.getItem(LAST_PAGE_PENDING_KEY);
                pending = raw ? JSON.parse(raw) : null;
            } catch (e) {}
            if (!pending || !pending.path) return false;

            const user = await resolveAuthenticatedDbUser();
            if (!user) return false;

            const updatedAt = pending.updatedAt || new Date(pending.ts || Date.now()).toISOString();
            const payloadParams = {
                path: pending.path,
                title: pending.title || pending.path,
                updated_at: updatedAt,
                ts: Number(pending.ts || Date.now())
            };

            const { data: existingRows, error: selErr } = await window.supabaseClient
                .from('commands_history')
                .select('id')
                .eq('created_by', user.id)
                .eq('command', '__last_page__')
                .eq('raw_text', '__last_page__')
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (selErr && isOfflineNetworkError(selErr)) throw selErr;

            let savedOk = false;
            if (!selErr && existingRows && existingRows[0] && existingRows[0].id) {
                const { data: updData, error: updErr } = await window.supabaseClient
                    .from('commands_history')
                    .update({
                        parameters: payloadParams,
                        output: pending.path,
                        created_at: updatedAt
                    })
                    .eq('id', existingRows[0].id)
                    .select('id');
                if (!updErr && updData && updData.length > 0) {
                    savedOk = true;
                }
            }

            if (!savedOk) {
                const { error: insErr } = await window.supabaseClient
                    .from('commands_history')
                    .insert([{
                        raw_text: '__last_page__',
                        command: '__last_page__',
                        parameters: payloadParams,
                        output: pending.path,
                        result: 'OK',
                        status: 'success',
                        created_at: updatedAt,
                        created_by: user.id
                    }]);
                if (!insErr) savedOk = true;
            }

            if (savedOk) {
                try {
                    const cur = JSON.parse(localStorage.getItem(LAST_PAGE_PENDING_KEY) || 'null');
                    if (cur && Number(cur.ts || 0) <= Number(pending.ts || 0)) {
                        localStorage.removeItem(LAST_PAGE_PENDING_KEY);
                    }
                } catch (e) {}
            }
            return savedOk;
        } catch (e) {
            return false;
        } finally {
            lastPageFlushPromise = null;
        }
    })();

    return lastPageFlushPromise;
}

function trackCurrentPage(customPath = null, customTitle = null) {
    if (typeof window === 'undefined' || !window.location) return null;
    const info = customPath
        ? { path: String(customPath), title: String(customTitle || customPath) }
        : describeTrackablePage(window.location.pathname, window.location.search, window.location.hash);

    if (!info || !info.path) return null;

    const nowMs = Date.now();
    const entry = {
        path: info.path,
        title: info.title,
        ts: nowMs,
        updatedAt: new Date(nowMs).toISOString()
    };
    saveLocalLastPage(entry);
    try {
        localStorage.setItem(LAST_PAGE_PENDING_KEY, JSON.stringify(entry));
    } catch (e) {}

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        flushPendingLastPage().catch(() => {});
    }
    return entry;
}

async function fetchRemoteLastPage() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    if (!window.supabaseClient) return null;
    try {
        const user = await resolveAuthenticatedDbUser();
        if (!user) return null;

        const { data: rows, error } = await window.supabaseClient
            .from('commands_history')
            .select('parameters, created_at')
            .eq('created_by', user.id)
            .eq('command', '__last_page__')
            .eq('raw_text', '__last_page__')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1);

        if (!error && rows && rows[0] && rows[0].parameters && rows[0].parameters.path) {
            const p = rows[0].parameters;
            const updatedAt = p.updated_at || rows[0].created_at || null;
            const ts = Number(p.ts) || (updatedAt ? new Date(updatedAt).getTime() : 0);
            return {
                path: p.path,
                title: p.title || p.path,
                ts,
                updatedAt
            };
        }
    } catch (e) {}
    return null;
}

async function getBestLastPage() {
    const local = getLocalLastPage();
    const remote = await fetchRemoteLastPage();
    if (!local && !remote) return null;
    if (local && !remote) return local;
    if (!local && remote) {
        saveLocalLastPage(remote);
        return remote;
    }
    const localTs = Number(local.ts || (local.updatedAt ? new Date(local.updatedAt).getTime() : 0));
    const remoteTs = Number(remote.ts || (remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0));
    if (remoteTs > localTs) {
        saveLocalLastPage(remote);
        return remote;
    }
    return local;
}

window.LastPageSync = {
    trackCurrentPage,
    getLocalLastPage,
    fetchRemoteLastPage,
    getBestLastPage,
    flushPendingLastPage,
    describeTrackablePage
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const autoTrackIfApplicable = () => {
        const cleanPath = String(window.location.pathname || '').toLowerCase();
        const isHousePath = cleanPath.startsWith('/house') || cleanPath === '/kitchen.html' || cleanPath === '/hall.html';
        if (isHousePath) return; // Дома отслеживаются только после подтверждения авторизации и владельца в house-engine.js
        if (describeTrackablePage(window.location.pathname, window.location.search, window.location.hash)) {
            trackCurrentPage();
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoTrackIfApplicable);
    } else {
        autoTrackIfApplicable();
    }
    window.addEventListener('hashchange', autoTrackIfApplicable);
}

// =========================================================================
// Обращения в поддержку (Support / Issue Reports + уведомления админа)
// =========================================================================
const SUPPORT_REPORTS_LOCAL_KEY = 'terminal_support_reports_v1';
const SUPPORT_REPORTS_PENDING_KEY = 'terminal_pending_support_reports_v1';
const SUPPORT_REPORTS_PENDING_UPDATES_KEY = 'terminal_pending_support_report_updates_v1';
const SUPPORT_ADMIN_SEEN_KEY = 'terminal_admin_seen_support_ids_v1';
let supportReportsFlushPromise = null;
let supportReportUpdatesFlushPromise = null;
let supportReportsTableMissing = false;
let supportRealtimeChannel = null;

function normalizeSupportStatus(rawStatus) {
    const s = String(rawStatus || '').trim().toLowerCase();
    if (s === 'resolved' || s === 'completed' || s === 'closed' || s === 'done') return 'resolved';
    if (s === 'in_review' || s === 'in_progress' || s === 'review' || s === 'taken' || s === 'pending_review') return 'in_review';
    return 'open';
}

function getSupportStatusRank(status) {
    const norm = normalizeSupportStatus(status);
    if (norm === 'resolved') return 3;
    if (norm === 'in_review') return 2;
    return 1;
}

function getLocalSupportReports() {
    try {
        const raw = localStorage.getItem(SUPPORT_REPORTS_LOCAL_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveLocalSupportReports(list) {
    try {
        localStorage.setItem(SUPPORT_REPORTS_LOCAL_KEY, JSON.stringify(list || []));
    } catch (e) {}
}

function getPendingSupportReports() {
    try {
        const raw = localStorage.getItem(SUPPORT_REPORTS_PENDING_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingSupportReports(list) {
    try {
        localStorage.setItem(SUPPORT_REPORTS_PENDING_KEY, JSON.stringify(list || []));
    } catch (e) {}
}

function getPendingSupportReportUpdates() {
    try {
        const raw = localStorage.getItem(SUPPORT_REPORTS_PENDING_UPDATES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingSupportReportUpdates(list) {
    try {
        localStorage.setItem(SUPPORT_REPORTS_PENDING_UPDATES_KEY, JSON.stringify(list || []));
    } catch (e) {}
}

function getAdminSeenSupportIds() {
    try {
        const raw = localStorage.getItem(SUPPORT_ADMIN_SEEN_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function markAdminSeenSupportIds(ids) {
    try {
        const set = new Set([...getAdminSeenSupportIds(), ...(ids || []).map(String)]);
        localStorage.setItem(SUPPORT_ADMIN_SEEN_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
}

function normalizeSupportReportRow(row) {
    if (!row) return null;
    const p = (row.parameters && typeof row.parameters === 'object') ? row.parameters : null;
    if (p && p.type === 'support_report') {
        const reportId = String(p.report_id || row.id || p.inner_id || '');
        return {
            id: reportId,
            inner_id: Number(p.inner_id || row.inner_id || 0) || null,
            user_id: p.user_id || row.created_by || 'guest',
            user_email: p.user_email || row.output || 'unknown@local',
            user_name: p.user_name || '',
            message: p.message || '',
            status: normalizeSupportStatus(p.status),
            review_note: p.review_note || '',
            taken_by: p.taken_by || '',
            taken_at: p.taken_at || null,
            resolved_by: p.resolved_by || '',
            resolved_at: p.resolved_at || null,
            updated_at: p.updated_at || p.created_at || row.created_at || null,
            created_at: p.created_at || row.created_at || new Date().toISOString()
        };
    }
    return {
        id: String(row.id || row.report_id || row.inner_id || ''),
        inner_id: Number(row.inner_id || 0) || null,
        user_id: row.user_id || row.created_by || 'guest',
        user_email: row.user_email || 'unknown@local',
        user_name: row.user_name || '',
        message: row.message || '',
        status: normalizeSupportStatus(row.status),
        review_note: row.review_note || '',
        taken_by: row.taken_by || '',
        taken_at: row.taken_at || null,
        resolved_by: row.resolved_by || '',
        resolved_at: row.resolved_at || null,
        updated_at: row.updated_at || row.created_at || null,
        created_at: row.created_at || new Date().toISOString()
    };
}

function applyReportUpdateFields(target, update) {
    if (!target || !update) return target;
    const curUpdMs = target.updated_at ? new Date(target.updated_at).getTime() : 0;
    const newUpdMs = update.updated_at ? new Date(update.updated_at).getTime() : 0;
    const curRank = getSupportStatusRank(target.status);
    const newRank = getSupportStatusRank(update.status);

    if (newUpdMs >= curUpdMs || newRank > curRank) {
        if (update.status) target.status = normalizeSupportStatus(update.status);
        if (update.review_note !== undefined && update.review_note !== null && String(update.review_note).trim() !== '') {
            target.review_note = String(update.review_note).trim();
        }
        if (update.taken_by) target.taken_by = update.taken_by;
        if (update.taken_at) target.taken_at = update.taken_at;
        if (update.resolved_by) target.resolved_by = update.resolved_by;
        if (update.resolved_at) target.resolved_at = update.resolved_at;
        if (update.updated_at) target.updated_at = update.updated_at;
    }
    if (!target.inner_id && update.inner_id) target.inner_id = Number(update.inner_id);
    return target;
}

async function flushPendingSupportReports() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;
    if (supportReportsFlushPromise) return supportReportsFlushPromise;

    supportReportsFlushPromise = (async () => {
        try {
            const pending = getPendingSupportReports();
            if (!pending || pending.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') return 0;

            let flushedCount = 0;
            const remaining = [];
            let networkFailed = false;

            for (const entry of pending) {
                if (networkFailed) {
                    remaining.push(entry);
                    continue;
                }
                let savedOk = false;

                if (!supportReportsTableMissing) {
                    try {
                        const { error } = await window.supabaseClient
                            .from('support_reports')
                            .insert([{
                                id: entry.id,
                                user_id: entry.user_id && entry.user_id !== 'guest' ? entry.user_id : user.id,
                                user_email: entry.user_email || user.email,
                                user_name: entry.user_name || user.name || '',
                                message: entry.message,
                                status: normalizeSupportStatus(entry.status),
                                created_at: entry.created_at
                            }]);
                        if (!error) {
                            savedOk = true;
                        } else if (isMissingTableError(error)) {
                            supportReportsTableMissing = true;
                        } else if (isOfflineNetworkError(error)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    }
                }

                if (!savedOk) {
                    try {
                        const { error: histErr } = await window.supabaseClient
                            .from('commands_history')
                            .insert([{
                                raw_text: `__support_report__:${entry.id}`,
                                command: '__support_report__',
                                parameters: {
                                    type: 'support_report',
                                    report_id: entry.id,
                                    inner_id: entry.inner_id,
                                    user_id: entry.user_id && entry.user_id !== 'guest' ? entry.user_id : user.id,
                                    user_email: entry.user_email || user.email,
                                    user_name: entry.user_name || user.name || '',
                                    message: entry.message,
                                    status: normalizeSupportStatus(entry.status),
                                    review_note: entry.review_note || '',
                                    taken_by: entry.taken_by || '',
                                    taken_at: entry.taken_at || null,
                                    resolved_by: entry.resolved_by || '',
                                    resolved_at: entry.resolved_at || null,
                                    updated_at: entry.updated_at || entry.created_at,
                                    created_at: entry.created_at
                                },
                                output: entry.user_email || user.email,
                                result: 'SUPPORT_REPORT',
                                status: 'success',
                                created_at: entry.created_at,
                                created_by: user.id
                            }]);
                        if (!histErr) {
                            savedOk = true;
                        } else if (isOfflineNetworkError(histErr)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        } else {
                            console.warn('Support report DB save error:', histErr.message);
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    }
                }

                if (savedOk) flushedCount++;
            }

            const currentPending = getPendingSupportReports();
            const processedIds = new Set(pending.map(p => p.id));
            const newlyAdded = currentPending.filter(p => !processedIds.has(p.id));
            savePendingSupportReports([...remaining, ...newlyAdded]);
            return flushedCount;
        } catch (err) {
            if (!isOfflineNetworkError(err)) {
                console.warn('flushPendingSupportReports error:', err);
            }
            return 0;
        } finally {
            supportReportsFlushPromise = null;
        }
    })();

    return supportReportsFlushPromise;
}

async function flushPendingSupportReportUpdates() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;
    if (supportReportUpdatesFlushPromise) return supportReportUpdatesFlushPromise;

    supportReportUpdatesFlushPromise = (async () => {
        try {
            const pending = getPendingSupportReportUpdates();
            if (!pending || pending.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') return 0;

            let flushedCount = 0;
            const remaining = [];
            let networkFailed = false;

            for (const entry of pending) {
                if (networkFailed) {
                    remaining.push(entry);
                    continue;
                }
                let savedOk = false;

                if (!supportReportsTableMissing) {
                    try {
                        const { error } = await window.supabaseClient
                            .from('support_reports')
                            .update({ status: normalizeSupportStatus(entry.status) })
                            .eq('id', entry.report_id);
                        if (!error) {
                            // Таблице support_reports может не хватать доп. колонок, поэтому всё равно пишем в commands_history ниже
                        } else if (isMissingTableError(error)) {
                            supportReportsTableMissing = true;
                        } else if (isOfflineNetworkError(error)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    }
                }

                try {
                    const { error: histErr } = await window.supabaseClient
                        .from('commands_history')
                        .insert([{
                            raw_text: `__support_report_update__:${entry.report_id}`,
                            command: '__support_report_update__',
                            parameters: {
                                type: 'support_report_update',
                                report_id: entry.report_id,
                                inner_id: entry.inner_id || null,
                                status: normalizeSupportStatus(entry.status),
                                review_note: entry.review_note || '',
                                taken_by: entry.taken_by || '',
                                taken_at: entry.taken_at || null,
                                resolved_by: entry.resolved_by || '',
                                resolved_at: entry.resolved_at || null,
                                updated_at: entry.updated_at || new Date().toISOString()
                            },
                            output: `Issue #${entry.inner_id || entry.report_id}: ${entry.status}`,
                            result: 'SUPPORT_REPORT_UPDATE',
                            status: 'success',
                            created_at: entry.updated_at || new Date().toISOString(),
                            created_by: user.id
                        }]);
                    if (!histErr) {
                        savedOk = true;
                    } else if (isOfflineNetworkError(histErr)) {
                        networkFailed = true;
                        remaining.push(entry);
                        continue;
                    } else {
                        console.warn('Support report update DB save error:', histErr.message);
                    }
                } catch (e) {
                    if (isOfflineNetworkError(e)) {
                        networkFailed = true;
                        remaining.push(entry);
                        continue;
                    }
                }

                if (savedOk) flushedCount++;
            }

            const currentPending = getPendingSupportReportUpdates();
            const processedIds = new Set(pending.map(p => p.updateId));
            const newlyAdded = currentPending.filter(p => !processedIds.has(p.updateId));
            savePendingSupportReportUpdates([...remaining, ...newlyAdded]);
            return flushedCount;
        } catch (err) {
            return 0;
        } finally {
            supportReportUpdatesFlushPromise = null;
        }
    })();

    return supportReportUpdatesFlushPromise;
}

async function submitSupportReport(message, currentUser, contactOverride = null) {
    const cleanMsg = String(message || '').trim();
    const cleanContact = contactOverride ? String(contactOverride).trim() : '';
    const existingReports = await fetchSupportReports(currentUser).catch(() => getLocalSupportReports());
    const maxInner = existingReports.reduce((m, r) => Math.max(m, Number(r.inner_id || 0)), 0);
    const reportId = 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const nowIso = new Date().toISOString();
    const userEmail = cleanContact || ((currentUser && currentUser.email) ? currentUser.email : 'guest@local');
    const userId = (currentUser && currentUser.id) ? currentUser.id : 'guest';
    const userName = cleanContact ? '' : ((currentUser && currentUser.name) ? currentUser.name : '');

    const report = {
        id: reportId,
        inner_id: maxInner + 1,
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        message: cleanMsg,
        status: 'open',
        review_note: '',
        taken_by: '',
        taken_at: null,
        resolved_by: '',
        resolved_at: null,
        updated_at: nowIso,
        created_at: nowIso
    };

    const localList = getLocalSupportReports();
    localList.unshift(report);
    saveLocalSupportReports(localList);

    const pending = getPendingSupportReports();
    pending.push(report);
    savePendingSupportReports(pending);

    let synced = false;
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (isOnline && window.supabaseClient && currentUser && !currentUser.isGuest && currentUser.id !== 'guest') {
        const count = await flushPendingSupportReports();
        const stillPending = getPendingSupportReports().some(r => r.id === reportId);
        synced = !stillPending && count >= 0;
    }

    return { report, synced };
}

async function fetchSupportReports(currentUser = null) {
    const byId = new Map();
    const updates = [];

    const mergeReport = (r) => {
        if (!r) return;
        const key = String(r.id || `${r.user_email}_${r.created_at}`);
        if (!byId.has(key)) {
            byId.set(key, { ...r });
        } else {
            applyReportUpdateFields(byId.get(key), r);
        }
    };

    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (isOnline && window.supabaseClient) {
        try {
            await flushPendingSupportReports();
            await flushPendingSupportReportUpdates();
        } catch (e) {}

        if (!supportReportsTableMissing) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('support_reports')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!error && Array.isArray(data)) {
                    data.map(normalizeSupportReportRow).forEach(mergeReport);
                } else if (error && isMissingTableError(error)) {
                    supportReportsTableMissing = true;
                }
            } catch (e) {}
        }

        try {
            const { data: histRows, error: histErr } = await window.supabaseClient
                .from('commands_history')
                .select('*')
                .in('command', ['__support_report__', '__support_report_update__'])
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(200);
            if (!histErr && Array.isArray(histRows)) {
                histRows.forEach(row => {
                    if (row.command === '__support_report__') {
                        mergeReport(normalizeSupportReportRow(row));
                    } else if (row.command === '__support_report_update__' && row.parameters) {
                        updates.push({
                            report_id: String(row.parameters.report_id || ''),
                            inner_id: Number(row.parameters.inner_id || 0) || null,
                            status: row.parameters.status,
                            review_note: row.parameters.review_note,
                            taken_by: row.parameters.taken_by,
                            taken_at: row.parameters.taken_at,
                            resolved_by: row.parameters.resolved_by,
                            resolved_at: row.parameters.resolved_at,
                            updated_at: row.parameters.updated_at || row.created_at
                        });
                    }
                });
            }
        } catch (e) {}
    }

    getLocalSupportReports().map(normalizeSupportReportRow).forEach(mergeReport);
    getPendingSupportReportUpdates().forEach(u => updates.push(u));

    const list = Array.from(byId.values());
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    list.forEach((item, idx) => {
        if (!item.inner_id) item.inner_id = list.length - idx;
    });

    // Сортируем обновления от старых к новым и применяем к соответствующим заявкам
    updates.sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime());
    updates.forEach(u => {
        const target = list.find(r =>
            (u.report_id && String(r.id) === String(u.report_id)) ||
            (u.inner_id && Number(r.inner_id) === Number(u.inner_id))
        );
        if (target) applyReportUpdateFields(target, u);
    });

    saveLocalSupportReports(list);
    return list;
}

async function fetchSupportReportsForAdmin(currentUser) {
    if (!isAdminUser(currentUser)) return [];
    return await fetchSupportReports(currentUser);
}

async function updateSupportReportStatus(innerIdOrId, nextStatus, currentUser, reviewNote = '') {
    const reports = await fetchSupportReports(currentUser);
    const numId = Number(innerIdOrId);
    const strId = String(innerIdOrId || '').trim();
    const target = reports.find(r =>
        (Number.isInteger(numId) && numId > 0 && Number(r.inner_id) === numId) ||
        String(r.id) === strId
    );
    if (!target) {
        return { ok: false, error: 'NOT_FOUND' };
    }

    const nowIso = new Date().toISOString();
    const normStatus = normalizeSupportStatus(nextStatus);
    const actor = (currentUser && (currentUser.email || currentUser.name)) || 'support';
    const cleanNote = String(reviewNote || '').trim();

    const updateEntry = {
        updateId: 'repupd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        report_id: String(target.id),
        inner_id: Number(target.inner_id),
        status: normStatus,
        review_note: cleanNote || target.review_note || '',
        taken_by: normStatus === 'in_review' ? actor : (target.taken_by || actor),
        taken_at: normStatus === 'in_review' ? (target.taken_at || nowIso) : (target.taken_at || nowIso),
        resolved_by: normStatus === 'resolved' ? actor : (target.resolved_by || ''),
        resolved_at: normStatus === 'resolved' ? nowIso : (target.resolved_at || null),
        updated_at: nowIso
    };

    applyReportUpdateFields(target, updateEntry);
    saveLocalSupportReports(reports);

    const pendingUpdates = getPendingSupportReportUpdates();
    pendingUpdates.push(updateEntry);
    savePendingSupportReportUpdates(pendingUpdates);

    let synced = false;
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (isOnline && window.supabaseClient && currentUser && !currentUser.isGuest && currentUser.id !== 'guest') {
        await flushPendingSupportReportUpdates();
        synced = !getPendingSupportReportUpdates().some(u => u.updateId === updateEntry.updateId);
    }

    return { ok: true, report: target, synced };
}

async function checkAndNotifyAdmin(currentUser, notifyFn) {
    if (!isAdminUser(currentUser) || typeof notifyFn !== 'function') return [];
    const reports = await fetchSupportReports(currentUser);
    if (!reports || reports.length === 0) return [];

    const seenSet = new Set(getAdminSeenSupportIds().map(String));
    const unseen = reports.filter(r => normalizeSupportStatus(r.status) === 'open' && !seenSet.has(String(r.id)));
    if (unseen.length > 0) {
        markAdminSeenSupportIds(unseen.map(r => String(r.id)));
        notifyFn(unseen, reports);
    }
    return unseen;
}

function subscribeRealtimeAdminNotifications(currentUser, onNewReport) {
    if (!isAdminUser(currentUser) || !window.supabaseClient || typeof window.supabaseClient.channel !== 'function') return;
    if (supportRealtimeChannel) return;

    try {
        supportRealtimeChannel = window.supabaseClient
            .channel('support-reports-admin-alerts')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'commands_history',
                filter: 'command=eq.__support_report__'
            }, (payload) => {
                const row = normalizeSupportReportRow(payload && payload.new);
                if (!row) return;
                const seenSet = new Set(getAdminSeenSupportIds().map(String));
                if (!seenSet.has(String(row.id))) {
                    markAdminSeenSupportIds([String(row.id)]);
                    if (typeof onNewReport === 'function') onNewReport(row);
                }
            })
            .subscribe();
    } catch (e) {
        console.warn('Realtime support notifications unavailable:', e);
    }
}

window.SupportReportsSync = {
    normalizeSupportStatus,
    submitSupportReport,
    flushPendingSupportReports,
    flushPendingSupportReportUpdates,
    fetchSupportReports,
    fetchSupportReportsForAdmin,
    updateSupportReportStatus,
    checkAndNotifyAdmin,
    markAdminSeenSupportIds,
    subscribeRealtimeAdminNotifications
};

// =========================================================================
// Пользовательские псевдонимы команд (Add alias / Add aliases + синхронизация БД)
// =========================================================================
const CUSTOM_ALIASES_KEY = 'terminal_custom_aliases_v1';
const CUSTOM_ALIASES_PENDING_KEY = 'terminal_pending_custom_aliases_v1';
let customAliasesTableMissing = false;
let customAliasesFlushPromise = null;

function getDefaultSeedAliases() {
    return [
        { alias: 'Report about a problem', target: 'help', user_email: 'e.grinec@gmail.com', seeded: true },
        { alias: 'Change directory', target: 'cd', user_email: 'e.grinec@gmail.com', seeded: true },
        { alias: 'Export file system', target: 'fs export', user_email: 'e.grinec@gmail.com', seeded: true },
        { alias: 'Download all files', target: 'fs export', user_email: 'e.grinec@gmail.com', seeded: true },
        { alias: 'Save project', target: 'fs export', user_email: 'e.grinec@gmail.com', seeded: true }
    ];
}

function getLocalCustomAliases() {
    try {
        const raw = localStorage.getItem(CUSTOM_ALIASES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveLocalCustomAliases(list) {
    try {
        localStorage.setItem(CUSTOM_ALIASES_KEY, JSON.stringify(list || []));
    } catch (e) {}
}

function getPendingCustomAliases() {
    try {
        const raw = localStorage.getItem(CUSTOM_ALIASES_PENDING_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingCustomAliases(list) {
    try {
        localStorage.setItem(CUSTOM_ALIASES_PENDING_KEY, JSON.stringify(list || []));
    } catch (e) {}
}

function applyStoredCustomAliases() {
    if (!window.CommandRegistry || typeof window.CommandRegistry.addAliases !== 'function') return 0;
    const combined = [...getDefaultSeedAliases(), ...getLocalCustomAliases()];
    let count = 0;
    combined.forEach(entry => {
        if (!entry || !entry.alias || !entry.target) return;
        const res = window.CommandRegistry.addAliases(entry.target, [entry.alias]);
        if (res && res.ok && res.added.length > 0) count += res.added.length;
    });
    return count;
}

async function flushPendingCustomAliases() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;
    if (customAliasesFlushPromise) return customAliasesFlushPromise;

    customAliasesFlushPromise = (async () => {
        try {
            const pending = getPendingCustomAliases();
            if (!pending || pending.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') return 0;

            let flushedCount = 0;
            const remaining = [];
            let networkFailed = false;

            for (const entry of pending) {
                if (networkFailed) {
                    remaining.push(entry);
                    continue;
                }
                const aliasLower = String(entry.alias || '').trim().toLowerCase();
                if (!aliasLower || !entry.target) continue;

                let savedOk = false;
                if (!customAliasesTableMissing) {
                    try {
                        const { error } = await window.supabaseClient
                            .from('command_aliases')
                            .upsert([{
                                id: `${user.id}_${aliasLower}`,
                                user_id: user.id,
                                user_email: user.email || '',
                                alias: entry.alias,
                                alias_lower: aliasLower,
                                target_command: entry.target,
                                created_at: entry.created_at || new Date().toISOString()
                            }], { onConflict: 'id' });
                        if (!error) {
                            savedOk = true;
                        } else if (isMissingTableError(error)) {
                            customAliasesTableMissing = true;
                        } else if (isOfflineNetworkError(error)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    }
                }

                if (!savedOk) {
                    try {
                        const { error: histErr } = await window.supabaseClient
                            .from('commands_history')
                            .insert([{
                                raw_text: `__command_alias__:${aliasLower}`,
                                command: '__command_alias__',
                                parameters: {
                                    type: 'command_alias',
                                    alias: entry.alias,
                                    alias_lower: aliasLower,
                                    target: entry.target,
                                    user_email: user.email || entry.user_email || '',
                                    created_at: entry.created_at || new Date().toISOString()
                                },
                                output: `${entry.alias} -> ${entry.target}`,
                                result: 'COMMAND_ALIAS',
                                status: 'success',
                                created_at: entry.created_at || new Date().toISOString(),
                                created_by: user.id
                            }]);
                        if (!histErr) {
                            savedOk = true;
                        } else if (isOfflineNetworkError(histErr)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                    }
                }

                if (savedOk) flushedCount++;
            }

            const latestPending = getPendingCustomAliases();
            const processedKeys = new Set(pending.map(p => `${String(p.alias || '').toLowerCase()}|${p.created_at || ''}`));
            const newlyAdded = latestPending.filter(p => !processedKeys.has(`${String(p.alias || '').toLowerCase()}|${p.created_at || ''}`));
            savePendingCustomAliases([...remaining, ...newlyAdded]);
            return flushedCount;
        } catch (err) {
            if (!isOfflineNetworkError(err)) {
                console.warn('flushPendingCustomAliases error:', err);
            }
            return 0;
        } finally {
            customAliasesFlushPromise = null;
        }
    })();

    return customAliasesFlushPromise;
}

async function saveCustomAliases(targetCanonical, aliasList, currentUser) {
    const cleanTarget = String(targetCanonical || '').trim().toLowerCase();
    const list = Array.isArray(aliasList) ? aliasList : [aliasList];
    const nowIso = new Date().toISOString();
    const userId = (currentUser && currentUser.id) ? currentUser.id : 'guest';
    const userEmail = (currentUser && currentUser.email) ? currentUser.email : 'guest@local';

    const localList = getLocalCustomAliases();
    const pendingList = getPendingCustomAliases();

    list.forEach(rawAlias => {
        const cleanAlias = String(rawAlias || '').trim().replace(/\s+/g, ' ');
        const aliasLower = cleanAlias.toLowerCase();
        if (!aliasLower) return;

        const existingIdx = localList.findIndex(item => String(item.alias || '').toLowerCase() === aliasLower);
        const record = {
            alias: cleanAlias,
            target: cleanTarget,
            user_id: userId,
            user_email: userEmail,
            created_at: nowIso
        };
        if (existingIdx !== -1) {
            localList[existingIdx] = record;
        } else {
            localList.push(record);
        }
        pendingList.push(record);
    });

    saveLocalCustomAliases(localList);
    savePendingCustomAliases(pendingList);
    applyStoredCustomAliases();

    let synced = false;
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (isOnline && window.supabaseClient && currentUser && !currentUser.isGuest && currentUser.id !== 'guest') {
        await flushPendingCustomAliases();
        const stillPending = getPendingCustomAliases().some(p =>
            list.some(a => String(a).trim().toLowerCase() === String(p.alias || '').toLowerCase())
        );
        synced = !stillPending;
    }

    return { synced };
}

async function syncCustomAliasesFromCloud(currentUser) {
    applyStoredCustomAliases();
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!isOnline || !window.supabaseClient) return;

    const user = currentUser || await fetchCurrentUser(true);
    if (!user || user.isGuest || !user.id || user.id === 'guest') return;

    try {
        await flushPendingCustomAliases();
    } catch (e) {}

    const mergedMap = new Map();
    getLocalCustomAliases().forEach(item => {
        if (item && item.alias && item.target) {
            mergedMap.set(String(item.alias).toLowerCase(), item);
        }
    });

    if (!customAliasesTableMissing) {
        try {
            const { data, error } = await window.supabaseClient
                .from('command_aliases')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });
            if (!error && Array.isArray(data)) {
                data.forEach(r => {
                    if (r.alias && r.target_command) {
                        mergedMap.set(String(r.alias).toLowerCase(), {
                            alias: r.alias,
                            target: r.target_command,
                            user_id: r.user_id || user.id,
                            user_email: r.user_email || user.email,
                            created_at: r.created_at
                        });
                    }
                });
            } else if (error && isMissingTableError(error)) {
                customAliasesTableMissing = true;
            }
        } catch (e) {}
    }

    try {
        const { data: histRows, error: histErr } = await window.supabaseClient
            .from('commands_history')
            .select('parameters, created_at')
            .eq('created_by', user.id)
            .eq('command', '__command_alias__')
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .limit(200);
        if (!histErr && Array.isArray(histRows)) {
            histRows.forEach(r => {
                const p = r.parameters;
                if (p && p.alias && p.target) {
                    mergedMap.set(String(p.alias).toLowerCase(), {
                        alias: p.alias,
                        target: p.target,
                        user_id: user.id,
                        user_email: p.user_email || user.email,
                        created_at: p.created_at || r.created_at
                    });
                }
            });
        }
    } catch (e) {}

    saveLocalCustomAliases(Array.from(mergedMap.values()));
    applyStoredCustomAliases();
}

window.CustomAliasesSync = {
    getDefaultSeedAliases,
    getLocalCustomAliases,
    applyStoredAliases: applyStoredCustomAliases,
    applyStoredCustomAliases,
    saveCustomAliases,
    flushPendingCustomAliases,
    syncAndApply: syncCustomAliasesFromCloud
};

// ==========================================
// Кулдауны задач Дашборда (Памперс — 3ч, Кипяток — 1ч) + синхронизация с Supabase
// ==========================================
const TASK_COOLDOWN_RULES = {
    памперс: {
        key: 'памперс',
        label: 'Памперс',
        durationSec: 3 * 3600, // 3 часа
        readyText: '👶 Пора менять памперс! Прошло 3 часа — можно запускать снова.'
    },
    кипяток: {
        key: 'кипяток',
        label: 'Кипяток',
        durationSec: 1 * 3600, // 1 час
        readyText: '🔥 Кипяток снова доступен! Прошёл 1 час.'
    }
};

function getCooldownRule(taskName) {
    const clean = String(taskName || '').trim().toLowerCase();
    if (!clean) return null;
    if (clean === 'памперс' || clean.includes('памперс')) return TASK_COOLDOWN_RULES.памперс;
    if (clean === 'кипяток' || clean.includes('кипяток')) return TASK_COOLDOWN_RULES.кипяток;
    return null;
}

function getCooldownStorageKeys(userIdOverride = null) {
    const uid = userIdOverride || (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || 'guest';
    return {
        uid,
        cache: `terminal_task_cooldowns_${uid}`,
        pending: `terminal_task_cooldowns_pending_${uid}`
    };
}

function loadLocalTaskCooldowns(userIdOverride = null) {
    try {
        const { cache } = getCooldownStorageKeys(userIdOverride);
        const raw = localStorage.getItem(cache);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveLocalTaskCooldowns(map, userIdOverride = null) {
    try {
        const { cache } = getCooldownStorageKeys(userIdOverride);
        localStorage.setItem(cache, JSON.stringify(map || {}));
    } catch (e) {}
}

function getPendingTaskCooldowns(userIdOverride = null) {
    try {
        const { pending } = getCooldownStorageKeys(userIdOverride);
        const raw = localStorage.getItem(pending);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingTaskCooldowns(list, userIdOverride = null) {
    try {
        const { pending } = getCooldownStorageKeys(userIdOverride);
        if (!list || list.length === 0) {
            localStorage.removeItem(pending);
        } else {
            localStorage.setItem(pending, JSON.stringify(list));
        }
    } catch (e) {}
}

function formatCooldownDurationMs(ms) {
    const totalSec = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    if (totalSec <= 0) return '0с';
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const secStr = `${secs < 10 ? '0' : ''}${secs}с`;
    if (hours > 0) {
        const minStr = `${mins < 10 ? '0' : ''}${mins}м`;
        return `${hours}ч ${minStr} ${secStr}`;
    }
    if (mins > 0) {
        return `${mins}м ${secStr}`;
    }
    return `${secs}с`;
}

async function upsertTaskCooldownInSupabase(userId, item) {
    if (!window.supabaseClient || !userId || userId === 'guest') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    const markerRawText = `__task_cooldown__:${item.key}`;
    const payloadParams = {
        task_key: item.key,
        task_name: item.label,
        completed_at_ms: Number(item.completedAtMs),
        until_ms: Number(item.untilMs),
        duration_seconds: Number(item.durationSec),
        updated_at: new Date().toISOString()
    };

    try {
        const { data: existingRows, error: findErr } = await window.supabaseClient
            .from('commands_history')
            .select('id, parameters')
            .eq('created_by', userId)
            .eq('command', '__task_cooldown__')
            .eq('raw_text', markerRawText)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1);

        if (findErr) return false;

        if (existingRows && existingRows.length > 0) {
            const remoteUntil = Number(existingRows[0].parameters && existingRows[0].parameters.until_ms) || 0;
            if (remoteUntil > Number(item.untilMs)) {
                return true;
            }
            const { error: updErr } = await window.supabaseClient
                .from('commands_history')
                .update({
                    parameters: payloadParams,
                    output: `Cooldown ${item.label}: ${new Date(item.untilMs).toISOString()}`,
                    created_at: new Date(item.completedAtMs).toISOString()
                })
                .eq('id', existingRows[0].id);
            return !updErr;
        }

        const { error: insErr } = await window.supabaseClient
            .from('commands_history')
            .insert([{
                raw_text: markerRawText,
                command: '__task_cooldown__',
                parameters: payloadParams,
                output: `Cooldown ${item.label}: ${new Date(item.untilMs).toISOString()}`,
                status: 'success',
                created_by: userId,
                created_at: new Date(item.completedAtMs).toISOString()
            }]);
        return !insErr;
    } catch (e) {
        return false;
    }
}

async function flushPendingTaskCooldowns(userIdOverride = null) {
    const uid = userIdOverride || (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null;
    if (!uid || uid === 'guest' || !window.supabaseClient) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

    const pending = getPendingTaskCooldowns(uid);
    if (!pending.length) return 0;

    const remaining = [];
    let flushed = 0;
    for (const item of pending) {
        const ok = await upsertTaskCooldownInSupabase(uid, item);
        if (ok) flushed++;
        else remaining.push(item);
    }
    savePendingTaskCooldowns(remaining, uid);
    return flushed;
}

function recordTaskCompletion(taskName, completedAtInput = Date.now(), userIdOverride = null) {
    const rule = getCooldownRule(taskName);
    if (!rule) return null;

    let completedAtMs = completedAtInput instanceof Date
        ? completedAtInput.getTime()
        : (typeof completedAtInput === 'number' ? completedAtInput : new Date(completedAtInput).getTime());
    if (!Number.isFinite(completedAtMs) || completedAtMs <= 0) {
        completedAtMs = Date.now();
    }
    // Если время завершения немного в будущем из-за рассинхрона часов — ограничиваем текущим моментом
    if (completedAtMs > Date.now() + 5000) {
        completedAtMs = Date.now();
    }

    const untilMs = completedAtMs + rule.durationSec * 1000;
    const { uid } = getCooldownStorageKeys(userIdOverride);
    const map = loadLocalTaskCooldowns(uid);
    const prev = map[rule.key];

    if (prev && Number(prev.untilMs) >= untilMs) {
        return prev;
    }

    const entry = {
        key: rule.key,
        label: rule.label,
        completedAtMs,
        untilMs,
        durationSec: rule.durationSec,
        readyNotified: untilMs <= Date.now()
    };
    map[rule.key] = entry;
    saveLocalTaskCooldowns(map, uid);

    if (uid && uid !== 'guest') {
        const pending = getPendingTaskCooldowns(uid).filter(p => p.key !== rule.key);
        pending.push(entry);
        savePendingTaskCooldowns(pending, uid);
        flushPendingTaskCooldowns(uid).catch(() => {});
    }

    return entry;
}

function getTaskCooldownState(taskName, userIdOverride = null) {
    const rule = getCooldownRule(taskName);
    if (!rule) return null;

    const { uid } = getCooldownStorageKeys(userIdOverride);
    const map = loadLocalTaskCooldowns(uid);
    const entry = map[rule.key];
    if (!entry || !entry.untilMs) {
        return {
            rule,
            active: false,
            remainingMs: 0,
            untilMs: 0,
            formatted: ''
        };
    }

    const remainingMs = Math.max(0, Number(entry.untilMs) - Date.now());
    return {
        rule,
        active: remainingMs > 0,
        remainingMs,
        untilMs: Number(entry.untilMs),
        completedAtMs: Number(entry.completedAtMs) || 0,
        formatted: remainingMs > 0 ? formatCooldownDurationMs(remainingMs) : ''
    };
}

function getAllActiveTaskCooldowns(userIdOverride = null) {
    const { uid } = getCooldownStorageKeys(userIdOverride);
    const map = loadLocalTaskCooldowns(uid);
    const now = Date.now();
    const active = [];
    for (const key of Object.keys(TASK_COOLDOWN_RULES)) {
        const rule = TASK_COOLDOWN_RULES[key];
        const entry = map[key];
        if (entry && Number(entry.untilMs) > now) {
            const remainingMs = Number(entry.untilMs) - now;
            active.push({
                key,
                label: rule.label,
                remainingMs,
                untilMs: Number(entry.untilMs),
                completedAtMs: Number(entry.completedAtMs) || 0,
                formatted: formatCooldownDurationMs(remainingMs)
            });
        }
    }
    return active;
}

function checkTaskCooldownTransitions(userIdOverride = null, onReadyCallback = null) {
    const { uid } = getCooldownStorageKeys(userIdOverride);
    const map = loadLocalTaskCooldowns(uid);
    const now = Date.now();
    let changed = false;
    const readyList = [];

    for (const [key, entry] of Object.entries(map)) {
        if (!entry || !entry.untilMs) continue;
        if (now >= Number(entry.untilMs) && !entry.readyNotified) {
            entry.readyNotified = true;
            changed = true;
            const rule = TASK_COOLDOWN_RULES[key] || getCooldownRule(entry.label || key);
            if (rule) {
                readyList.push(rule);
                if (typeof onReadyCallback === 'function') {
                    try { onReadyCallback(rule, entry); } catch (e) {}
                }
            }
        }
    }

    if (changed) {
        saveLocalTaskCooldowns(map, uid);
    }
    return readyList;
}

async function syncTaskCooldownsFromSupabase(userIdOverride = null) {
    const uid = userIdOverride || (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null;
    if (!uid || uid === 'guest' || !window.supabaseClient) {
        return loadLocalTaskCooldowns(uid || 'guest');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return loadLocalTaskCooldowns(uid);
    }

    try {
        await flushPendingTaskCooldowns(uid);
        const { data: rows, error } = await window.supabaseClient
            .from('commands_history')
            .select('parameters, created_at')
            .eq('created_by', uid)
            .eq('command', '__task_cooldown__')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(20);

        const localMap = loadLocalTaskCooldowns(uid);
        let updated = false;
        const now = Date.now();

        if (!error && Array.isArray(rows)) {
            rows.forEach(row => {
                const p = row.parameters || {};
                const rule = getCooldownRule(p.task_key || p.task_name);
                if (!rule) return;
                const remoteUntilMs = Number(p.until_ms) || 0;
                const remoteCompletedMs = Number(p.completed_at_ms) || (remoteUntilMs - rule.durationSec * 1000);
                if (remoteUntilMs <= 0) return;

                const cur = localMap[rule.key];
                if (!cur || remoteUntilMs > Number(cur.untilMs || 0)) {
                    localMap[rule.key] = {
                        key: rule.key,
                        label: rule.label,
                        completedAtMs: remoteCompletedMs,
                        untilMs: remoteUntilMs,
                        durationSec: rule.durationSec,
                        // Не показываем опоздавшее уведомление при первичной подгрузке уже давно истёкшего кулдауна с другого устройства
                        readyNotified: remoteUntilMs <= now
                    };
                    updated = true;
                }
            });
        }

        if (updated) {
            saveLocalTaskCooldowns(localMap, uid);
        }
        return localMap;
    } catch (e) {
        return loadLocalTaskCooldowns(uid);
    }
}

window.TaskCooldowns = {
    RULES: TASK_COOLDOWN_RULES,
    getRule: getCooldownRule,
    formatDurationMs: formatCooldownDurationMs,
    recordCompletion: recordTaskCompletion,
    getState: getTaskCooldownState,
    getAllActive: getAllActiveTaskCooldowns,
    checkTransitions: checkTaskCooldownTransitions,
    flushPending: flushPendingTaskCooldowns,
    syncFromSupabase: syncTaskCooldownsFromSupabase
};

// ==========================================
// Расходы ресурсов при запуске задач (например: Ребёнок -> Покормить: -1 Сосиска, -1 Макароны)
// ==========================================
const TASK_LAUNCH_COST_RULES = [
    {
        key: 'ребенок_покормить',
        taskLabel: 'Покормить',
        taskAliases: ['покормить'],
        buildingAliases: ['ребенок', 'ребёнок', 'уход'],
        costs: [
            {
                key: 'сосиска',
                label: 'Сосиска',
                emoji: '🌭',
                amount: 1,
                itemAliases: ['сосиска', 'сосиски']
            },
            {
                key: 'макароны',
                label: 'Макароны',
                emoji: '🍝',
                amount: 1,
                itemAliases: ['макароны', 'макарон']
            }
        ]
    }
];

function normalizeTaskResourceName(str) {
    return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ');
}

function getTaskLaunchCostRule(taskName, buildingName = null) {
    const normTask = normalizeTaskResourceName(taskName);
    if (!normTask) return null;
    const normBuilding = normalizeTaskResourceName(buildingName);

    for (const rule of TASK_LAUNCH_COST_RULES) {
        const taskMatched = rule.taskAliases.some(alias => {
            const normAlias = normalizeTaskResourceName(alias);
            return normTask === normAlias || normTask.includes(normAlias);
        });
        if (!taskMatched) continue;

        if (normBuilding && Array.isArray(rule.buildingAliases) && rule.buildingAliases.length > 0) {
            const buildingMatched = rule.buildingAliases.some(bAlias => {
                const normBAlias = normalizeTaskResourceName(bAlias);
                return normBuilding === normBAlias || normBuilding.includes(normBAlias);
            });
            if (!buildingMatched) continue;
        }
        return rule;
    }
    return null;
}

function matchesTaskCostInventoryItem(invItemName, costItem) {
    if (!invItemName || !costItem) return false;
    const normInv = normalizeTaskResourceName(invItemName);
    if (!normInv) return false;
    const aliases = Array.isArray(costItem.itemAliases) && costItem.itemAliases.length > 0
        ? costItem.itemAliases
        : [costItem.label || costItem.key];
    return aliases.some(a => normInv === normalizeTaskResourceName(a));
}

function getAvailableCountForCost(invList, costItem) {
    if (!Array.isArray(invList) || !costItem) return 0;
    return invList.reduce((sum, item) => {
        if (item && matchesTaskCostInventoryItem(item.name, costItem)) {
            return sum + Math.max(0, Number(item.count) || 0);
        }
        return sum;
    }, 0);
}

function checkTaskLaunchCostAvailability(rule, invList) {
    if (!rule || !Array.isArray(rule.costs) || rule.costs.length === 0) {
        return { ok: true, items: [], missing: [] };
    }
    const items = rule.costs.map(cost => {
        const needed = Math.max(1, Number(cost.amount) || 1);
        const available = getAvailableCountForCost(invList, cost);
        const missing = Math.max(0, needed - available);
        return {
            ...cost,
            needed,
            available,
            missing,
            ok: available >= needed
        };
    });
    const missing = items.filter(i => !i.ok);
    return {
        ok: missing.length === 0,
        items,
        missing
    };
}

function deductTaskLaunchCostsFromList(invList, rule) {
    if (!rule || !Array.isArray(rule.costs) || rule.costs.length === 0) return true;
    const check = checkTaskLaunchCostAvailability(rule, invList);
    if (!check.ok) return false;

    for (const cost of rule.costs) {
        let leftToDeduct = Math.max(1, Number(cost.amount) || 1);
        for (const item of invList) {
            if (leftToDeduct <= 0) break;
            if (!item || !matchesTaskCostInventoryItem(item.name, cost)) continue;
            const avail = Math.max(0, Number(item.count) || 0);
            if (avail <= 0) continue;
            const take = Math.min(avail, leftToDeduct);
            item.count = avail - take;
            leftToDeduct -= take;
        }
    }
    return true;
}

function restoreTaskLaunchCostsToList(invList, rule, userId = 'guest') {
    if (!rule || !Array.isArray(rule.costs) || !Array.isArray(invList)) return;
    for (const cost of rule.costs) {
        const addAmt = Math.max(1, Number(cost.amount) || 1);
        const existing = invList.find(i => i && matchesTaskCostInventoryItem(i.name, cost));
        if (existing) {
            existing.count = Math.max(0, Number(existing.count) || 0) + addAmt;
        } else {
            invList.push({ name: cost.label, count: addAmt, created_by: userId });
        }
    }
}

function getAllowedCostAliasesForBuildings(buildingsList) {
    const allowed = new Set();
    if (!Array.isArray(buildingsList)) return allowed;
    buildingsList.forEach(b => {
        const bName = b && b.building_name;
        (b && b.tasks || []).forEach(t => {
            const rule = getTaskLaunchCostRule(t && t.name, bName);
            if (rule && Array.isArray(rule.costs)) {
                rule.costs.forEach(c => {
                    (c.itemAliases || [c.label]).forEach(a => allowed.add(normalizeTaskResourceName(a)));
                });
            }
        });
    });
    return allowed;
}

function formatTaskCostBadge(rule) {
    if (!rule || !Array.isArray(rule.costs) || rule.costs.length === 0) return '';
    return rule.costs.map(c => `${c.emoji || '📦'}-${c.amount}`).join(' ');
}

function formatTaskCostText(rule) {
    if (!rule || !Array.isArray(rule.costs) || rule.costs.length === 0) return '';
    return rule.costs.map(c => `-${c.amount} ${c.label}`).join(', ');
}

function formatTaskMissingCostError(rule, availability) {
    const taskLabel = (rule && rule.taskLabel) || 'задачи';
    const missList = (availability && availability.missing || [])
        .map(m => `${m.emoji || '📦'} ${m.label} (есть ${m.available}/${m.needed})`)
        .join(', ');
    return `❌ Недостаточно продуктов на складе для «${taskLabel}»! Не хватает: ${missList}.`;
}

window.TaskLaunchCosts = {
    RULES: TASK_LAUNCH_COST_RULES,
    normalizeName: normalizeTaskResourceName,
    getRule: getTaskLaunchCostRule,
    matchesInventoryItem: matchesTaskCostInventoryItem,
    getAvailableForCost: getAvailableCountForCost,
    checkAvailability: checkTaskLaunchCostAvailability,
    deductFromList: deductTaskLaunchCostsFromList,
    restoreToList: restoreTaskLaunchCostsToList,
    getAllowedCostAliasesForBuildings,
    formatCostBadge: formatTaskCostBadge,
    formatCostText: formatTaskCostText,
    formatMissingError: formatTaskMissingCostError
};

// ==========================================
// Ежедневные ускорители (+1 в 09:00 и +2 в 21:00, всего 3/день) + синхронизация с Supabase
// ==========================================
const DAILY_FREE_ACCELERATORS_CONFIG = {
    enabled: true, // Позже можно отключить халяву в 1 строку (false)
    itemName: 'Ускорители',
    slots: [
        { key: 'morning', hour: 9, minute: 0, amount: 1, label: '09:00' },
        { key: 'evening', hour: 21, minute: 0, amount: 2, label: '21:00' }
    ]
};

const dailyBoostGrantLocks = new Map();
let dailyBoostSchedulerTimer = null;
let dailyBoostPollInterval = null;
let dailyBoostSchedulerStarted = false;

function getLocalDateKey(dateInput = new Date()) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getDailyBoostStorageKeys(userIdOverride = null) {
    const uid = userIdOverride || (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || 'guest';
    return {
        uid,
        claims: `terminal_daily_boost_claims_${uid}`,
        pending: `terminal_pending_daily_boost_claims_${uid}`,
        inventory: `terminal_inventory_${uid}`
    };
}

function loadLocalDailyBoostClaims(userIdOverride = null) {
    try {
        const { claims } = getDailyBoostStorageKeys(userIdOverride);
        const raw = localStorage.getItem(claims);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveLocalDailyBoostClaims(map, userIdOverride = null) {
    try {
        const { claims } = getDailyBoostStorageKeys(userIdOverride);
        const keys = Object.keys(map || {}).sort();
        const trimmed = {};
        const keepKeys = keys.slice(-35);
        keepKeys.forEach(k => {
            if (map[k] && typeof map[k] === 'object') trimmed[k] = map[k];
        });
        localStorage.setItem(claims, JSON.stringify(trimmed));
    } catch (e) {}
}

function getPendingDailyBoostClaims(userIdOverride = null) {
    try {
        const { pending } = getDailyBoostStorageKeys(userIdOverride);
        const raw = localStorage.getItem(pending);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function savePendingDailyBoostClaims(list, userIdOverride = null) {
    try {
        const { pending } = getDailyBoostStorageKeys(userIdOverride);
        if (!list || list.length === 0) {
            localStorage.removeItem(pending);
        } else {
            localStorage.setItem(pending, JSON.stringify(list));
        }
    } catch (e) {}
}

function loadLocalUserInventoryArray(userIdOverride = null) {
    try {
        const { inventory } = getDailyBoostStorageKeys(userIdOverride);
        const raw = localStorage.getItem(inventory);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function incrementLocalAcceleratorInventory(userIdOverride, delta) {
    const addAmount = Number(delta) || 0;
    if (addAmount <= 0) return getLocalAcceleratorInventoryCount(userIdOverride);
    const { uid, inventory } = getDailyBoostStorageKeys(userIdOverride);
    const list = loadLocalUserInventoryArray(uid);
    const targetLower = DAILY_FREE_ACCELERATORS_CONFIG.itemName.toLowerCase();
    const existing = list.find(i => String(i && i.name || '').trim().toLowerCase() === targetLower);
    if (existing) {
        existing.count = Math.max(0, (Number(existing.count) || 0) + addAmount);
    } else {
        list.push({
            name: DAILY_FREE_ACCELERATORS_CONFIG.itemName,
            count: addAmount,
            created_by: uid
        });
    }
    try {
        localStorage.setItem(inventory, JSON.stringify(list));
    } catch (e) {}
    return getLocalAcceleratorInventoryCount(uid);
}

function getLocalAcceleratorInventoryCount(userIdOverride = null) {
    const list = loadLocalUserInventoryArray(userIdOverride);
    const targetLower = DAILY_FREE_ACCELERATORS_CONFIG.itemName.toLowerCase();
    return list.reduce((sum, item) => {
        if (String(item && item.name || '').trim().toLowerCase() === targetLower) {
            return sum + Math.max(0, Number(item.count) || 0);
        }
        return sum;
    }, 0);
}

async function resolveDailyBoostUser(userOverride = null) {
    if (userOverride && userOverride.id) {
        return {
            id: userOverride.id,
            email: userOverride.email || '',
            isGuest: Boolean(userOverride.isGuest || userOverride.id === 'guest')
        };
    }
    try {
        const u = await fetchCurrentUser(false);
        if (u && u.id) {
            return {
                id: u.id,
                email: u.email || '',
                isGuest: Boolean(u.isGuest || u.id === 'guest')
            };
        }
    } catch (e) {}
    return { id: 'guest', email: 'guest@demo.terminal', isGuest: true };
}

async function fetchRemoteDailyBoostClaimsForDate(userId, dateKey) {
    if (!window.supabaseClient || !userId || userId === 'guest') return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

    try {
        const { data, error } = await window.supabaseClient
            .from('commands_history')
            .select('raw_text, parameters, created_at')
            .eq('created_by', userId)
            .eq('command', '__daily_accelerator_claim__')
            .like('raw_text', `__daily_accelerator_claim__:${dateKey}:%`)
            .is('deleted_at', null);

        if (error) return null;
        const found = {};
        if (Array.isArray(data)) {
            data.forEach(row => {
                const p = row.parameters || {};
                const slotKey = p.slot || String(row.raw_text || '').split(':')[2];
                if (slotKey) {
                    found[slotKey] = p.claimed_at || row.created_at || new Date().toISOString();
                }
            });
        }
        return found;
    } catch (e) {
        return null;
    }
}

async function flushPendingDailyBoostClaims(userIdOverride = null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    let uid = userIdOverride;
    if (!uid) {
        const resolved = await resolveDailyBoostUser(null);
        if (!resolved || resolved.isGuest || !resolved.id || resolved.id === 'guest') return 0;
        uid = resolved.id;
    }
    if (!uid || uid === 'guest') return 0;

    const pending = getPendingDailyBoostClaims(uid);
    if (!pending.length) return 0;

    let flushedCount = 0;
    let networkFailed = false;
    const remaining = [];

    for (let idx = 0; idx < pending.length; idx++) {
        const entry = { ...pending[idx] };
        if (networkFailed) {
            remaining.push(entry);
            continue;
        }
        const markerRawText = `__daily_accelerator_claim__:${entry.dateKey}:${entry.slotKey}`;
        try {
            // Проверка в БД, не успело ли другое устройство уже зачислить этот слот
            const { data: existingClaim, error: claimCheckErr } = await window.supabaseClient
                .from('commands_history')
                .select('id')
                .eq('created_by', uid)
                .eq('command', '__daily_accelerator_claim__')
                .eq('raw_text', markerRawText)
                .is('deleted_at', null)
                .limit(1);

            if (claimCheckErr) {
                if (isOfflineNetworkError(claimCheckErr)) {
                    networkFailed = true;
                    remaining.push(entry);
                    continue;
                }
            } else if (Array.isArray(existingClaim) && existingClaim.length > 0) {
                // Слот уже зафиксирован в облаке — дубль пропускаем
                flushedCount++;
                continue;
            }

            if (entry.needsInventoryCredit) {
                const { data: boosterRows, error: selErr } = await window.supabaseClient
                    .from('completed_items')
                    .select('*')
                    .eq('created_by', uid)
                    .ilike('name', DAILY_FREE_ACCELERATORS_CONFIG.itemName)
                    .limit(1);

                if (selErr) {
                    if (isOfflineNetworkError(selErr)) {
                        networkFailed = true;
                        remaining.push(entry);
                        continue;
                    }
                    throw selErr;
                }

                const nowIso = new Date().toISOString();
                if (Array.isArray(boosterRows) && boosterRows[0]) {
                    const row = boosterRows[0];
                    const nextCount = Math.max(0, Number(row.count) || 0) + Math.max(1, Number(entry.amount) || 1);
                    const { error: updErr } = await window.supabaseClient
                        .from('completed_items')
                        .update({ count: nextCount, updated_at: nowIso })
                        .eq('id', row.id);
                    if (updErr) {
                        if (isOfflineNetworkError(updErr)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                        throw updErr;
                    }
                } else {
                    const { error: insErr } = await window.supabaseClient
                        .from('completed_items')
                        .insert([{
                            name: DAILY_FREE_ACCELERATORS_CONFIG.itemName,
                            count: Math.max(1, Number(entry.amount) || 1),
                            created_by: uid,
                            updated_at: nowIso
                        }]);
                    if (insErr) {
                        if (isOfflineNetworkError(insErr)) {
                            networkFailed = true;
                            remaining.push(entry);
                            continue;
                        }
                        throw insErr;
                    }
                }

                entry.needsInventoryCredit = false;
                // Сохраняем промежуточный прогресс немедленно, чтобы повтор при сбое вставки маркера не начислил инвентарь дважды
                const snapshot = [...remaining, entry, ...pending.slice(idx + 1)];
                savePendingDailyBoostClaims(snapshot, uid);
            }

            if (entry.needsMarkerInsert) {
                const { error: markerErr } = await window.supabaseClient
                    .from('commands_history')
                    .insert([{
                        raw_text: markerRawText,
                        command: '__daily_accelerator_claim__',
                        parameters: {
                            type: 'daily_accelerator_claim',
                            date_key: entry.dateKey,
                            slot: entry.slotKey,
                            slot_label: entry.slotLabel,
                            amount: entry.amount,
                            claimed_at: entry.claimedAt
                        },
                        output: `+${entry.amount} ${DAILY_FREE_ACCELERATORS_CONFIG.itemName} (${entry.slotLabel})`,
                        result: 'DAILY_ACCELERATOR_CLAIM',
                        status: 'success',
                        created_at: entry.claimedAt,
                        created_by: uid
                    }]);

                if (markerErr) {
                    if (isOfflineNetworkError(markerErr)) {
                        networkFailed = true;
                        remaining.push(entry);
                        continue;
                    }
                    throw markerErr;
                }
                entry.needsMarkerInsert = false;
            }

            flushedCount++;
        } catch (err) {
            if (isOfflineNetworkError(err)) {
                networkFailed = true;
                remaining.push(entry);
            } else {
                console.warn('flushPendingDailyBoostClaims error:', err && err.message ? err.message : err);
                remaining.push(entry);
            }
        }
    }

    const latestPending = getPendingDailyBoostClaims(uid);
    const processedIds = new Set(pending.map(p => p.claimId));
    const newlyAdded = latestPending.filter(p => !processedIds.has(p.claimId));
    savePendingDailyBoostClaims([...remaining, ...newlyAdded], uid);
    return flushedCount;
}

function showDailyBoostFloatingToast(message) {
    if (typeof document === 'undefined' || !document.body || !message) return;
    if (typeof window.showError === 'function') {
        try {
            window.showError(message, 'ready');
            return;
        } catch (e) {}
    }
    let toast = document.getElementById('daily-boost-global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'daily-boost-global-toast';
        toast.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translate(-50%,16px);max-width:min(92vw,440px);padding:10px 16px;border-radius:10px;background:#064e3b;border:1px solid #10b981;color:#a7f3d0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,0.35);opacity:0;pointer-events:none;z-index:99999;transition:opacity 0.2s ease,transform 0.2s ease;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%,0)';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%,16px)';
    }, 4500);
}

function notifyDailyAcceleratorsGranted(grantedList, options = {}) {
    if (!Array.isArray(grantedList) || grantedList.length === 0) return;
    const totalAdded = grantedList.reduce((s, g) => s + (Number(g.amount) || 0), 0);
    const word = totalAdded === 1 ? 'ускоритель' : (totalAdded >= 2 && totalAdded <= 4 ? 'ускорителя' : 'ускорителей');
    const timesText = grantedList.map(g => g.label).join(' и ');
    const msg = `💊 Ежедневное начисление (${timesText}): +${totalAdded} ${word}!`;

    if (options.triggerToast !== false && typeof document !== 'undefined') {
        const isTerminalPage = Boolean(document.getElementById('terminal-output'));
        if (!isTerminalPage) {
            showDailyBoostFloatingToast(msg);
        }
    }

    if (options.notifyBrowser !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const title = `💊 +${totalAdded} ${word}`;
        const body = `Начислено за время ${timesText} на склад «Ускорители».`;
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(title, {
                    body,
                    icon: '/icon-512.png',
                    badge: '/badge.png',
                    tag: 'daily-accelerators-drop',
                    renotify: true
                });
            }).catch(() => {});
        } else {
            try {
                new Notification(title, { body, icon: '/icon-512.png' });
            } catch (e) {}
        }
    }
}

function getNextScheduledDropInfo(nowInput = new Date()) {
    if (!DAILY_FREE_ACCELERATORS_CONFIG.enabled) return null;
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    const candidates = [];
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        for (const slot of DAILY_FREE_ACCELERATORS_CONFIG.slots) {
            const d = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + dayOffset,
                slot.hour,
                slot.minute,
                1,
                0
            );
            if (d.getTime() > now.getTime()) {
                candidates.push({ slot, date: d, msUntil: d.getTime() - now.getTime() });
            }
        }
    }
    candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
    return candidates[0] || null;
}

async function checkAndGrantDailyAccelerators(options = {}) {
    if (!DAILY_FREE_ACCELERATORS_CONFIG.enabled) {
        return { enabled: false, granted: [], totalAdded: 0 };
    }

    const user = await resolveDailyBoostUser(options.user || null);
    const uid = user.id || 'guest';

    if (dailyBoostGrantLocks.has(uid)) {
        return dailyBoostGrantLocks.get(uid);
    }

    let settled = false;
    const runPromise = (async () => {
        await Promise.resolve();
        try {
            const nowDate = options.now instanceof Date ? options.now : (options.now ? new Date(options.now) : new Date());
            const dateKey = getLocalDateKey(nowDate);
            const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

            const dueSlots = DAILY_FREE_ACCELERATORS_CONFIG.slots.filter(
                slot => nowMinutes >= (slot.hour * 60 + slot.minute)
            );

            let claimsMap = loadLocalDailyBoostClaims(uid);
            const todayClaims = (claimsMap[dateKey] && typeof claimsMap[dateKey] === 'object') ? { ...claimsMap[dateKey] } : {};

            const locallyMissing = dueSlots.filter(s => !todayClaims[s.key]);
            if (locallyMissing.length === 0) {
                if (!user.isGuest) {
                    flushPendingDailyBoostClaims(uid).catch(() => {});
                }
                return { enabled: true, dateKey, granted: [], totalAdded: 0, uid };
            }

            // Если пользователь авторизован и онлайн — сначала подтягиваем сегодняшние клеймы из облака (защита от двойного начисления на втором устройстве)
            if (!user.isGuest && window.supabaseClient && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
                await flushPendingDailyBoostClaims(uid).catch(() => {});
                const remoteToday = await fetchRemoteDailyBoostClaimsForDate(uid, dateKey);
                if (remoteToday && typeof remoteToday === 'object') {
                    let syncedFromRemote = false;
                    for (const [slotKey, claimedAtVal] of Object.entries(remoteToday)) {
                        if (!todayClaims[slotKey]) {
                            todayClaims[slotKey] = claimedAtVal;
                            syncedFromRemote = true;
                        }
                    }
                    if (syncedFromRemote) {
                        claimsMap[dateKey] = todayClaims;
                        saveLocalDailyBoostClaims(claimsMap, uid);
                    }
                }
            }

            const slotsToGrant = dueSlots.filter(s => !todayClaims[s.key]);
            if (slotsToGrant.length === 0) {
                return { enabled: true, dateKey, granted: [], totalAdded: 0, uid, syncedRemote: true };
            }

            // Повторное чтение claims из localStorage на случай параллельной вкладки браузера
            claimsMap = loadLocalDailyBoostClaims(uid);
            const freshTodayClaims = (claimsMap[dateKey] && typeof claimsMap[dateKey] === 'object') ? { ...claimsMap[dateKey] } : {};
            const finalSlotsToGrant = slotsToGrant.filter(s => !freshTodayClaims[s.key]);
            if (finalSlotsToGrant.length === 0) {
                return { enabled: true, dateKey, granted: [], totalAdded: 0, uid };
            }

            const nowIso = nowDate.toISOString();
            const granted = [];
            let totalAdded = 0;

            for (const slot of finalSlotsToGrant) {
                freshTodayClaims[slot.key] = nowIso;
                claimsMap[dateKey] = freshTodayClaims;
                saveLocalDailyBoostClaims(claimsMap, uid);

                incrementLocalAcceleratorInventory(uid, slot.amount);
                totalAdded += slot.amount;

                const grantRecord = {
                    dateKey,
                    slotKey: slot.key,
                    label: slot.label,
                    amount: slot.amount,
                    claimedAt: nowIso
                };
                granted.push(grantRecord);

                if (!user.isGuest) {
                    const pending = getPendingDailyBoostClaims(uid);
                    const claimId = `${dateKey}:${slot.key}`;
                    if (!pending.some(p => p.claimId === claimId)) {
                        pending.push({
                            claimId,
                            dateKey,
                            slotKey: slot.key,
                            slotLabel: slot.label,
                            amount: slot.amount,
                            claimedAt: nowIso,
                            needsInventoryCredit: true,
                            needsMarkerInsert: true
                        });
                        savePendingDailyBoostClaims(pending, uid);
                    }
                }

                try {
                    if (typeof window.recordCommandAction === 'function') {
                        await window.recordCommandAction(
                            `Daily boost +${slot.amount} (${slot.label})`,
                            `Ежедневное начисление (${slot.label}): +${slot.amount} шт. «Ускорители»`,
                            'success'
                        );
                    }
                } catch (e) {}
            }

            if (!user.isGuest && window.supabaseClient && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
                await flushPendingDailyBoostClaims(uid).catch(() => {});
            }

            if (granted.length > 0) {
                notifyDailyAcceleratorsGranted(granted, options);
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('dailyAcceleratorsGranted', {
                        detail: {
                            uid,
                            dateKey,
                            granted,
                            totalAdded,
                            totalAccelerators: getLocalAcceleratorInventoryCount(uid),
                            nextDrop: getNextScheduledDropInfo(nowDate)
                        }
                    }));
                }
            }

            return {
                enabled: true,
                dateKey,
                granted,
                totalAdded,
                uid,
                totalAccelerators: getLocalAcceleratorInventoryCount(uid)
            };
        } finally {
            settled = true;
            if (dailyBoostGrantLocks.get(uid) === runPromise) {
                dailyBoostGrantLocks.delete(uid);
            }
        }
    })();

    if (!settled) {
        dailyBoostGrantLocks.set(uid, runPromise);
    }
    return runPromise;
}

function scheduleNextDailyAcceleratorTick() {
    if (dailyBoostSchedulerTimer) {
        clearTimeout(dailyBoostSchedulerTimer);
        dailyBoostSchedulerTimer = null;
    }
    if (!DAILY_FREE_ACCELERATORS_CONFIG.enabled) return;
    const next = getNextScheduledDropInfo(new Date());
    if (!next) return;
    // Ограничиваем timeout до 6 часов, чтобы перепланировать корректно при смене времени/сне ОС
    const delayMs = Math.min(Math.max(1000, next.msUntil), 6 * 3600 * 1000);
    dailyBoostSchedulerTimer = setTimeout(() => {
        checkAndGrantDailyAccelerators()
            .catch(() => {})
            .finally(() => scheduleNextDailyAcceleratorTick());
    }, delayMs);
}

function startDailyAcceleratorScheduler() {
    if (dailyBoostSchedulerStarted || typeof window === 'undefined') return;
    dailyBoostSchedulerStarted = true;
    scheduleNextDailyAcceleratorTick();
    // Подстраховка каждые 30 сек + моментальная проверка при возврате во вкладку
    dailyBoostPollInterval = setInterval(() => {
        checkAndGrantDailyAccelerators().catch(() => {});
    }, 30000);
    setTimeout(() => {
        checkAndGrantDailyAccelerators().catch(() => {});
    }, 250);
}

window.DailyAcceleratorsSync = {
    CONFIG: DAILY_FREE_ACCELERATORS_CONFIG,
    getLocalDateKey,
    getNextScheduledDrop: getNextScheduledDropInfo,
    getLocalClaims: loadLocalDailyBoostClaims,
    getLocalAcceleratorsCount: getLocalAcceleratorInventoryCount,
    flushPending: flushPendingDailyBoostClaims,
    checkAndGrant: checkAndGrantDailyAccelerators,
    startScheduler: startDailyAcceleratorScheduler
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDailyAcceleratorScheduler);
    } else {
        startDailyAcceleratorScheduler();
    }
}

async function flushAllOfflineConsoleQueues() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
        await flushPendingNotes();
    } catch (e) {}
    try {
        await flushPendingActionsToCloud();
    } catch (e) {}
    try {
        await flushPendingHouseLayouts();
    } catch (e) {}
    try {
        await flushPendingLastPage();
    } catch (e) {}
    try {
        await flushPendingSupportReports();
        await flushPendingSupportReportUpdates();
    } catch (e) {}
    try {
        await flushPendingCustomAliases();
    } catch (e) {}
    try {
        await flushPendingTaskCooldowns();
    } catch (e) {}
    try {
        await flushPendingDailyBoostClaims();
    } catch (e) {}
    try {
        if (window.MissionsStore && typeof window.MissionsStore.trySyncSupabase === 'function') {
            await window.MissionsStore.trySyncSupabase(false);
        }
    } catch (e) {}
}

window.flushAllOfflineConsoleQueues = flushAllOfflineConsoleQueues;

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        flushAllOfflineConsoleQueues().catch(() => {});
        checkAndGrantDailyAccelerators().catch(() => {});
    });
    window.addEventListener('focus', () => {
        checkAndGrantDailyAccelerators().catch(() => {});
        if (navigator.onLine !== false) {
            flushPendingActionsToCloud().catch(() => {});
            flushPendingNotes().catch(() => {});
            flushPendingHouseLayouts().catch(() => {});
            flushPendingLastPage().catch(() => {});
            flushPendingSupportReports().catch(() => {});
            flushPendingSupportReportUpdates().catch(() => {});
            flushPendingCustomAliases().catch(() => {});
            flushPendingTaskCooldowns().catch(() => {});
            flushPendingDailyBoostClaims().catch(() => {});
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkAndGrantDailyAccelerators().catch(() => {});
            if (navigator.onLine !== false) {
                flushPendingActionsToCloud().catch(() => {});
                flushPendingNotes().catch(() => {});
                flushPendingHouseLayouts().catch(() => {});
                flushPendingLastPage().catch(() => {});
                flushPendingSupportReports().catch(() => {});
                flushPendingSupportReportUpdates().catch(() => {});
                flushPendingCustomAliases().catch(() => {});
                flushPendingTaskCooldowns().catch(() => {});
                flushPendingDailyBoostClaims().catch(() => {});
            }
        }
    });
}

async function saveToCloud(rawText, command, parameters, outputText, resultLog = '', status = 'success') {
    try {
        await recordCommandAction(rawText, outputText, status, parameters);
    } catch (err) {
        console.error('Ошибка записи истории:', err);
    }
}

async function updateLoginTimestamp(userId) {
    if (!window.supabaseClient || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    try {
        await window.supabaseClient
            .from('profiles')
            .update({ 
                last_login: new Date().toISOString(),
                status: 'online'
            })
            .eq('id', userId);
    } catch (err) {
        console.warn('Не удалось обновить время входа:', err);
    }
}

// ==========================================
// Управление темами оформления (Dark / Light)
// ==========================================
function getCurrentTheme() {
    return localStorage.getItem('terminal_theme') || 'dark';
}

async function applyTheme(themeName) {
    const validTheme = themeName === 'light' ? 'light' : 'dark';
    
    // Применяем data-theme и класс на html и body
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', validTheme);
        document.documentElement.classList.toggle('theme-light', validTheme === 'light');
        document.documentElement.classList.toggle('theme-dark', validTheme === 'dark');
        
        if (document.body) {
            document.body.setAttribute('data-theme', validTheme);
            document.body.classList.toggle('theme-light', validTheme === 'light');
            document.body.classList.toggle('theme-dark', validTheme === 'dark');
        }
    }
    
    localStorage.setItem('terminal_theme', validTheme);

    // Оповещаем другие компоненты и iframe
    try {
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: validTheme } }));
        // Оповещение родительского окна (если в iframe)
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'THEME_CHANGE', theme: validTheme }, '*');
        }
        // Оповещение дочерних iframe
        document.querySelectorAll('iframe').forEach(frame => {
            try {
                frame.contentWindow?.postMessage({ type: 'THEME_CHANGE', theme: validTheme }, '*');
            } catch (e) {}
        });
    } catch (e) {}

    // Сохранение в БД в таблицу user_settings, если пользователь авторизован
    try {
        const user = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
        if (window.supabaseClient && user && !user.isGuest && user.id !== 'guest') {
            window.supabaseClient
                .from('user_settings')
                .upsert([
                    { user_id: user.id, theme: validTheme, updated_at: new Date().toISOString() }
                ], { onConflict: 'user_id' })
                .then(({ error }) => {
                    if (error) {
                        window.supabaseClient
                            .from('profiles')
                            .update({ theme: validTheme })
                            .eq('id', user.id)
                            .then(() => {})
                            .catch(() => {});
                    }
                }).catch(() => {});
        }
    } catch (e) {
        console.warn('Ошибка сохранения темы в БД:', e);
    }
}

async function initTheme() {
    const localTheme = getCurrentTheme();
    applyTheme(localTheme);

    // Фоновая проверка из Supabase при наличии авторизации
    try {
        if (window.supabaseClient) {
            const user = typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null;
            if (user && !user.isGuest && user.id !== 'guest') {
                const { data, error } = await window.supabaseClient
                    .from('user_settings')
                    .select('theme')
                    .eq('user_id', user.id)
                    .maybeSingle();

                if (!error && data && data.theme && data.theme !== localTheme) {
                    applyTheme(data.theme);
                }
            }
        }
    } catch (e) {}
}

function toggleThemeGlobal() {
    const current = getCurrentTheme();
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
}

window.getCurrentTheme = getCurrentTheme;
window.applyTheme = applyTheme;
window.initTheme = initTheme;
window.toggleThemeGlobal = toggleThemeGlobal;

if (typeof window !== 'undefined') {
    // Мгновенная синхронизация между вкладками браузера через StorageEvent
    window.addEventListener('storage', (event) => {
        if (event.key === 'terminal_theme' && event.newValue) {
            applyTheme(event.newValue);
        }
        if (event.key === CACHED_AUTH_USER_KEY || (event.key && event.key.startsWith(USER_HOUSES_STORAGE_PREFIX))) {
            const cached = getCachedAuthUser();
            if (event.key === CACHED_AUTH_USER_KEY) {
                currentUserCache = cached || null;
            }
            applyHouseNavVisibility(cached || currentUserCache);
        }
    });

    // Синхронизация между iframes через postMessage
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'THEME_CHANGE' && event.data.theme) {
            applyTheme(event.data.theme);
        }
    });

    if (typeof document !== 'undefined') {
        let globalAuthSyncAttached = false;
        const attachGlobalAuthSync = () => {
            if (globalAuthSyncAttached) return;
            if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.onAuthStateChange === 'function') {
                globalAuthSyncAttached = true;
                window.supabaseClient.auth.onAuthStateChange((event, session) => {
                    if (event === 'SIGNED_OUT') {
                        clearCurrentUserCache();
                        applyHouseNavVisibility(null);
                    } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session && session.user) {
                        if (!currentUserCache || currentUserCache.isGuest || currentUserCache.id !== session.user.id) {
                            clearCurrentUserCache();
                        }
                        if (session.access_token) {
                            cachedSupabaseAccessToken = session.access_token;
                        }
                        fetchCurrentUser().then((u) => {
                            applyHouseNavVisibility(u);
                            if (window.BackgroundModeSync && typeof window.BackgroundModeSync.pushConfigToSw === 'function') {
                                window.BackgroundModeSync.pushConfigToSw({ user: u, accessToken: session.access_token }).catch(() => {});
                            }
                        }).catch(() => {});
                    }
                });
            }
        };
        const initNavAndTheme = () => {
            initTheme();
            attachGlobalAuthSync();
            const cached = getCachedAuthUser();
            updateGlobalAuthBadge(cached);
            if (typeof fetchCurrentUser === 'function') {
                fetchCurrentUser().then((u) => applyHouseNavVisibility(u)).catch(() => applyHouseNavVisibility(null));
            } else {
                applyHouseNavVisibility(null);
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initNavAndTheme);
        } else {
            initNavAndTheme();
        }
    }
}

// =========================================================================
// Фоновый режим (PWA, разрешения, Wake Lock, Periodic/Background Sync, Worker)
// =========================================================================
(function () {
    const BG_ENABLED_KEY = 'terminal_bg_mode_enabled';
    const BG_DISMISSED_KEY = 'terminal_bg_prompt_dismissed';
    const BG_WAKELOCK_PREF_KEY = 'terminal_bg_wakelock_pref';
    const BG_SW_URL = '/service-worker.js?v=20261127_1';

    let deferredInstallPrompt = null;
    let activeWakeLock = null;
    let hasActiveTimersFlag = false;
    const listeners = new Set();

    function notifyChange() {
        listeners.forEach((fn) => {
            try { fn(); } catch (e) {}
        });
    }

    function isStandaloneMode() {
        try {
            return Boolean(
                (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
                (window.navigator && window.navigator.standalone === true)
            );
        } catch (e) {
            return false;
        }
    }

    function isIOSDevice() {
        try {
            const ua = String((window.navigator && window.navigator.userAgent) || '').toLowerCase();
            return /iphone|ipad|ipod/.test(ua);
        } catch (e) {
            return false;
        }
    }

    function getNotificationPermission() {
        try {
            if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
            return Notification.permission || 'default';
        } catch (e) {
            return 'unsupported';
        }
    }

    async function queryPermissionSafe(name) {
        try {
            if (typeof navigator === 'undefined' || !navigator.permissions || typeof navigator.permissions.query !== 'function') {
                return 'unsupported';
            }
            const res = await navigator.permissions.query({ name });
            return (res && res.state) || 'unsupported';
        } catch (e) {
            return 'unsupported';
        }
    }

    async function ensureServiceWorkerReady() {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
        try {
            let reg = await navigator.serviceWorker.getRegistration('/');
            if (!reg) {
                reg = await navigator.serviceWorker.register(BG_SW_URL, { updateViaCache: 'none' });
            }
            const readyReg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((resolve) => setTimeout(() => resolve(reg), 2500))
            ]);
            return readyReg || reg;
        } catch (e) {
            return null;
        }
    }

    async function resolveCurrentAccessToken() {
        if (cachedSupabaseAccessToken) return cachedSupabaseAccessToken;
        try {
            if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === 'function') {
                const { data } = await window.supabaseClient.auth.getSession();
                if (data && data.session && data.session.access_token) {
                    cachedSupabaseAccessToken = data.session.access_token;
                    return cachedSupabaseAccessToken;
                }
            }
        } catch (e) {}
        return null;
    }

    async function pushConfigToSw(options = {}) {
        const reg = await ensureServiceWorkerReady();
        const target = (navigator.serviceWorker && navigator.serviceWorker.controller) || (reg && (reg.active || reg.waiting || reg.installing));
        if (!target || typeof target.postMessage !== 'function') return false;

        let user = options.user || null;
        if (!user && typeof fetchCurrentUser === 'function') {
            try { user = await fetchCurrentUser(); } catch (e) {}
        }
        const token = options.accessToken || await resolveCurrentAccessToken();

        const msg = { type: 'BG_SYNC_CONFIG' };
        msg.config = {
            supabaseUrl: window.SUPABASE_URL || '',
            supabaseAnonKey: window.SUPABASE_ANON_KEY || '',
            accessToken: token || '',
            userId: user && user.id ? user.id : 'guest',
            isGuest: Boolean(!user || user.isGuest || !user.id || user.id === 'guest'),
            updatedAt: Date.now()
        };

        if (Array.isArray(options.timers)) {
            msg.timers = options.timers.map((t) => ({
                id: t.id,
                name: t.name,
                queue_group_id: t.queue_group_id,
                status: t.status,
                ends_at: t.ends_at,
                total_seconds: t.total_seconds,
                created_by: t.created_by
            }));
            hasActiveTimersFlag = msg.timers.length > 0;
        }
        if (Array.isArray(options.cooldowns)) {
            msg.cooldowns = options.cooldowns;
        }

        try {
            target.postMessage(msg);
        } catch (e) {}

        // Регистрируем одноразовый Sync в SW, чтобы при уходе в фон / восстановлении сети дошли обновления
        if (reg && 'sync' in reg && typeof reg.sync.register === 'function') {
            try { await reg.sync.register('dashboard-timers-sync'); } catch (e) {}
        }

        // Если браузер поддерживает NotificationTriggers (TimestampTrigger) — дополнительно ставим системный будильник на ближайшее завершение
        if (getNotificationPermission() === 'granted' && typeof window.TimestampTrigger === 'function' && reg && typeof reg.showNotification === 'function' && Array.isArray(msg.timers)) {
            const now = Date.now();
            msg.timers.forEach((t) => {
                const endMs = t && t.ends_at ? new Date(t.ends_at).getTime() : 0;
                if (endMs > now + 1500 && endMs - now < 12 * 3600 * 1000) {
                    const isBoil = t.name === 'Кипяток';
                    reg.showNotification(
                        isBoil ? '🔥 Кипяток готов!' : '⏱️ Таймер завершён!',
                        {
                            body: isBoil ? 'Вода закипела, пора заваривать чай или кофе!' : `Задача "${t.name}" выполнена.`,
                            icon: '/icon-512.png',
                            badge: '/badge.png',
                            tag: `trigger-${t.id || t.name}-${endMs}`,
                            showTrigger: new window.TimestampTrigger(endMs),
                            data: { url: '/dashboard.html', timerName: t.name }
                        }
                    ).catch(() => {});
                }
            });
        }

        return true;
    }

    async function requestWakeLockIfNeeded() {
        try {
            const pref = localStorage.getItem(BG_WAKELOCK_PREF_KEY);
            const wantWakeLock = pref === null ? true : pref === '1';
            const enabled = localStorage.getItem(BG_ENABLED_KEY) === '1';
            if (!wantWakeLock || !enabled || !hasActiveTimersFlag) {
                if (activeWakeLock) {
                    await activeWakeLock.release().catch(() => {});
                    activeWakeLock = null;
                }
                return false;
            }
            if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && document.visibilityState === 'visible') {
                if (!activeWakeLock) {
                    activeWakeLock = await navigator.wakeLock.request('screen');
                    if (activeWakeLock && typeof activeWakeLock.addEventListener === 'function') {
                        activeWakeLock.addEventListener('release', () => {
                            activeWakeLock = null;
                            notifyChange();
                        });
                    }
                    notifyChange();
                }
                return true;
            }
        } catch (e) {}
        return false;
    }

    function setWakeLockPreference(enabled) {
        try { localStorage.setItem(BG_WAKELOCK_PREF_KEY, enabled ? '1' : '0'); } catch (e) {}
        if (!enabled && activeWakeLock) {
            activeWakeLock.release().catch(() => {});
            activeWakeLock = null;
        } else if (enabled) {
            requestWakeLockIfNeeded();
        }
        notifyChange();
    }

    function getWakeLockPreference() {
        try {
            const val = localStorage.getItem(BG_WAKELOCK_PREF_KEY);
            return val === null ? true : val === '1';
        } catch (e) {
            return true;
        }
    }

    async function getStatus() {
        const notification = getNotificationPermission();
        const periodicSyncPerm = await queryPermissionSafe('periodic-background-sync');
        const backgroundSyncPerm = await queryPermissionSafe('background-sync');
        const installed = isStandaloneMode();
        const ios = isIOSDevice();
        const enabledByUser = (() => { try { return localStorage.getItem(BG_ENABLED_KEY) === '1'; } catch (e) { return false; } })();
        const dismissed = (() => { try { return localStorage.getItem(BG_DISMISSED_KEY) === '1'; } catch (e) { return false; } })();

        return {
            notification,
            periodicSyncPerm,
            backgroundSyncPerm,
            serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
            wakeLockSupported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
            wakeLockActive: Boolean(activeWakeLock),
            wakeLockPref: getWakeLockPreference(),
            installed,
            canInstall: Boolean(deferredInstallPrompt),
            isIOS: ios,
            enabledByUser,
            dismissed,
            needsAttention: notification !== 'granted' || !enabledByUser
        };
    }

    async function requestPermissions(options = {}) {
        let notifPerm = getNotificationPermission();
        if (typeof window !== 'undefined' && 'Notification' in window && notifPerm !== 'granted') {
            try {
                notifPerm = await Notification.requestPermission();
            } catch (e) {}
        }

        const reg = await ensureServiceWorkerReady();
        let syncRegistered = false;
        let periodicRegistered = false;

        if (reg && 'sync' in reg && typeof reg.sync.register === 'function') {
            try {
                await reg.sync.register('dashboard-timers-sync');
                syncRegistered = true;
            } catch (e) {}
        }

        if (reg && 'periodicSync' in reg && typeof reg.periodicSync.register === 'function') {
            try {
                await reg.periodicSync.register('dashboard-sync', { minInterval: 60 * 1000 });
                periodicRegistered = true;
            } catch (e) {}
        }

        try {
            localStorage.setItem(BG_ENABLED_KEY, '1');
            localStorage.removeItem(BG_DISMISSED_KEY);
        } catch (e) {}

        if (options.requestWakeLock !== false) {
            if (options.forceWakeLockNow && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
                try {
                    if (!activeWakeLock && document.visibilityState === 'visible') {
                        activeWakeLock = await navigator.wakeLock.request('screen');
                        activeWakeLock.addEventListener('release', () => { activeWakeLock = null; notifyChange(); });
                    }
                } catch (e) {}
            } else {
                await requestWakeLockIfNeeded();
            }
        }

        await pushConfigToSw().catch(() => {});

        // Отправляем немедленный тест/подтверждение в SW
        if (notifPerm === 'granted' && reg && typeof reg.showNotification === 'function' && options.silent !== true) {
            reg.showNotification('✅ Фоновый режим включён', {
                body: 'Таймеры Дашборда и фоновая синхронизация работают активно.',
                icon: '/icon-512.png',
                badge: '/badge.png',
                tag: 'bg-mode-enabled',
                data: { url: '/dashboard.html' }
            }).catch(() => {});
        }

        notifyChange();
        return {
            notification: notifPerm,
            syncRegistered,
            periodicRegistered,
            wakeLockActive: Boolean(activeWakeLock),
            needsManualSettings: notifPerm === 'denied'
        };
    }

    async function triggerInstallApp() {
        if (deferredInstallPrompt) {
            try {
                await deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    deferredInstallPrompt = null;
                    notifyChange();
                    return { installed: true };
                }
            } catch (e) {}
            return { installed: false };
        }
        if (isIOSDevice()) {
            return { iosGuide: true };
        }
        return { manualHint: true };
    }

    function dismissPromptBanner() {
        try { localStorage.setItem(BG_DISMISSED_KEY, '1'); } catch (e) {}
        notifyChange();
    }

    function reopenPromptBanner() {
        try { localStorage.removeItem(BG_DISMISSED_KEY); } catch (e) {}
        notifyChange();
    }

    function startBackgroundTicker(onTick, intervalMs = 1000) {
        if (typeof onTick !== 'function') return () => {};
        let stopped = false;
        let worker = null;
        let workerUrl = null;
        let fallbackTimer = null;

        try {
            if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                const code = `setInterval(() => postMessage('tick'), ${Math.max(250, Number(intervalMs) || 1000)});`;
                const blob = new Blob([code], { type: 'application/javascript' });
                workerUrl = URL.createObjectURL(blob);
                worker = new Worker(workerUrl);
                worker.onmessage = () => {
                    if (!stopped) onTick();
                };
            }
        } catch (e) {
            worker = null;
        }

        if (!worker) {
            fallbackTimer = setInterval(() => {
                if (!stopped) onTick();
            }, Math.max(250, Number(intervalMs) || 1000));
        }

        return () => {
            stopped = true;
            if (worker) {
                try { worker.terminate(); } catch (e) {}
                worker = null;
            }
            if (workerUrl) {
                try { URL.revokeObjectURL(workerUrl); } catch (e) {}
                workerUrl = null;
            }
            if (fallbackTimer) {
                clearInterval(fallbackTimer);
                fallbackTimer = null;
            }
        };
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            notifyChange();
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            notifyChange();
        });

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    requestWakeLockIfNeeded();
                    notifyChange();
                } else {
                    pushConfigToSw().catch(() => {});
                }
            });
        }
    }

    window.BackgroundModeSync = {
        getStatus,
        requestPermissions,
        triggerInstallApp,
        dismissPromptBanner,
        reopenPromptBanner,
        pushConfigToSw,
        requestWakeLockIfNeeded,
        setWakeLockPreference,
        getWakeLockPreference,
        setHasActiveTimers: (val) => {
            hasActiveTimersFlag = Boolean(val);
            requestWakeLockIfNeeded();
        },
        startBackgroundTicker,
        subscribe: (fn) => {
            if (typeof fn === 'function') listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
})();

// =========================================================================
// Undo / Cancel last command (стек отмены последней операции)
// =========================================================================
(function () {
    const UNDO_STACK_PREFIX = 'terminal_undo_stack_v1';
    const MAX_UNDO_ENTRIES = 25;
    const memoryUndoStacks = new Map();

    function resolveUid(userOverride) {
        if (userOverride && userOverride.id) return String(userOverride.id);
        if (currentUserCache && currentUserCache.id) return String(currentUserCache.id);
        const cached = getCachedAuthUser();
        if (cached && cached.id) return String(cached.id);
        return 'guest';
    }

    function getStackKey(userOverride = null) {
        return `${UNDO_STACK_PREFIX}::${resolveUid(userOverride)}`;
    }

    function loadStack(userOverride = null) {
        const key = getStackKey(userOverride);
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}
        return memoryUndoStacks.get(key) || [];
    }

    function saveStack(stack, userOverride = null) {
        const key = getStackKey(userOverride);
        const trimmed = Array.isArray(stack) ? stack.slice(-MAX_UNDO_ENTRIES) : [];
        memoryUndoStacks.set(key, trimmed);
        try {
            localStorage.setItem(key, JSON.stringify(trimmed));
        } catch (e) {}
    }

    function getTrackedKeys(uid) {
        const keys = [
            'terminal_theme',
            'terminal_lang',
            'terminal_offline_notes_cache',
            'terminal_offline_notes_pending_v1',
            `terminal_notes_cache_${uid}`,
            'terminal_pending_notes_ops',
            'terminal_demo_notes_store',
            'terminal_demo_buildings_store',
            'terminal_demo_tasks',
            'cloud_missions_store',
            'cloud_missions_ops_queue',
            'cloud_missions_completion_locks_v1',
            'cloud_missions_deleted',
            'terminal_local_fs_v1',
            `terminal_custom_aliases_${uid}`,
            `terminal_missions_v1::${uid}`,
            `${USER_HOUSES_STORAGE_PREFIX}::${uid}`,
            `terminal_pending_house_layouts::${uid}`
        ];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith('room_layout_') && !keys.includes(k)) {
                    keys.push(k);
                }
            }
        } catch (e) {}
        return keys;
    }

    function snapshotStorageMap(uid) {
        const snap = {};
        const keys = getTrackedKeys(uid);
        keys.forEach(k => {
            try {
                const v = localStorage.getItem(k);
                snap[k] = v === null ? null : String(v);
            } catch (e) {}
        });
        return snap;
    }

    function capturePreSnapshot(rawCommand, parsedCmd, userOverride = null) {
        const uid = resolveUid(userOverride);
        const cmdLower = String(parsedCmd || '').trim().toLowerCase();
        // Не перезаписываем состояние при вызове самой команды отмены
        if (['cancel', 'cancel last command', 'cancel last', 'undo', 'undo last', 'undo last command', 'отмена', 'отменить', 'отменить последнюю команду', 'отменить последнюю операцию', 'скасувати'].includes(cmdLower)) {
            return null;
        }
        return {
            uid,
            rawCommand: String(rawCommand || '').trim(),
            parsedCmd: cmdLower,
            storageBefore: snapshotStorageMap(uid),
            capturedAt: Date.now()
        };
    }

    function finalizePostSnapshot(preToken, resultObj, userOverride = null) {
        if (!preToken || !resultObj) return false;
        // Пропускаем многошаговые подсказки и ошибки / пустые операции
        if (resultObj.commandSteps || resultObj.commandPrefix) return false;
        if (resultObj.skipUndoSave || resultObj.noChange) return false;
        if (resultObj.style === 'output-error') return false;

        const uid = preToken.uid || resolveUid(userOverride);
        const afterMap = snapshotStorageMap(uid);
        const allKeys = new Set([...Object.keys(preToken.storageBefore || {}), ...Object.keys(afterMap)]);
        const changedKeys = [];

        allKeys.forEach(k => {
            const beforeVal = Object.prototype.hasOwnProperty.call(preToken.storageBefore, k) ? preToken.storageBefore[k] : null;
            const afterVal = Object.prototype.hasOwnProperty.call(afterMap, k) ? afterMap[k] : null;
            if (beforeVal !== afterVal) {
                changedKeys.push({
                    key: k,
                    before: beforeVal,
                    after: afterVal
                });
            }
        });

        const undoAction = resultObj.undoAction && typeof resultObj.undoAction === 'object' ? resultObj.undoAction : null;
        if (changedKeys.length === 0 && !undoAction) {
            return false;
        }

        const entry = {
            id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            rawCommand: preToken.rawCommand,
            parsedCmd: preToken.parsedCmd,
            description: (undoAction && undoAction.description) || resultObj.undoDescription || preToken.rawCommand || preToken.parsedCmd,
            changedKeys,
            undoAction,
            createdAt: Date.now()
        };

        const stack = loadStack({ id: uid });
        stack.push(entry);
        saveStack(stack, { id: uid });
        return true;
    }

    async function applyUndoAction(entry, user) {
        const act = entry && entry.undoAction;
        if (!act || !act.type) return;

        switch (act.type) {
            case 'supabase_delete_note': {
                if (window.supabaseClient && user && !user.isGuest) {
                    if (act.id) {
                        await window.supabaseClient.from('notes').delete().eq('id', act.id).eq('created_by', user.id);
                    } else if (act.inner_id) {
                        await window.supabaseClient.from('notes').delete().eq('inner_id', act.inner_id).eq('created_by', user.id);
                    }
                }
                if (window.OfflineNotesSync && user && user.id) {
                    const cache = window.OfflineNotesSync.getNotesCache(user.id).filter(n =>
                        (act.id && n.id !== act.id) || (act.inner_id && n.inner_id !== act.inner_id)
                    );
                    window.OfflineNotesSync.saveNotesCache(user.id, cache);
                }
                break;
            }
            case 'supabase_restore_note_content': {
                if (window.supabaseClient && user && !user.isGuest && Array.isArray(act.prevNotes)) {
                    for (const prev of act.prevNotes) {
                        await window.supabaseClient
                            .from('notes')
                            .update({ content: prev.content })
                            .eq('inner_id', prev.inner_id)
                            .eq('created_by', user.id);
                    }
                }
                break;
            }
            case 'supabase_restore_notes_pin': {
                if (window.supabaseClient && user && !user.isGuest && Array.isArray(act.items)) {
                    for (const it of act.items) {
                        await window.supabaseClient
                            .from('notes')
                            .update({ is_pinned: Boolean(it.prevPinned) })
                            .eq('inner_id', it.inner_id)
                            .eq('created_by', user.id);
                    }
                }
                break;
            }
            case 'supabase_restore_notes_deleted': {
                if (window.supabaseClient && user && !user.isGuest && Array.isArray(act.innerIds) && act.innerIds.length > 0) {
                    await window.supabaseClient
                        .from('notes')
                        .update({ deleted_at: act.restoreToDeletedAt === undefined ? null : act.restoreToDeletedAt })
                        .in('inner_id', act.innerIds)
                        .eq('created_by', user.id);
                }
                break;
            }
            case 'supabase_delete_building': {
                if (window.supabaseClient && user && !user.isGuest && act.buildingId) {
                    await window.supabaseClient.from('terminal_buildings').delete().eq('id', act.buildingId).eq('created_by', user.id);
                }
                break;
            }
            case 'supabase_restore_building': {
                if (window.supabaseClient && user && !user.isGuest) {
                    const rows = Array.isArray(act.buildings) ? act.buildings : (act.building ? [act.building] : []);
                    if (rows.length > 0) {
                        await window.supabaseClient.from('terminal_buildings').insert(rows);
                    }
                }
                break;
            }
            case 'supabase_restore_building_tasks': {
                if (window.supabaseClient && user && !user.isGuest && Array.isArray(act.snapshots)) {
                    for (const snap of act.snapshots) {
                        await window.supabaseClient
                            .from('terminal_buildings')
                            .update({ tasks: snap.tasks || [], updated_at: new Date().toISOString() })
                            .eq('id', snap.id)
                            .eq('created_by', user.id);
                    }
                }
                break;
            }
            case 'supabase_delete_timer': {
                if (window.supabaseClient && user && !user.isGuest && act.innerId) {
                    await window.supabaseClient.from('active_timers').delete().eq('inner_id', act.innerId).eq('created_by', user.id);
                }
                break;
            }
            case 'supabase_restore_timer': {
                if (window.supabaseClient && user && !user.isGuest && act.timer) {
                    await window.supabaseClient.from('active_timers').insert([act.timer]);
                }
                break;
            }
            case 'missions_delete': {
                if (window.MissionsStore && act.missionId && typeof window.MissionsStore.deleteMission === 'function') {
                    await window.MissionsStore.deleteMission(act.missionId);
                }
                break;
            }
            case 'missions_reopen': {
                if (window.MissionsStore && act.missionId && typeof window.MissionsStore.restoreMission === 'function') {
                    await window.MissionsStore.restoreMission(act.missionId);
                }
                break;
            }
            case 'missions_restore': {
                if (window.MissionsStore && Array.isArray(act.prevState)) {
                    window.MissionsStore.missions = JSON.parse(JSON.stringify(act.prevState));
                    if (typeof window.MissionsStore.saveLocal === 'function') {
                        window.MissionsStore.saveLocal();
                    }
                    if (typeof window.MissionsStore.trySyncSupabase === 'function') {
                        await window.MissionsStore.trySyncSupabase(true).catch(() => {});
                    }
                }
                break;
            }
            case 'local_fs_trash': {
                if (window.LocalFS && act.name && typeof window.LocalFS.trash === 'function') {
                    await window.LocalFS.trash(act.name);
                }
                break;
            }
            case 'local_fs_restore_trash': {
                if (window.LocalFS && act.name && typeof window.LocalFS.restore === 'function') {
                    await window.LocalFS.restore(act.name);
                }
                break;
            }
            case 'local_fs_rename': {
                if (window.LocalFS && act.newName && act.oldName && typeof window.LocalFS.rename === 'function') {
                    await window.LocalFS.rename(act.newName, act.oldName);
                }
                break;
            }
            case 'custom_aliases_restore': {
                if (window.CustomAliasesSync && typeof window.CustomAliasesSync.applyStoredCustomAliases === 'function') {
                    window.CustomAliasesSync.applyStoredCustomAliases();
                }
                if (Array.isArray(act.addedAliases) && window.CommandRegistry && window.CommandRegistry._aliases) {
                    act.addedAliases.forEach(a => {
                        delete window.CommandRegistry._aliases[String(a).toLowerCase()];
                    });
                }
                break;
            }
            default:
                break;
        }
    }

    async function executeUndo(userOverride = null) {
        const user = userOverride || (typeof fetchCurrentUser === 'function' ? await fetchCurrentUser() : null);
        const uid = resolveUid(user);
        const stack = loadStack({ id: uid });
        if (!stack.length) {
            return {
                response: 'ℹ️ Нет операций для отмены.',
                style: 'output-info',
                skipHistorySave: true,
                skipUndoSave: true
            };
        }

        const entry = stack.pop();
        saveStack(stack, { id: uid });

        let restoredHousesState = null;
        const restoredLayouts = [];
        let themeRestored = null;
        let langRestored = null;

        // 1. Восстанавливаем изменённые ключи localStorage
        const changes = Array.isArray(entry.changedKeys) ? entry.changedKeys : [];
        for (const ch of changes) {
            try {
                if (ch.key === `${USER_HOUSES_STORAGE_PREFIX}::${uid}`) {
                    if (ch.before === null) {
                        localStorage.removeItem(ch.key);
                    } else {
                        const parsed = JSON.parse(ch.before);
                        const afterParsed = ch.after ? JSON.parse(ch.after) : null;
                        const maxTs = Math.max(
                            Number(parsed && parsed.ts) || 0,
                            Number(afterParsed && afterParsed.ts) || 0
                        );
                        const undoTs = Math.max(Date.now(), maxTs + 1);
                        parsed.ts = undoTs;
                        parsed.updatedAt = new Date(undoTs).toISOString();
                        localStorage.setItem(ch.key, JSON.stringify(parsed));
                        restoredHousesState = parsed;
                    }
                } else if (ch.key.startsWith('room_layout_') && !ch.key.endsWith('_ts')) {
                    if (ch.before === null) {
                        localStorage.removeItem(ch.key);
                    } else {
                        const parsedLayout = JSON.parse(ch.before);
                        const prevTs = Number(localStorage.getItem(`${ch.key}_ts`) || 0);
                        const undoTs = Math.max(Date.now(), prevTs + 1);
                        localStorage.setItem(ch.key, JSON.stringify(parsedLayout));
                        localStorage.setItem(`${ch.key}_ts`, String(undoTs));
                        restoredLayouts.push({ storageKey: ch.key, layout: parsedLayout, undoTs });
                    }
                } else {
                    if (ch.before === null) {
                        localStorage.removeItem(ch.key);
                    } else {
                        localStorage.setItem(ch.key, ch.before);
                    }
                    if (ch.key === 'terminal_theme') themeRestored = ch.before || 'dark';
                    if (ch.key === 'terminal_lang') langRestored = ch.before || 'ru';
                }
            } catch (e) {}
        }

        // 2. Специфичные отменяющие действия (Supabase / LocalFS / Aliases / Missions)
        try {
            await applyUndoAction(entry, user);
        } catch (err) {
            console.warn('Undo action error:', err);
        }

        // 3. Применяем тему / язык / навигацию / облачную синхронизацию домов и комнат
        if (themeRestored) {
            await applyTheme(themeRestored).catch(() => {});
        }
        if (langRestored && typeof window.I18n !== 'undefined' && typeof window.I18n.setLang === 'function') {
            window.I18n.setLang(langRestored);
        }

        if (restoredHousesState && user && !user.isGuest) {
            try {
                await syncUserHousesToDb(user, restoredHousesState);
            } catch (e) {}
            applyHouseNavVisibility(user);
        } else if (user) {
            applyHouseNavVisibility(user);
        }

        if (restoredLayouts.length > 0 && user && !user.isGuest) {
            for (const rl of restoredLayouts) {
                const roomName = rl.storageKey.replace(/^room_layout_/, '').replace(/_v1$/, '');
                try {
                    await saveAndSyncHouseLayout(roomName, rl.layout, user, rl.undoTs);
                } catch (e) {}
            }
        }

        // 4. Если открыта страница Дома (HouseEngine), обновляем сцену без перезагрузки
        try {
            if (window.HouseEngine && typeof window.HouseEngine.refreshAfterExternalChange === 'function') {
                await window.HouseEngine.refreshAfterExternalChange();
            }
        } catch (e) {}

        const desc = String(entry.description || entry.rawCommand || 'последняя операция').trim();
        return {
            response: `Canceled\n↩️ Отмена последней операции: ${desc}`,
            style: 'output-success',
            skipUndoSave: true
        };
    }

    function peek(userOverride = null) {
        const stack = loadStack(userOverride);
        return stack.length > 0 ? stack[stack.length - 1] : null;
    }

    function clear(userOverride = null) {
        saveStack([], userOverride);
    }

    if (typeof window !== 'undefined') {
        window.CommandUndo = {
            getStackKey,
            capturePreSnapshot,
            finalizePostSnapshot,
            executeUndo,
            peek,
            clear
        };
    }
})();



