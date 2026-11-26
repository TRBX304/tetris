// ===========================================
// Service Worker
// HTML/JS/CSS は「ネットワーク優先 → だめならキャッシュ」
// 更新がすぐ届き、オフラインでも遊べる
// ===========================================
const CACHE_NAME = 'tetris-like-v3';
const PRECACHE = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './js/main.js',
    './js/ui.js',
    './js/game.js',
    './js/pieces.js',
    './js/rng.js',
    './js/config.js',
    './js/settings.js',
    './js/effects.js',
    './js/input.js',
    './js/audio.js',
    './js/ai.js',
    './js/battle.js',
    './js/ranking.js',
    './js/records.js',
    './js/stars.js',
    './js/online.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(names => Promise.all(
            names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);
    // 自分のサイトの GET だけ扱う（Supabase などは素通し）
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
});
