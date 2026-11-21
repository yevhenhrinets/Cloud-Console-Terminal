const CACHE_NAME = 'terminal-v37';

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
    '/commands/add.js',
    '/commands/aliases.js',
    '/commands/auth.js',
    '/commands/building.js',
    '/commands/del.js',
    '/commands/edit.js',
    '/commands/fs.js',
    '/commands/go_to.js',
    '/commands/help.js',
    '/commands/history.js',
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
