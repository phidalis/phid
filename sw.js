const CACHE_NAME = 'sportycash-cache-v2';
const OFFLINE_URL = '/offline.html';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/aviator.html',
  '/cash.html',
  '/pesa-managers-login.html',
  '/pesa-dashboard.html',
  '/manifest.json',
  '/sw.js',
  OFFLINE_URL
];

// ── INSTALL: pre-cache all pages ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    }).catch(err => {
      // Don't fail install if optional pages can't be cached
      console.warn('[SW] Cache addAll partial fail:', err);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: delete old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: network-first for HTML, cache-first for assets ─────
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (Firebase, CDNs etc.)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isHTMLRequest = event.request.headers.get('accept')?.includes('text/html')
    || event.request.url.endsWith('.html')
    || event.request.url.endsWith('/');

  if (isHTMLRequest) {
    // Network-first for HTML pages (always try to get fresh)
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache a fresh copy
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: serve from cache, fallback to offline.html
          return caches.match(event.request)
            .then(cached => cached || caches.match(OFFLINE_URL));
        })
    );
  } else {
    // Cache-first for JS, CSS, images, fonts
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(event.request, clone); } catch(e) { /* quota exceeded */ }
          });
          return response;
        }).catch(() => caches.match(OFFLINE_URL));
      })
    );
  }
});
