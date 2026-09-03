/**
 * Service Worker registration and management
 */

// Type declaration for Background Sync API (not in standard TypeScript DOM types)
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistrationWithSync extends ServiceWorkerRegistration {
  sync?: SyncManager;
}

const SW_URL = '/sw.js';

/**
 * Register service worker
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Service Worker] Not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL);
    console.log('[Service Worker] Registered:', registration.scope);

    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available
            console.log('[Service Worker] New version available');
            // You can show a notification to the user here
          }
        });
      }
    });

    return registration;
  } catch (error) {
    console.error('[Service Worker] Registration failed:', error);
    return null;
  }
}

/**
 * Unregister service worker
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      console.log('[Service Worker] Unregistered');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Service Worker] Unregistration failed:', error);
    return false;
  }
}

/**
 * Request background sync
 */
export async function requestBackgroundSync(tag: string = 'sync-portfolio'): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('sync' in ServiceWorkerRegistration.prototype)) {
    console.warn('[Service Worker] Background sync not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const registrationWithSync = registration as ServiceWorkerRegistrationWithSync;
    
    if (!registrationWithSync.sync) {
      console.warn('[Service Worker] Background sync not available');
      return false;
    }
    
    await registrationWithSync.sync.register(tag);
    console.log('[Service Worker] Background sync requested:', tag);
    return true;
  } catch (error) {
    console.error('[Service Worker] Background sync failed:', error);
    return false;
  }
}

/**
 * Cache API response in service worker
 */
export async function cacheAPIResponse(url: string, data: any): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active) {
      registration.active.postMessage({
        type: 'CACHE_API',
        url,
        data,
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Service Worker] Cache API failed:', error);
    return false;
  }
}

/**
 * Listen for service worker messages
 */
export function listenToServiceWorker(
  callback: (event: MessageEvent) => void
): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  navigator.serviceWorker.addEventListener('message', callback);

  return () => {
    navigator.serviceWorker.removeEventListener('message', callback);
  };
}
