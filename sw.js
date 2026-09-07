/* Cache the shell so the app opens without a network — the whole point of
   adding it to a home screen. Rooms are computed on the device, so once the
   files are here nothing else is needed. */
const CACHE = 'sound-stage-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './src/style.css', './src/app.js', './src/engine.js',
  './src/brir.js', './src/venues.js', './src/acoustics.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit)),
  );
});
