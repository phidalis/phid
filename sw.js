// SportyCash PWA Service Worker
// Strategy: NETWORK FIRST — so every update you push to GitHub
// is immediately seen in the app. Cache is only a fallback.

const CACHE = 'sportycash-v1';
const CORE = ['/', '/index.html', '/aviator.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

// Install — pre-cache core pages silently
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))
  );
});

// Activate — remove any old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch — NETWORK FIRST
// 1. Try network → serve fresh response AND update cache
// 2. If network fails (offline/poor signal) → serve from cache
// This means: whenever you update your site, the app gets it instantly.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and external domains (Firebase, fonts, APIs etc.)
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Clone and cache the fresh response
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => {
        // Offline fallback: serve from cache
        return caches.match(e.request).then(cached => cached || caches.match('/index.html'));
      })
  );
});
