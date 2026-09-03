import { useCallback } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { savePushSubscription } from '@/utils/apiClient';

// Public VAPID key (safe to expose). Overridable via env; falls back to the app's key.
const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BMu0BQLWQctkLTZlOD2me1X-vOBVcfAZxU0kxXOKb_3eWMwBcJPSMrPightFAAz_exbQm-EYxoJOdJPNr74HWck';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** True when this browser can do Web Push at all (installed PWA still required on iOS). */
export const pushSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';

/**
 * Requests notification permission (iOS requires this from a user gesture) and registers/refreshes this
 * device's push subscription with the backend. Also self-heals rotated subscriptions: `getSubscription`
 * returns the browser's current one, which we re-save — so a rotation is picked up on next call.
 */
export function usePushRegistration() {
  const { address } = useAppKitAccount();

  const enablePush = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!address || !pushSupported()) return 'unsupported';
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
      await savePushSubscription(address, sub.toJSON());
    } catch {
      /* push is optional */
    }
    return 'granted';
  }, [address]);

  return { enablePush };
}
