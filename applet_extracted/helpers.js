// helpers.js — утилиты, парсер, сессия Supabase Auth и работа с ID

let currentUserCache = null;

// Функция безопасного выхода из системы
async function performLogout() {
    try {
        // 1. Берем ID из кэша, пока сессия еще активна
        const userId = currentUserCache ? currentUserCache.id : null;

        // 2. Если ID найден, переводим статус в offline в базе данных
        if (userId) {
            await window.supabaseClient
                .from('profiles')
                .update({ status: 'offline' })
                .eq('id', userId);
        }

        // 3. Выполняем выход в Supabase Auth
        const { error } = await window.supabaseClient.auth.signOut();
        if (error) throw error;

    } catch (err) {
        // console.error('Ошибка выхода:', err);
        printOutput('❌ Ошибка выхода: ' + err.message, 'output-error', true);
    }
}

async function fetchCurrentUser() {
    try {
        const { data: { session }, error: sessionError } = await window.supabaseClient.auth.getSession();
        if (sessionError || !session) return null;

        const authUser = session.user;

        // Запрашиваем через select() без жесткого single(), чтобы увидеть результат даже при отсутствии или дубликатах
        const { data: profiles, error: profileError } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', authUser.id);

        if (profileError) {
            // Печатаем ТОЧНЫЙ текст ошибки Supabase в консоль
            console.error('⚠️ Ошибка запроса профиля из Supabase:', profileError.message || profileError);
            printOutput(`⚠️ Ошибка получения профиля: ${profileError.message || 'см. консоль'}`, 'output-error', false);
        }

        const profile = (profiles && profiles.length > 0) ? profiles[0] : null;

        if (!profile) {
            console.warn(`⚠️ Профиль для ID [${authUser.id}] не найден в таблице profiles!`);
        }

        // Если профиля в БД нет, но это вы — гарантированно выдаем root
        const fallbackRole = (authUser.email === 'e.grinec@gmail.com') ? 'root' : 'user';

        const userObj = {
            id: authUser.id,
            email: authUser.email,
            name: profile?.name || authUser.user_metadata?.full_name || authUser.email.split('@')[0],
            nickname: profile?.nickname || 'Не задан',
            role: profile?.role || fallbackRole
        };

        currentUserCache = userObj;
        return userObj;
    } catch (err) {
        console.error('❌ Критическая ошибка в fetchCurrentUser:', err);
        return null;
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

    const cmd = parts[0] ? parts[0].toLowerCase() : '';
    let actualCmd = cmd;
    let prefixWordsCount = 1;

    // Проверяем двухсловные команды (например, "add note")
    if (parts.length > 1) {
        const potentialTwoWord = cmd + ' ' + parts[1].toLowerCase();
        if (window.CommandRegistry && window.CommandRegistry.getHandler(potentialTwoWord)) {
            actualCmd = potentialTwoWord;
            prefixWordsCount = 2;
        }
    }

    // Получаем чистый остаток строки после команды
    const raw_args = rawText.trim().replace(new RegExp(`^([^\\s]+\\s+){0,${prefixWordsCount}}`), '').trim();

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
            console.error('Ошибка поиска последнего ID:', err);
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

async function saveToCloud(rawText, command, parameters, outputText, resultLog = '', status = 'success') {
    try {
        const user = currentUserCache;
        if (!user || user.id === 'guest') return; // Не сохраняем в Supabase команды неавторизованного пользователя
        await window.supabaseClient
            .from('commands_history')
            .insert([{ 
                raw_text: rawText,
                command: command, 
                parameters: parameters, 
                output: outputText, 
                result: resultLog || outputText, 
                status: status,
                created_by: user.id
            }]);
    } catch (err) {
        console.error('Ошибка записи истории:', err);
    }
}

async function updateLoginTimestamp(userId) {
    try {
        await window.supabaseClient
            .from('profiles')
            .update({ 
                last_login: new Date().toISOString(),
                status: 'online'
            })
            .eq('id', userId);
    } catch (err) {
        // console.error('Не удалось обновить время входа:', err);
        printOutput('Не удалось обновить время входа:', 'output-error');
    }
}
