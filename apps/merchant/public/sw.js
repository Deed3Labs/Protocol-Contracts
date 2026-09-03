/**
 * The merchant service worker.
 *
 * Its own, not the member app's — different origin, different scope, and deliberately different
 * behaviour. This one caches the shell so the app opens instantly on a counter tablet, and does
 * nothing else.
 *
 * **There is no offline queue, and there must not be one.** Capturing a charge the ledger has not
 * seen promises a merchant something that may not hold: the member may be over their limit, the
 * plan may not open, and the shop will have handed over goods against a promise this app invented.
 * So every request that moves money goes to the network or fails visibly. A shell that loads
 * without a connection is useful; a charge that "succeeds" without one is a liability.
 */

const SHELL = 'clear-merchant-shell-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Anything the API answers is live or it is nothing. Never served from a cache: a stale charge
  // list at a counter is worse than an empty one, because a writer will act on it.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first so a deploy is picked up, falling back to the cached shell so the
  // app still opens on a flaky shop connection.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())));
    return;
  }

  // Hashed build assets are immutable, so cache-first is safe and makes the tablet feel instant.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
