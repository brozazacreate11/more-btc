// Service worker: приложението работи и офлайн с последните заредени данни.
// Стратегия: първо мрежата (винаги най-новата версия), кешът е резерва.
// При всяка промяна в приложението вдигни номера (същият е APP_VERSION в app.js).
const CACHE = 'morebtc-v5';
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const SHELL = ['./', 'index.html', 'app.css', 'i18n.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', CDN];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.href === CDN) { // библиотеката не се променя: кеш първо
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  if (url.origin !== location.origin) return; // външните API-та винаги на живо
  // cache: 'no-cache' = винаги питай сървъра дали има нова версия (GitHub Pages иначе държи файловете 10 мин.)
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
