/* Reality Tech service worker.
 * - Pre-caches the static app shell so pages open fast and an offline page can be shown.
 * - NEVER intercepts /api/* requests: data and SMS actions always go straight to the network,
 *   so an offline action can never appear to have succeeded. */
const VERSION = 'rt-v1';
const STATIC = `${VERSION}-static`;
const SHELL = [
  '/offline.html', '/index.html', '/login.html', '/admin/login.html', '/change-password.html',
  '/css/app.css', '/manifest.json',
  '/js/core/api.js', '/js/core/ui.js', '/js/core/layout.js', '/js/core/charts.js', '/js/core/pwa.js', '/js/core/landing.js',
  '/js/pages/login.js', '/js/pages/changePassword.js',
  '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache or fake API traffic

  if (req.mode === 'navigate') {
    // Pages: network first (fresh deployments), fall back to cache, then the offline page.
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match('/offline.html'))));
    return;
  }
  // Static assets: stale-while-revalidate.
  event.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); } return res; }).catch(() => cached);
    return cached || net;
  }));
});
