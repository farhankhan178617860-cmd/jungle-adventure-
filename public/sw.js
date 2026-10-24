// public/sw.js  --  service worker (this is what lets phones install the game as an app)
// Strategy: NETWORK FIRST. Online, you always get the newest game files (no stale-code problems after an update).
// If the network is gone, the last copy of a file that was loaded before is used, so the app still opens
// and shows its lobby. The game itself needs the server, so it cannot be played offline.
// WebSocket traffic (the multiplayer connection) never goes through here.
const CACHE = 'jungle-ruins-v1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/health') return; // CDN files, health check: browser decides
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true }); // /?room=ABCD falls back to the cached "/"
      if (hit) return hit;
      throw err;
    }
  })());
});
