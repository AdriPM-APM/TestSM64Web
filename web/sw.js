/* sw.js — offline cache for the SM64 web build.
 * The engine is a ~10 MB wasm binary; caching it means the second launch starts
 * from disk instead of the network. The game itself runs out of RAM (wasm memory),
 * this only removes the download. */
const VERSION = 'sm64-v1';
const CORE = [
  './',
  'index.html',
  'pad.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'sm64.us.js',
  'sm64.us.wasm.gz'   /* the compressed engine; ~5.7 MB instead of 12.7 MB */
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* Cache each file independently: one 404 must not break the whole install. */
    await Promise.all(CORE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await c.put(url, res);
      } catch (_) { /* offline or missing: fine */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations: serve the shell from cache first so a cold, offline launch works. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match('index.html');
      if (hit) return hit;
      try { return await fetch(req); } catch (_) { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    if (hit) {
      /* Refresh large assets in the background only when the network is cheap to use. */
      if (navigator.onLine) {
        fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); }).catch(() => {});
      }
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    } catch (_) {
      return new Response('Offline', { status: 503 });
    }
  })());
});
