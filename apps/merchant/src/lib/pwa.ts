import { Capacitor } from '@capacitor/core';

/**
 * Service worker registration.
 *
 * Not in the installed app: its pages already come from the app bundle, and a worker there could
 * keep serving the last bundle after an app update.
 *
 * Registered only in production: a worker caching a dev server's modules makes for a confusing
 * afternoon. Failure is non-fatal — the app works without it, it just opens more slowly.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (Capacitor.isNativePlatform()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An install that fails is a slower cold start, not a broken till.
    });
  });
}
