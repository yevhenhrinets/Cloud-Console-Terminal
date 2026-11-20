const CACHE_NAME = 'terminal-v2';

// Установка и кэширование базовых файлов
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(['/', '/dashboard.html', '/dashboard.css', '/dashboard-logic.js', '/dashboard-ui.js']);
        })
    );
    self.skipWaiting();
});

// Перехват запросов: Сначала пытаемся получить из сети, если нет — из кэша
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Если файл успешно скачался из интернета, можно обновить его в кэше (по желанию)
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});


