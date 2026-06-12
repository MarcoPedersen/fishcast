/* FishCast Service Worker — cache-first app shell */
const CACHE = 'fishcast-v59';
const SHELL = [
  '/fishcast/',
  '/fishcast/index.html',
  '/fishcast/app.js?v=59',
  '/fishcast/style.css?v=59',
  '/fishcast/solunar.js?v=59',
  '/fishcast/spots-dk.js?v=59',
  '/fishcast/regulations-dk.js?v=59',
  '/fishcast/manifest.json',
  '/fishcast/icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only cache GET requests for same-origin app shell
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isShell = url.origin === self.location.origin && url.pathname.startsWith('/fishcast/');
  if (!isShell) return; // let API calls go straight to network

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/fishcast/index.html'));
    })
  );
});

// Notification click — focus or open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      const fc = list.find(c => c.url.includes('/fishcast/'));
      if (fc) return fc.focus();
      return clients.openWindow('/fishcast/');
    })
  );
});
