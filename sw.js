// RAID Pokemon Go Hub — Service Worker
// Bump this version string whenever app.js/index.html/style.css change,
// so returning visitors get the new files instead of a stale cache.
const CACHE_NAME = 'raid-hub-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Raid bosses, events, full dex, sprites, type chart, weather boosts — all
// live/changing data. Always try the network first so the info stays fresh;
// only fall back to the last successfully cached copy if offline.
function isDataRequest(url) {
  return url.hostname === 'raw.githubusercontent.com' || url.hostname === 'pogoapi.net';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  event.respondWith(isDataRequest(url) ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    // Offline and this exact file was never cached (e.g. a deep link) —
    // serve the app shell instead of a browser error page.
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
