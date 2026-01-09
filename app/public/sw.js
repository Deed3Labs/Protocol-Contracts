const CACHE_NAME = 'deed-protocol-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/favicon.png'
];

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip caching for wallet-related requests, Reown assets, and dynamic assets
  if (
    request.method !== 'GET' ||
    url.pathname.includes('wallet') ||
    url.pathname.includes('connect') ||
    url.pathname.includes('reown') ||
    url.pathname.includes('appkit') ||
    url.pathname.includes('wagmi') ||
    url.pathname.includes('api') ||
    url.pathname.includes('ws') ||
    url.pathname.includes('wss') ||
    url.pathname.includes('secure.walletconnect') ||
    url.pathname.includes('secure-mobile.walletconnect') ||
    url.searchParams.has('t') || // Skip cache-busting parameters
    url.searchParams.has('v') ||
    url.searchParams.has('_t') ||
    url.searchParams.has('_v') ||
    // Skip Reown-specific domains and assets
    url.hostname.includes('reown') ||
    url.hostname.includes('walletconnect') ||
    url.hostname.includes('appkit') ||
    // Skip web components and custom elements
    url.pathname.includes('appkit-button') ||
    url.pathname.includes('web-components') ||
    url.pathname.includes('custom-elements')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // For static assets, try network first, then cache
  if (request.destination === 'image' || request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // For HTML and other requests, try cache first, then network
  event.respondWith(
    caches.match(request)
      .then((response) => {
        return response || fetch(request);
      })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 