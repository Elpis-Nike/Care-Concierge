// Offline support: cache the app shell so the demo works without internet at the pitch.
var CACHE = 'care-concierge-v2';
var FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/core.js', './js/world.js', './js/services.js', './js/policy.js', './js/agent.js', './js/health.js',
  './js/brain.js', './js/proactive.js', './js/voice.js', './js/ui.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Network first (so updates arrive), cache as fallback when offline.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
