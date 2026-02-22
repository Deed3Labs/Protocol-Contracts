// Enhanced Service Worker for PWA
// Combines offline support, caching, and WebSocket integration
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `protocol-static-${CACHE_VERSION}`;
const API_CACHE = `protocol-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `protocol-images-${CACHE_VERSION}`;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/ClearPath-Logo.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).then(() => {
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== STATIC_CACHE &&
            cacheName !== API_CACHE &&
            cacheName !== IMAGE_CACHE &&
            !cacheName.startsWith('protocol-')
          ) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy 1: Static assets - Cache First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Strategy 2: Images - Cache First with network fallback
  if (isImage(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Strategy 3: API calls - Stale-While-Revalidate for better performance
  if (isAPI(url)) {
    // Plaid endpoints are highly stateful and should always hit network to avoid stale OAuth/transaction data on mobile/PWA.
    if (isPlaidAPI(url)) {
      event.respondWith(networkOnly(request));
      return;
    }
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Strategy 4: HTML - Network First with cache fallback
  if (isHTML(url)) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Default: Network only
  event.respondWith(fetch(request));
});

// Cache First Strategy
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return offline page or error response
    return new Response('Offline', { status: 503 });
  }
}

// Network First Strategy
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Network failed, try cache
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    
    // Return offline response
    return new Response(
      JSON.stringify({ error: 'Network error', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Stale-While-Revalidate Strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  // Start fetching in background
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // Ignore fetch errors, we'll use cache
  });
  
  // Return cached version immediately if available
  if (cached) {
    // Don't await fetchPromise, let it update cache in background
    fetchPromise.catch(() => {});
    return cached;
  }
  
  // If no cache, wait for network
  try {
    return await fetchPromise;
  } catch (error) {
    // Return offline response if fetch fails
    return new Response(
      JSON.stringify({ error: 'Network error', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Network only strategy for sensitive/stateful endpoints (e.g. Plaid)
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Network error', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Helper functions
function isStaticAsset(url) {
  return url.pathname.match(/\.(js|css|woff|woff2|ttf|otf)$/);
}

function isImage(url) {
  return url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/);
}

function isAPI(url) {
  return url.pathname.startsWith('/api/');
}

function isPlaidAPI(url) {
  return url.pathname.startsWith('/api/plaid/');
}

function isHTML(url) {
  return url.pathname.endsWith('.html') || url.pathname === '/';
}

// Background sync
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-portfolio') {
    event.waitUntil(syncPortfolio());
  }
  
  if (event.tag === 'sync-prices') {
    event.waitUntil(syncPrices());
  }
});

// Periodic Background Sync
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'sync-portfolio-periodic') {
    event.waitUntil(syncPortfolio());
  }
  
  if (event.tag === 'sync-prices-periodic') {
    event.waitUntil(syncPrices());
  }
});

// Sync portfolio data
async function syncPortfolio() {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    
    // Refresh cached API endpoints
    for (const request of keys) {
      if (request.url.includes('/api/balances') || 
          request.url.includes('/api/nfts') ||
          request.url.includes('/api/transactions')) {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
          }
        } catch (error) {
          console.error('[SW] Failed to sync:', request.url, error);
        }
      }
    }
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error('[SW] Sync error:', error);
  }
}

// Sync prices
async function syncPrices() {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    
    for (const request of keys) {
      if (request.url.includes('/api/prices')) {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
          }
        } catch (error) {
          console.error('[SW] Failed to sync price:', request.url, error);
        }
      }
    }
  } catch (error) {
    console.error('[SW] Price sync error:', error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'New Update', body: event.data.text() };
    }
  }
  
  const options = {
    title: data.title || 'CLEAR Credit',
    body: data.body || 'You have a new update',
    icon: data.icon || '/ClearPath-Logo.png',
    badge: '/ClearPath-Logo.png',
    tag: data.tag || 'default',
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
  };
  
  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Otherwise, open new window
      if (clients.openWindow) {
        let url = '/';
        if (data && data.url) {
          url = data.url;
        }
        return clients.openWindow(url);
      }
    })
  );
});

// Message handler
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_API') {
    const { url, data } = event.data;
    event.waitUntil(
      caches.open(API_CACHE).then((cache) => {
        return cache.put(
          new Request(url),
          new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      })
    );
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});
