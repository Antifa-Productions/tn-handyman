/**
 * T&N Handyman Service Worker
 * Strategy: Network First (HTML), Stale While Revalidate (CSS/JS), Cache First (Images)
 * No unsafe-eval or unsafe-inline.
 */

importScripts('/workbox/workbox-sw.js');

// Configure Workbox to load from our local path
workbox.setConfig({
    modulePathPrefix: '/workbox/',
    debug: false, // Set true for debugging in DevTools Console
});

const CACHE_VERSION = 'v1';
const CACHE_NAME = `tn-handyman-${CACHE_VERSION}`;
const IMAGE_CACHE_NAME = `tn-images-${CACHE_VERSION}`;

// Assets to precache (update this list whenever you change files)
// Ideally, generate this list via your build script (hash-files.mjs pattern)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/contact.html',
    '/css/style.css',
    '/js/main.js',
    '/manifest.webmanifest',
    '/images/logo.svg',
];

// Install: Precache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        }).catch((err) => {
            console.error('Precaching failed:', err);
        })
    );
    self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
    const currentCaches = [CACHE_NAME, IMAGE_CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!currentCaches.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch: Routing Strategies
workbox.routing.registerRoute(
    ({
        request
    }) => request.destination === 'document',
    new workbox.strategies.NetworkFirst({
        cacheName: CACHE_NAME,
        plugins: [
            new workbox.cacheableResponse.CacheableResponse({
                statuses: [0, 200],
            }),
            new workbox.expiration.ExpirationPlugin({
                maxEntries: 30,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
            }),
        ],
    })
);

workbox.routing.registerRoute(
    ({
        request
    }) => ['style', 'script', 'font'].includes(request.destination),
    new workbox.strategies.StaleWhileRevalidate({
        cacheName: CACHE_NAME,
        plugins: [
            new workbox.cacheableResponse.CacheableResponse({
                statuses: [0, 200],
            }),
            new workbox.expiration.ExpirationPlugin({
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            }),
        ],
    })
);

workbox.routing.registerRoute(
    ({
        request
    }) => request.destination === 'image',
    new workbox.strategies.CacheFirst({
        cacheName: IMAGE_CACHE_NAME,
        plugins: [
            new workbox.cacheableResponse.CacheableResponse({
                statuses: [0, 200],
            }),
            new workbox.expiration.ExpirationPlugin({
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
            }),
        ],
    })
);

// Handle offline fallback for documents (optional but recommended)
// If NetworkFirst fails, try to serve a generic offline page if it exists
// You can add /offline.html to PRECACHE_ASSETS and handle it here if needed.

/* Diagnostics support (sw-check.html) */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PING' && event.ports[0]) {
        event.ports[0].postMessage({
            pong: true,
            cacheVersion: CACHE_VERSION
        });
    }
});
