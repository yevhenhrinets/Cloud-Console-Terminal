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
        currentUserCache = null;
        clearCachedAuthUser();
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
        const fallbackRole = (authUser.email === 'e.grinec@gmail.com') ? 'root' : 'user';

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

function parseCommand(rawText) {
    if (!rawText) return { cmd: '', parameters: { args: [], raw_args: '' } };

    const parts = rawText.trim().split(/\s+/);
    
    // Очищаем первые слова от двоеточий на конце (например, "note:", "add:")
    if (parts.length > 0 && parts[0].endsWith(':')) {
        parts[0] = parts[0].slice(0, -1);
    }
    if (parts.length > 1 && parts[1].endsWith(':')) {
        parts[1] = parts[1].slice(0, -1);
    }
    if (parts.length > 2 && parts[2].endsWith(':')) {
        parts[2] = parts[2].slice(0, -1);
    }

    if (parts.length > 3 && parts[3].endsWith(':')) {
        parts[3] = parts[3].slice(0, -1);
    }

    const cmd = parts[0] ? parts[0].toLowerCase() : '';
    let actualCmd = cmd;
    let prefixWordsCount = 1;

    // Проверяем четырехсловные команды (например, "make last note fixed")
    if (parts.length > 3 && window.CommandRegistry) {
        const potentialFourWord = cmd + ' ' + parts[1].toLowerCase() + ' ' + parts[2].toLowerCase() + ' ' + parts[3].toLowerCase();
        if (window.CommandRegistry.getHandler(potentialFourWord)) {
            actualCmd = potentialFourWord;
            prefixWordsCount = 4;
        }
    }

    // Проверяем трехсловные команды (например, "go to missions", "go to hall", "go to kitchen")
    if (prefixWordsCount === 1 && parts.length > 2 && window.CommandRegistry) {
        const potentialThreeWord = cmd + ' ' + parts[1].toLowerCase() + ' ' + parts[2].toLowerCase();
        if (window.CommandRegistry.getHandler(potentialThreeWord)) {
            actualCmd = potentialThreeWord;
            prefixWordsCount = 3;
        }
    }

    // Проверяем двухсловные команды (например, "add note", "show notes", "make fixed")
    if (prefixWordsCount === 1 && parts.length > 1 && window.CommandRegistry) {
        const potentialTwoWord = cmd + ' ' + parts[1].toLowerCase();
        if (window.CommandRegistry.getHandler(potentialTwoWord)) {
            actualCmd = potentialTwoWord;
            prefixWordsCount = 2;
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
        'go to house 2 kitchen', 'go to house2 kitchen', 'go to kitchen 2', 'go to kitchen2',
        'kitchen 2', 'kitchen2', 'кухня 2', 'кухня2', 'go kitchen 2', 'open kitchen 2', 'go to кухня 2'
    ].includes(lower)) {
        return 'nav:house2_kitchen';
    }
    if ([
        'go to house 2 hall', 'go to house2 hall', 'go to hall 2', 'go to hall2',
        'hall 2', 'hall2', 'зал 2', 'зала 2', 'зал2', 'go hall 2', 'open hall 2', 'go to зал 2'
    ].includes(lower)) {
        return 'nav:house2_hall';
    }
    if ([
        'go to house 2', 'go to house2', 'house 2', 'house2', 'дом 2', 'дом2', 'будинок 2', 'go house 2', 'open house 2', 'go to дом 2'
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
        'go to house', 'go to house 1', 'house', 'house 1', 'дом', 'дом 1', 'будинок', 'go house', 'open house', 'go to дом'
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
// Синхронизация расположения объектов в House (Kitchen / Hall) с БД
// =========================================================================
const HOUSE_PENDING_LAYOUTS_KEY = 'terminal_pending_house_layouts';
let houseLayoutsFlushPromise = null;
let houseLayoutsTableMissing = false;

function getPendingHouseLayouts() {
    try {
        const raw = localStorage.getItem(HOUSE_PENDING_LAYOUTS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function savePendingHouseLayouts(map) {
    try {
        localStorage.setItem(HOUSE_PENDING_LAYOUTS_KEY, JSON.stringify(map || {}));
    } catch (e) {}
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

async function flushPendingHouseLayouts() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    if (houseLayoutsFlushPromise) return houseLayoutsFlushPromise;

    houseLayoutsFlushPromise = (async () => {
        try {
            const pendingMap = getPendingHouseLayouts();
            const rooms = Object.keys(pendingMap);
            if (rooms.length === 0) return 0;

            const user = await fetchCurrentUser(true);
            if (!user || user.isGuest || !user.id || user.id === 'guest') return 0;

            let syncedCount = 0;

            for (const room of rooms) {
                const entry = pendingMap[room];
                if (!entry || !entry.layout) continue;

                const updatedAt = entry.updatedAt || new Date(entry.ts || Date.now()).toISOString();
                let savedOk = false;

                if (!houseLayoutsTableMissing) {
                    try {
                        const { error } = await window.supabaseClient
                            .from('house_layouts')
                            .upsert([{
                                id: `${user.id}_${room}`,
                                user_id: user.id,
                                room,
                                layout: entry.layout,
                                updated_at: updatedAt
                            }], { onConflict: 'id' });

                        if (!error) {
                            savedOk = true;
                        } else if (isMissingTableError(error)) {
                            houseLayoutsTableMissing = true;
                        } else if (isOfflineNetworkError(error)) {
                            throw error;
                        }
                    } catch (e) {
                        if (isOfflineNetworkError(e)) throw e;
                    }
                }

                if (!savedOk) {
                    const markerRawText = `__house_layout__:${room}`;
                    const { data: existingRows, error: selErr } = await window.supabaseClient
                        .from('commands_history')
                        .select('id')
                        .eq('created_by', user.id)
                        .eq('command', '__house_layout__')
                        .eq('raw_text', markerRawText)
                        .is('deleted_at', null)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (selErr) {
                        if (isOfflineNetworkError(selErr)) throw selErr;
                    }

                    const payloadParams = {
                        room,
                        layout: entry.layout,
                        updated_at: updatedAt
                    };

                    let updatedInPlace = false;
                    if (existingRows && existingRows[0] && existingRows[0].id) {
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
                        const { error: insErr } = await window.supabaseClient
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
                            }]);

                        if (insErr) {
                            if (isOfflineNetworkError(insErr)) throw insErr;
                            console.warn('House layout DB save error:', insErr.message);
                        } else {
                            savedOk = true;
                        }
                    }
                }

                if (savedOk) {
                    const latestPending = getPendingHouseLayouts();
                    if (latestPending[room] && Number(latestPending[room].ts || 0) <= Number(entry.ts || 0)) {
                        delete latestPending[room];
                        savePendingHouseLayouts(latestPending);
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

async function fetchRoomLayoutFromDb(room) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    if (!window.supabaseClient) return null;

    try {
        const user = await fetchCurrentUser(true);
        if (!user || user.isGuest || !user.id || user.id === 'guest') return null;

        if (!houseLayoutsTableMissing) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('house_layouts')
                    .select('layout, updated_at')
                    .eq('user_id', user.id)
                    .eq('room', room)
                    .order('updated_at', { ascending: false })
                    .limit(1);

                if (!error && data && data[0] && data[0].layout) {
                    return { layout: data[0].layout, updatedAt: data[0].updated_at || null };
                }
                if (error && isMissingTableError(error)) {
                    houseLayoutsTableMissing = true;
                }
            } catch (e) {}
        }

        const { data: rows, error: histErr } = await window.supabaseClient
            .from('commands_history')
            .select('parameters, created_at')
            .eq('created_by', user.id)
            .eq('command', '__house_layout__')
            .eq('raw_text', `__house_layout__:${room}`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1);

        if (!histErr && rows && rows[0] && rows[0].parameters && rows[0].parameters.layout) {
            return {
                layout: rows[0].parameters.layout,
                updatedAt: rows[0].parameters.updated_at || rows[0].created_at || null
            };
        }
    } catch (e) {
        console.warn('fetchRoomLayoutFromDb error:', e);
    }
    return null;
}

function saveAndSyncHouseLayout(room, layoutObj) {
    if (!room || !layoutObj) return;
    const nowMs = Date.now();
    const updatedAt = new Date(nowMs).toISOString();
    const pendingMap = getPendingHouseLayouts();
    pendingMap[room] = {
        room,
        layout: layoutObj,
        updatedAt,
        ts: nowMs
    };
    savePendingHouseLayouts(pendingMap);

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        flushPendingHouseLayouts().catch(() => {});
    }
}

window.HouseLayoutSync = {
    getPendingHouseLayouts,
    saveAndSyncHouseLayout,
    flushPendingHouseLayouts,
    fetchRoomLayoutFromDb
};

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
        if (window.MissionsStore && typeof window.MissionsStore.trySyncSupabase === 'function') {
            await window.MissionsStore.trySyncSupabase(false);
        }
    } catch (e) {}
}

window.flushAllOfflineConsoleQueues = flushAllOfflineConsoleQueues;

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        flushAllOfflineConsoleQueues().catch(() => {});
    });
    window.addEventListener('focus', () => {
        if (navigator.onLine !== false) {
            flushPendingActionsToCloud().catch(() => {});
            flushPendingNotes().catch(() => {});
            flushPendingHouseLayouts().catch(() => {});
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine !== false) {
            flushPendingActionsToCloud().catch(() => {});
            flushPendingNotes().catch(() => {});
            flushPendingHouseLayouts().catch(() => {});
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
    });

    // Синхронизация между iframes через postMessage
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'THEME_CHANGE' && event.data.theme) {
            applyTheme(event.data.theme);
        }
    });

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initTheme);
        } else {
            initTheme();
        }
    }
}

