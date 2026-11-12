// Service Worker: hält nur die App-Dateien für einen schnellen Start bereit.
// Anfragen an Home Assistant (/api, /auth, Bilder) werden nie zwischengespeichert.
// Läuft nur über https (oder localhost) – über http lässt der Browser ihn weg, die App geht trotzdem.
const CACHE = 'musik-v7';
const SCOPE_PATH = new URL('./', self.location).pathname;
const FILES = ['./', 'index.html', 'style.css?v=2.3.0', 'app.js?v=2.3.0', 'ha.js?v=2.3.0', 'local.js?v=2.3.0', 'ingress.js?v=2.3.0', 'ma.js?v=2.3.0', 'manifest.webmanifest', 'version.json', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (url.searchParams.has('code')) return; // Rückkehr von der Anmeldung
  // Zuerst Netz (immer aktuelle Version), bei Ausfall Zwischenspeicher
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // immer bei Home Assistant nachfragen, ob es Neues gibt
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
