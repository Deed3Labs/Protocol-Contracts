// Service Worker for background sync and offline support
const CACHE_NAME = 'protocol-contracts-v1';
const API_CACHE_NAME = 'protocol-api-v1';

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll([
        '/',
        '/index.html',
        // Add other static assets as needed
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip non-API requests (let browser handle them)
  if (!url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.open(API_CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached response
          return cachedResponse;
        }

        // Fetch from network
        return fetch(request)
          .then((response) => {
            // Clone the response
            const responseToCache = response.clone();

            // Cache successful responses
            if (response.status === 200) {
              cache.put(request, responseToCache);
            }

            return response;
          })
          .catch(() => {
            // Network failed, return cached response if available
            return cachedResponse || new Response(
              JSON.stringify({ error: 'Network error', offline: true }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
      });
    })
  );
});

// Background sync for queued requests
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-portfolio') {
    event.waitUntil(syncPortfolio());
  }
});

// Sync portfolio data in background
async function syncPortfolio() {
  try {
    // Get stored address from IndexedDB or cache
    const cache = await caches.open(API_CACHE_NAME);
    const keys = await cache.keys();
    
    // Refresh cached API endpoints
    for (const request of keys) {
      try {
        const response = await fetch(request);
        if (response.status === 200) {
          await cache.put(request, response.clone());
        }
      } catch (error) {
        console.error('[Service Worker] Failed to sync:', request.url, error);
      }
    }
    
    // Notify clients of sync completion
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error('[Service Worker] Sync error:', error);
  }
}

// Message handler for client communication
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_API') {
    const { url, data } = event.data;
    event.waitUntil(
      caches.open(API_CACHE_NAME).then((cache) => {
        return cache.put(
          new Request(url),
          new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      })
    );
  }
});
