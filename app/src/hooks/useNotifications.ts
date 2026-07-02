import { useCallback, useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotificationApi,
  savePushSubscription,
  type ApiNotification,
} from '@/utils/apiClient';

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

/**
 * Persistent in-app notifications from the backend (wallet-scoped). Fetches on mount + focus, receives
 * new ones live over the WebSocket (`notification:new`), and applies read/dismiss optimistically.
 */
export function useNotifications() {
  const { address, isConnected } = useAppKitAccount();
  const { socket } = useWebSocket(address, isConnected);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!address || !isConnected) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    const res = await getNotifications(address);
    setNotifications(res.notifications);
    setUnreadCount(res.unreadCount);
  }, [address, isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Web Push: once permission is granted (requested elsewhere on connect), register/refresh this
  // device's push subscription so important notifications arrive when the app is closed.
  useEffect(() => {
    if (!address || !isConnected) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ||
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
        if (!cancelled) await savePushSubscription(address, sub.toJSON());
      } catch {
        /* push is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  // Live: prepend notifications pushed by producers.
  useEffect(() => {
    if (!socket) return;
    const onNew = (n: ApiNotification) => {
      setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 40)));
      setUnreadCount((c) => c + 1);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [socket]);

  const markRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const was = prev.find((n) => n.id === id && !n.read);
        if (was) setUnreadCount((c) => Math.max(0, c - 1));
        return prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      });
      if (address) void markNotificationRead(address, id).catch(() => {});
    },
    [address],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    if (address) void markAllNotificationsRead(address).catch(() => {});
  }, [address]);

  const dismiss = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const was = prev.find((n) => n.id === id && !n.read);
        if (was) setUnreadCount((c) => Math.max(0, c - 1));
        return prev.filter((n) => n.id !== id);
      });
      if (address) void archiveNotificationApi(address, id).catch(() => {});
    },
    [address],
  );

  return { notifications, unreadCount, refresh, markRead, markAllRead, dismiss };
}
