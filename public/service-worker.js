const CACHE_NAME = 'terminal-v62';

const URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/terminal.html',
    '/dashboard.html',
    '/missions.html',
    '/house/index.html',
    '/house2/index.html',
    '/house3/index.html',
    '/house/kitchen.html',
    '/house/hall.html',
    '/house2/kitchen.html',
    '/house2/hall.html',
    '/kitchen.html',
    '/hall.html',
    '/house.css',
    '/house-engine.js',
    '/api.js',
    '/registry.js',
    '/helpers.js',
    '/localization.js',
    '/missions-store.js',
    '/commands-actions.js',
    '/commands.js',
    '/local-fs.js',
    '/dashboard.css',
    '/dashboard-logic.js',
    '/dashboard-ui.js',
    '/style.css',
    '/manifest.json',
    '/floor.svg',
    '/house/floor.svg',
    '/table.svg',
    '/sofa.svg',
    '/icon.svg',
    '/icon-512.png',
    '/pwa-192x192.png',
    '/pwa-maskable-512x512.png',
    '/apple-touch-icon.png',
    '/commands/add.js',
    '/commands/aliases.js',
    '/commands/auth.js',
    '/commands/building.js',
    '/commands/cancel.js',
    '/commands/del.js',
    '/commands/edit.js',
    '/commands/fs.js',
    '/commands/go_to.js',
    '/commands/help.js',
    '/commands/history.js',
    '/commands/houses.js',
    '/commands/inventory.js',
    '/commands/lang.js',
    '/commands/missions.js',
    '/commands/note_history.js',
    '/commands/pin.js',
    '/commands/read.js',
    '/commands/restore.js',
    '/commands/show.js',
    '/commands/support.js',
    '/commands/system.js',
    '/commands/task.js',
    '/commands/theme.js',
    '/commands/timers.js',
    '/commands/trash_history.js',
    '/commands/trash_notes.js',
    '/commands/unpin.js'
];

// Установка и кэширование всех файлов приложения (принудительно свежие версии в обход HTTP-кэша браузера)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                URLS_TO_CACHE.map((url) =>
                    fetch(new Request(url, { cache: 'no-store' }))
                        .then((res) => {
                            if (res && res.status === 200) {
                                return cache.put(url, res);
                            }
                        })
                        .catch((err) => {
                            console.warn('SW cache skip:', url, err);
                        })
                )
            );
        })
    );
    self.skipWaiting();
});

// Активация и удаление старых кэшей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Перехват запросов: Network-First в обход HTTP-кэша с обновлением кэша и ignoreSearch fallback для ?v=...
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    const isSameOrigin = url.origin === self.location.origin;

    const networkPromise = isSameOrigin
        ? fetch(new Request(req.url, { cache: 'no-store' }))
        : fetch(req);

    event.respondWith(
        networkPromise
            .then((response) => {
                if (isSameOrigin && response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(url.pathname, clone).catch(() => {});
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(req, { ignoreSearch: true }).then((cached) => {
                    if (cached) return cached;
                    if (req.mode === 'navigate') {
                        return caches.match('/index.html', { ignoreSearch: true });
                    }
                    return cached;
                });
            })
    );
});

// =========================================================================
// Фоновая синхронизация таймеров Дашборда и уведомления в Service Worker
// =========================================================================
const BG_IDB_NAME = 'cloud_terminal_bg_db';
const BG_IDB_STORE = 'kv';
let swWakeupTimerId = null;
let bgSyncInFlight = null;

function openBgIdb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const req = indexedDB.open(BG_IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(BG_IDB_STORE)) {
                db.createObjectStore(BG_IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IDB open failed'));
    });
}

async function bgIdbGet(key) {
    try {
        const db = await openBgIdb();
        return await new Promise((resolve) => {
            const tx = db.transaction(BG_IDB_STORE, 'readonly');
            const store = tx.objectStore(BG_IDB_STORE);
            const r = store.get(key);
            r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
            r.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

async function bgIdbSet(key, val) {
    try {
        const db = await openBgIdb();
        await new Promise((resolve) => {
            const tx = db.transaction(BG_IDB_STORE, 'readwrite');
            const store = tx.objectStore(BG_IDB_STORE);
            store.put(val, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (e) {}
}

function buildRestHeaders(cfg) {
    const anonKey = cfg.supabaseAnonKey || '';
    const token = cfg.accessToken || anonKey;
    return {
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

async function showSwTimerNotification(timerName, tagKey) {
    if (!self.registration || typeof self.registration.showNotification !== 'function') return;
    let perm = 'default';
    try {
        perm = typeof Notification !== 'undefined' ? Notification.permission : 'granted';
    } catch (e) {
        perm = 'granted';
    }
    if (perm !== 'granted') return;

    let title = '⏱️ Таймер завершён!';
    let body = `Задача "${timerName}" выполнена.`;
    if (timerName === 'Кипяток') {
        title = '🔥 Кипяток готов!';
        body = 'Вода закипела, пора заваривать чай или кофе!';
    }
    try {
        await self.registration.showNotification(title, {
            body,
            icon: '/icon-512.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300, 100, 300],
            tag: tagKey || `terminal-timer-${timerName}`,
            renotify: true,
            data: { url: '/dashboard.html', timerName }
        });
    } catch (e) {}
}

async function showSwCooldownNotification(cd) {
    if (!cd || !self.registration || typeof self.registration.showNotification !== 'function') return;
    let perm = 'default';
    try {
        perm = typeof Notification !== 'undefined' ? Notification.permission : 'granted';
    } catch (e) {
        perm = 'granted';
    }
    if (perm !== 'granted') return;

    const title = cd.key === 'памперс' ? '👶 Пора менять памперс!' : '🔥 Кипяток снова готов!';
    const body = cd.readyText || `Кулдаун "${cd.label || cd.key}" завершён.`;
    try {
        await self.registration.showNotification(title, {
            body,
            icon: '/icon-512.png',
            badge: '/badge.png',
            vibrate: [250, 100, 250],
            tag: `cooldown-ready-${cd.key}`,
            renotify: true,
            data: { url: '/dashboard.html', cooldownKey: cd.key }
        });
    } catch (e) {}
}

async function notifyOpenClients(message) {
    try {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        list.forEach((client) => {
            try { client.postMessage(message); } catch (e) {}
        });
    } catch (e) {}
}

async function processBackgroundTimersAndSync() {
    if (bgSyncInFlight) return bgSyncInFlight;
    bgSyncInFlight = (async () => {
        const now = Date.now();
        const cfg = await bgIdbGet('bg_config');
        const notifiedMap = (await bgIdbGet('bg_notified')) || {};
        // Очищаем старые отметки уведомлений старше 24 часов
        Object.keys(notifiedMap).forEach((k) => {
            if (now - Number(notifiedMap[k] || 0) > 86400000) delete notifiedMap[k];
        });

        let completedCount = 0;

        // 1. Проверяем локальный снимок таймеров (работает и для гостя, и как быстрый триггер)
        const cachedTimers = (await bgIdbGet('bg_timers')) || [];
        const stillPendingLocal = [];
        for (const t of cachedTimers) {
            const endMs = t && t.ends_at ? new Date(t.ends_at).getTime() : 0;
            if (endMs && now >= endMs) {
                const nKey = `timer:${t.id || t.name}:${endMs}`;
                if (!notifiedMap[nKey]) {
                    notifiedMap[nKey] = now;
                    await showSwTimerNotification(t.name, `terminal-timer-${t.queue_group_id || ''}-${t.name}`);
                    completedCount++;
                }
            } else if (t) {
                stillPendingLocal.push(t);
            }
        }
        await bgIdbSet('bg_timers', stillPendingLocal);

        // 2. Проверяем кулдауны
        const cachedCooldowns = (await bgIdbGet('bg_cooldowns')) || [];
        const nextCooldowns = [];
        for (const cd of cachedCooldowns) {
            const readyAt = Number(cd && cd.readyAt) || 0;
            if (readyAt && now >= readyAt) {
                const cKey = `cd:${cd.key}:${readyAt}`;
                if (!notifiedMap[cKey]) {
                    notifiedMap[cKey] = now;
                    await showSwCooldownNotification(cd);
                    completedCount++;
                }
            } else if (cd) {
                nextCooldowns.push(cd);
            }
        }
        await bgIdbSet('bg_cooldowns', nextCooldowns);

        // 3. Фоновая синхронизация с Supabase (если пользователь авторизован)
        let syncedRemote = false;
        if (cfg && !cfg.isGuest && cfg.userId && cfg.supabaseUrl && cfg.supabaseAnonKey) {
            try {
                const headers = buildRestHeaders(cfg);
                const base = cfg.supabaseUrl;
                const uid = encodeURIComponent(cfg.userId);
                const tRes = await fetch(`${base}/rest/v1/active_timers?created_by=eq.${uid}&order=ends_at.asc`, {
                    method: 'GET',
                    cache: 'no-store',
                    headers
                });

                if (tRes.ok) {
                    const serverTimers = await tRes.json();
                    const expired = [];
                    const remaining = [];
                    (Array.isArray(serverTimers) ? serverTimers : []).forEach((t) => {
                        const endMs = t && t.ends_at ? new Date(t.ends_at).getTime() : 0;
                        if (endMs && now >= endMs) expired.push(t);
                        else remaining.push(t);
                    });

                    if (expired.length > 0) {
                        const invRes = await fetch(`${base}/rest/v1/completed_items?created_by=eq.${uid}`, {
                            method: 'GET',
                            cache: 'no-store',
                            headers
                        });
                        const serverInv = invRes.ok ? (await invRes.json()) : [];

                        for (const timer of expired) {
                            await fetch(`${base}/rest/v1/active_timers?id=eq.${encodeURIComponent(timer.id)}`, {
                                method: 'DELETE',
                                headers
                            });

                            const endMs = timer.ends_at ? new Date(timer.ends_at).getTime() : now;
                            const nKey = `timer:${timer.id || timer.name}:${endMs}`;
                            if (!notifiedMap[nKey]) {
                                notifiedMap[nKey] = now;
                                await showSwTimerNotification(timer.name, `terminal-timer-${timer.queue_group_id || ''}-${timer.name}`);
                            }

                            let invName = timer.name;
                            if (invName === 'Вытереть') invName = 'Вытерто';
                            const existing = (Array.isArray(serverInv) ? serverInv : []).find((i) => i.name === invName);
                            if (existing) {
                                existing.count = (Number(existing.count) || 0) + 1;
                                await fetch(`${base}/rest/v1/completed_items?id=eq.${encodeURIComponent(existing.id)}`, {
                                    method: 'PATCH',
                                    headers,
                                    body: JSON.stringify({ count: existing.count, updated_at: new Date().toISOString() })
                                });
                            } else {
                                const insRes = await fetch(`${base}/rest/v1/completed_items`, {
                                    method: 'POST',
                                    headers: { ...headers, 'Prefer': 'return=representation' },
                                    body: JSON.stringify([{ name: invName, count: 1, created_by: cfg.userId }])
                                });
                                if (insRes.ok) {
                                    const createdRows = await insRes.json();
                                    if (Array.isArray(createdRows) && createdRows[0]) serverInv.push(createdRows[0]);
                                }
                            }
                            completedCount++;
                        }

                        // Обновляем статусы running / queued в оставшихся таймерах
                        const groups = {};
                        remaining.forEach((t) => {
                            const gKey = String(t.queue_group_id);
                            if (!groups[gKey]) groups[gKey] = [];
                            groups[gKey].push(t);
                        });
                        for (const items of Object.values(groups)) {
                            for (let i = 0; i < items.length; i++) {
                                const expected = i === 0 ? 'running' : 'queued';
                                if (items[i].status !== expected) {
                                    items[i].status = expected;
                                    await fetch(`${base}/rest/v1/active_timers?id=eq.${encodeURIComponent(items[i].id)}`, {
                                        method: 'PATCH',
                                        headers,
                                        body: JSON.stringify({ status: expected })
                                    });
                                }
                            }
                        }
                    }

                    await bgIdbSet('bg_timers', remaining);
                    syncedRemote = true;
                }
            } catch (e) {}
        }

        await bgIdbSet('bg_notified', notifiedMap);
        await scheduleNextSwWakeup();

        if (completedCount > 0 || syncedRemote) {
            await notifyOpenClients({ type: 'BG_TIMERS_UPDATED', completedCount, ts: now });
        }
        return { ok: true, completedCount, syncedRemote };
    })().finally(() => {
        bgSyncInFlight = null;
    });

    return bgSyncInFlight;
}

async function scheduleNextSwWakeup() {
    if (swWakeupTimerId) {
        clearTimeout(swWakeupTimerId);
        swWakeupTimerId = null;
    }
    const now = Date.now();
    const timers = (await bgIdbGet('bg_timers')) || [];
    const cooldowns = (await bgIdbGet('bg_cooldowns')) || [];
    let earliest = Infinity;

    timers.forEach((t) => {
        const ms = t && t.ends_at ? new Date(t.ends_at).getTime() : 0;
        if (ms > now && ms < earliest) earliest = ms;
    });
    cooldowns.forEach((cd) => {
        const ms = Number(cd && cd.readyAt) || 0;
        if (ms > now && ms < earliest) earliest = ms;
    });

    if (earliest !== Infinity) {
        const delay = Math.max(500, Math.min(earliest - now + 150, 290000));
        swWakeupTimerId = setTimeout(() => {
            processBackgroundTimersAndSync();
        }, delay);
    }
}

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'BG_SYNC_CONFIG') {
        event.waitUntil((async () => {
            if (data.config) {
                await bgIdbSet('bg_config', data.config);
            }
            if (Array.isArray(data.timers)) {
                await bgIdbSet('bg_timers', data.timers);
            }
            if (Array.isArray(data.cooldowns)) {
                await bgIdbSet('bg_cooldowns', data.cooldowns);
            }
            await scheduleNextSwWakeup();
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({ ok: true });
            }
        })());
    } else if (data.type === 'BG_SYNC_NOW') {
        event.waitUntil((async () => {
            const res = await processBackgroundTimersAndSync();
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage(res);
            }
        })());
    }
});

self.addEventListener('sync', (event) => {
    if (!event.tag || event.tag === 'dashboard-timers-sync' || event.tag === 'background-sync') {
        event.waitUntil(processBackgroundTimersAndSync());
    }
});

self.addEventListener('periodicsync', (event) => {
    if (!event.tag || event.tag === 'dashboard-sync') {
        event.waitUntil(processBackgroundTimersAndSync());
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || '/dashboard.html';
    event.waitUntil((async () => {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of list) {
            if (client.url && client.url.includes('/dashboard.html') && typeof client.focus === 'function') {
                return client.focus();
            }
        }
        if (list.length > 0 && typeof list[0].focus === 'function') {
            await list[0].focus();
            if (typeof list[0].navigate === 'function') {
                return list[0].navigate(targetUrl);
            }
        }
        if (self.clients.openWindow) {
            return self.clients.openWindow(targetUrl);
        }
    })());
});

