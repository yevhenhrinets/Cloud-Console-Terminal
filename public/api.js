// api.js — конфигурация и надежное подключение к Supabase (с поддержкой прямого REST fallback)
window.SUPABASE_URL = 'https://qecyotztitajldibychu.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_HdMyTN9U9GOMG1DzpJcrDg_6RCnU37G';

(function(window) {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;

    // Прямой REST-клиент для Supabase (работает ВСЕГДА, даже если CDN @supabase/supabase-js недоступен или заблокирован)
    window.supabaseDirectApi = {
        async select(table, query = '') {
            const endpoint = `${url}/rest/v1/${table}${query ? '?' + query : ''}`;
            const res = await fetch(endpoint, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Accept': 'application/json'
                }
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (e) { parsed = text; }

            if (!res.ok) {
                const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}: ${res.statusText}`);
                err.code = parsed?.code || String(res.status);
                err.details = parsed?.details || '';
                err.hint = parsed?.hint || '';
                err.status = res.status;
                throw err;
            }
            return parsed;
        },

        async insert(table, rows) {
            const endpoint = `${url}/rest/v1/${table}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(rows)
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (e) { parsed = text; }

            if (!res.ok) {
                const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}: ${res.statusText}`);
                err.code = parsed?.code || String(res.status);
                err.details = parsed?.details || '';
                err.hint = parsed?.hint || '';
                err.status = res.status;
                throw err;
            }
            return parsed;
        },

        async upsert(table, rows) {
            const endpoint = `${url}/rest/v1/${table}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                body: JSON.stringify(rows)
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (e) { parsed = text; }

            if (!res.ok) {
                const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}: ${res.statusText}`);
                err.code = parsed?.code || String(res.status);
                err.details = parsed?.details || '';
                err.hint = parsed?.hint || '';
                err.status = res.status;
                throw err;
            }
            return parsed;
        },

        async update(table, id, data) {
            const endpoint = `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
            const res = await fetch(endpoint, {
                method: 'PATCH',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(data)
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (e) { parsed = text; }

            if (!res.ok) {
                const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}: ${res.statusText}`);
                err.code = parsed?.code || String(res.status);
                err.details = parsed?.details || '';
                err.hint = parsed?.hint || '';
                err.status = res.status;
                throw err;
            }
            return parsed;
        },

        async delete(table, id) {
            const endpoint = `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
            const res = await fetch(endpoint, {
                method: 'DELETE',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`
                }
            });
            if (!res.ok) {
                const text = await res.text();
                let parsed = null;
                try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
                const err = new Error(parsed?.message || parsed?.error || `HTTP ${res.status}: ${res.statusText}`);
                err.code = parsed?.code || String(res.status);
                err.details = parsed?.details || '';
                err.hint = parsed?.hint || '';
                err.status = res.status;
                throw err;
            }
            return true;
        }
    };

    // Диагностическая функция для проверки подключения к Supabase
    window.testSupabaseConnection = async function() {
        const start = performance.now();
        try {
            const data = await window.supabaseDirectApi.select('missions', 'select=*&limit=10');
            const latency = Math.round(performance.now() - start);
            return {
                ok: true,
                latency,
                count: Array.isArray(data) ? data.length : 0,
                data: data,
                error: null
            };
        } catch (err) {
            const latency = Math.round(performance.now() - start);
            return {
                ok: false,
                latency,
                count: 0,
                data: null,
                error: {
                    message: err.message,
                    code: err.code || 'UNKNOWN',
                    details: err.details || '',
                    hint: err.hint || '',
                    status: err.status || 0
                }
            };
        }
    };

    // Инициализация стандартного supabaseClient (если подключен @supabase/supabase-js)
    try {
        const sb = window.supabase || (typeof supabase !== 'undefined' ? supabase : null);
        if (sb && typeof sb.createClient === 'function') {
            window.supabaseClient = sb.createClient(url, key);
            console.log('✅ Supabase JS SDK успешно инициализирован');
        } else {
            console.warn('⚠️ Библиотека @supabase/supabase-js не найдена в глобальной области, будет использован прямой REST fallback');
        }
    } catch (e) {
        console.error('Ошибка инициализации Supabase SDK:', e);
    }
})(window);