// Minimal cache-first service worker. Caches the app shell + Tesseract WASM/lang
// data on the fly so repeat use (and offline) is fast on mobile.
const CACHE = 'termlink-hack-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const resp = await fetch(request);
        // Cache same-origin assets and Tesseract CDN payloads.
        if (resp.ok && (resp.type === 'basic' || resp.type === 'cors')) {
          cache.put(request, resp.clone());
        }
        return resp;
      } catch (err) {
        return cached || Response.error();
      }
    })
  );
});
