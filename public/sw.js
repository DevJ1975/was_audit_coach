/**
 * WLS Audit Coach service worker — makes the WEB SHELL itself offline-capable
 * (NN #3: every screen works with zero connectivity; the data layer already
 * does via SQLite/OPFS, but without this a reload in the plant was a white
 * screen because the JS bundle only lived on the network).
 *
 * Strategy:
 *  - navigations (index.html): network-first, cache fallback — deploys land on
 *    next online load, offline reloads still boot.
 *  - /_expo/static/* and /assets/* (content-hashed, immutable — includes the
 *    617 kB sqlite wasm): cache-first, so boots never re-download them.
 *  - other same-origin GETs (icons, manifest): stale-while-revalidate.
 * Cross-origin requests (Supabase) are never intercepted.
 *
 * NOTE: bump CACHE on strategy changes; hashed bundle names handle the rest.
 */
const CACHE = 'wls-audit-coach-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase/API calls

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          const copy = res.clone();
          // waitUntil keeps the worker alive until the put lands — without it
          // the refresh bandwidth is spent but the cache may never update.
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
