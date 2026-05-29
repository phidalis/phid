const CACHE_NAME = 'sportycash-cache-v4';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './aviator.html',
  './cash.html',
  './pesa-managers-login.html',
  './pesa-dashboard.html',
  './manifest.json',
  './sw.js'
];

// Inline offline page — no separate file needed
const OFFLINE_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline – SportyCash</title><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;background:#080b10;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}.icon{font-size:60px;margin-bottom:20px}h1{font-size:24px;font-weight:900;margin-bottom:8px}p{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:28px;line-height:1.6}.btn{padding:14px 32px;background:#f97316;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer}</style></head><body><div class="icon">📡</div><h1>You're Offline</h1><p>No internet connection.<br>Check your connection and try again.</p><button class="btn" onclick="location.reload()">Try Again</button></body></html>`;

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
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
              return cache.put(event.request, clone);
            })
          );
          return response;
        })
        .catch(() => {
          // Offline: serve from cache, fallback to offline.html
          return caches.match(event.request)
            .then(cached => cached || new Response(OFFLINE_HTML, {headers:{'Content-Type':'text/html'}}));
        })
    );
  } else {
    // Cache-first for JS, CSS, images, fonts
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
              try { return cache.put(event.request, clone); } catch(e) { /* quota exceeded */ }
            })
          );
          return response;
        }).catch(() => new Response(OFFLINE_HTML, {headers:{'Content-Type':'text/html'}}));
      })
    );
  }
});
