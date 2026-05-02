const CACHE_NAME = 'lemurtube-v22';

















const APP_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/styles/index.css',
  '/src/main.js',
  '/src/api/youtube.js',
  '/src/config.js',
  '/src/db/storage.js',
  '/src/logic/queueEngine.js',
  '/src/ui/queueDrawer.js'
];



self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // For YouTube API calls or any external resources, just use the network
  if (!e.request.url.startsWith(self.location.origin)) {
    e.respondWith(fetch(e.request));
    return;
  }
  
  // Cache First Strategy for our local app files so it works forever offline
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
