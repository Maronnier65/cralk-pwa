/*
 * Service worker for CRALK PWA
 *
 * This service worker implements a basic offline-first strategy. It caches
 * essential assets on installation and returns cached versions when offline.
 */

// Update the cache name whenever the application shell changes to ensure
// users receive the latest assets. Bump the version if index.html,
// main.js, styles.css or other static files are modified.
// Bump the cache version to force refresh after significant updates.
// Each release should increment this suffix.
const CACHE_NAME = 'cralk-cache-v32';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

/**
 * On install, cache the application shell (static assets).
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

/**
 * On activate, remove old caches if any.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

/**
 * Intercept fetch requests and serve from cache when possible.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests for same-origin resources
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(request).then((networkResponse) => {
          // Optionally cache new resources
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        })
      );
    })
  );
});
