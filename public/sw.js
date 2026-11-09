'use strict';

const CACHE_NAME = 'sovli-shell-v44-0';
const SHELL = [
  '/',
  '/styles.css?v=31',
  '/app.js?v=43',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/socket.io/socket.io.js',
  '/owner',
  '/owner.css?v=24',
  '/owner.js?v=26',
  '/owner-manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('sovli-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.js') return;

  const isNavigation = request.mode === 'navigate';
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const cacheKey = isNavigation ? url.pathname : request;
        caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, response.clone())).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request) || await caches.match(url.pathname) || (isNavigation ? await caches.match('/') : null);
      return cached || Response.error();
    })
  );
});
