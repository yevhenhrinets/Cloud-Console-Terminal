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

function isAdminUser(user) {
    if (!user || user.isGuest || user.id === 'guest') return false;
    const role = String(user.role || '').toLowerCase();
    const email = String(user.email || '').toLowerCase();
    return ['root', 'support', 'admin'].includes(role) || email === 'e.grinec@gmail.com' || email === 'yevhenhrinets@gmail.com';
}
if (typeof window !== 'undefined') {
    window.isAdminUser = isAdminUser;
}

function parseCommand(rawText) {
    if (!rawText) return { cmd: '', parameters: { args: [], raw_args: '' } };

    const parts = rawText.trim().split(/\s+/);

    // Очищаем первые слова от двоеточий на конце (например, "note:", "add:")
    for (let i = 0; i < Math.min(parts.length, 8); i++) {
        if (parts[i].endsWith(':')) {
            parts[i] = parts[i].slice(0, -1);
        }
    }

    const lowerParts = parts.map(p => p.toLowerCase());
    const cmd = lowerParts[0] || '';
    let actualCmd = cmd;
    let prefixWordsCount = 1;

    // Самое длинное совпадение (до 8 слов включительно)
    if (parts.length > 1 && window.CommandRegistry) {
        const maxWords = Math.min(parts.length, 8);
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
const HOUSE_PENDING_LAYOUTS_KEY = 'terminal_pending_house_layouts';
const HOUSE_LAYOUTS_MISSING_SESSION_KEY = 'terminal_house_layouts_missing_v1';
let houseLayoutsFlushPromise = null;
let houseLayoutsTableMissing = false;
try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HOUSE_LAYOUTS_MISSING_SESSION_KEY) === '1') {
        houseLayoutsTableMissing = true;
    }
} catch (e) {}

function markHouseLayoutsTableMissing() {
    houseLayoutsTableMissing = true;
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(HOUSE_LAYOUTS_MISSING_SESSION_KEY, '1');
        }
    } catch (e) {}
}

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

async function resolveAuthenticatedDbUser() {
    if (window.supabaseClient && window.supabaseClient.auth) {
        try {
            const { data } = await window.supabaseClient.auth.getSession();
            if (data && data.session && data.session.user && data.session.user.id) {
                return {
                    id: data.session.user.id,
                    email: data.session.user.email || '',
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

async function flushPendingHouseLayouts() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    if (!window.supabaseClient) return 0;

    if (houseLayoutsFlushPromise) return houseLayoutsFlushPromise;

    houseLayoutsFlushPromise = (async () => {
        try {
            const pendingMap = getPendingHouseLayouts();
            const rooms = Object.keys(pendingMap);
            if (rooms.length === 0) return 0;

            const user = await resolveAuthenticatedDbUser();
            if (!user) return 0;

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

async function fetchAllHouseLayoutsFromDb(roomIds = []) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return {};
    if (!window.supabaseClient) return {};

    const resultMap = {};
    try {
        const user = await resolveAuthenticatedDbUser();
        if (!user) return {};

        const cleanRoomIds = Array.isArray(roomIds) ? roomIds.map(String).filter(Boolean) : [];

        if (!houseLayoutsTableMissing && cleanRoomIds.length > 0) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('house_layouts')
                    .select('room, layout, updated_at')
                    .eq('user_id', user.id)
                    .in('room', cleanRoomIds);

                if (!error && Array.isArray(data)) {
                    data.forEach(row => {
                        if (row && row.room && row.layout) {
                            const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                            const prev = resultMap[row.room];
                            const prevTs = prev && prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
                            if (!prev || ts >= prevTs) {
                                resultMap[row.room] = { layout: row.layout, updatedAt: row.updated_at || null };
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
            .select('raw_text, parameters, created_at')
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
                const updatedAt = p.updated_at || row.created_at || null;
                const ts = updatedAt ? new Date(updatedAt).getTime() : 0;
                const prev = resultMap[roomName];
                const prevTs = prev && prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
                if (!prev || ts >= prevTs) {
                    resultMap[roomName] = { layout: p.layout, updatedAt };
                }
            });
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
    fetchRoomLayoutFromDb,
    fetchAllHouseLayoutsFromDb
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
            flushPendingLastPage().catch(() => {});
            flushPendingSupportReports().catch(() => {});
            flushPendingSupportReportUpdates().catch(() => {});
            flushPendingCustomAliases().catch(() => {});
            flushPendingTaskCooldowns().catch(() => {});
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine !== false) {
            flushPendingActionsToCloud().catch(() => {});
            flushPendingNotes().catch(() => {});
            flushPendingHouseLayouts().catch(() => {});
            flushPendingLastPage().catch(() => {});
            flushPendingSupportReports().catch(() => {});
            flushPendingSupportReportUpdates().catch(() => {});
            flushPendingCustomAliases().catch(() => {});
            flushPendingTaskCooldowns().catch(() => {});
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

