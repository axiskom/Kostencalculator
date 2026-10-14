// Verhoog CACHE bij elke wijziging aan de bestanden, dan krijgen gebruikers de nieuwe versie.
const CACHE = 'batchkosten-v10';
const BESTANDEN = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/logo-96.png',
  'icons/favicon-64.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Eerst uit de cache (werkt offline), ondertussen op de achtergrond verversen.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const bewaard = await cache.match(req, { ignoreSearch: true });
      const netwerk = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (bewaard) return bewaard;
      return (await netwerk) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
