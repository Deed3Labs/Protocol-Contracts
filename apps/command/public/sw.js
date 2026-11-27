/**
 * The Command Center's service worker (Phase 8): the app shell, so it opens fast and opens at all on
 * a poor connection, and nothing else.
 *
 * **Nothing the API says is ever cached here.** Command's figures, names and documents come from the
 * API on another origin, which this worker never touches, and /api/ on this origin is passed straight
 * through. A cached page of members or money would outlive the sign-out that should have hidden it.
 * What it keeps is the shell, which says nothing about anyone, and the build's hashed assets.
 */

// One cache per build: the build writes its id here (vite.config.ts), so a deploy is a new worker,
// and activating it clears the last build's shell and assets.
const SHELL = 'clear-command-shell-__BUILD__';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/clear-mark-solid-ink.svg', '/icon-192.png'];

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
  // the API (another origin), fonts, map tiles, Privy: the network's, untouched
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first so a deploy is picked up, the cached shell when there's no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Hashed build assets never change, so cache-first is safe. A failed fetch is the page's network
  // error, not an uncaught rejection in the worker.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((res) => {
            if (res.ok && url.pathname.startsWith('/assets/')) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => Response.error()),
    ),
  );
});
