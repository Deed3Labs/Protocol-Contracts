import { PREVIEW } from './env';

/**
 * The service worker (public/sw.js): in a production build only, and never in the preview, where a
 * worker caching the prototype's pages would make for a confusing afternoon. Failing to register is
 * a slower cold start, not a broken app.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || PREVIEW || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
