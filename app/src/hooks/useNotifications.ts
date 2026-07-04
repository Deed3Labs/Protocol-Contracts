import { useCallback, useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotificationApi,
  sendTestNotification,
  type ApiNotification,
} from '@/utils/apiClient';
import { usePushRegistration } from '@/hooks/usePushRegistration';

/**
 * Persistent in-app notifications from the backend (wallet-scoped). Fetches on mount + focus, receives
 * new ones live over the WebSocket (`notification:new`), and applies read/dismiss optimistically.
 */
export function useNotifications() {
  const { address, isConnected } = useAppKitAccount();
  const { socket } = useWebSocket(address, isConnected);
  const { enablePush } = usePushRegistration();
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

  // Poll like balances/transactions do. The WebSocket unsubscribes whenever the tab is hidden (and can
  // drop), so `notification:new` isn't a reliable live channel — a steady poll while visible, plus a
  // refresh the moment the tab becomes visible again, keeps the bell current even with no live socket.
  // (When hidden/closed, timers are throttled/stopped, so Web Push remains the delivery path.)
  useEffect(() => {
    if (!address || !isConnected) return;
    const POLL_MS = 20_000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address, isConnected, refresh]);

  // If permission is already granted, subscribe silently on mount (no gesture needed). The gesture path
  // (first-time grant) is the "Enable notifications" prime and the demo "Send test" button.
  useEffect(() => {
    if (address && isConnected && typeof Notification !== 'undefined' && Notification.permission === 'granted') void enablePush();
  }, [address, isConnected, enablePush]);

  // Reflect the unread count on the app-icon badge while the app is open (installed PWA).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    if (unreadCount > 0) void navigator.setAppBadge?.(unreadCount).catch(() => {});
    else void navigator.clearAppBadge?.().catch(() => {});
  }, [unreadCount]);

  // Live: prepend notifications pushed by producers.
  useEffect(() => {
    if (!socket) return;
    const onNew = (n: ApiNotification) => {
      setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 40)));
      setUnreadCount((c) => c + 1);
      // Money moved (deposit landed / cash-out sent) → refresh balances + activity right away.
      if (n.kind === 'received' || n.kind === 'sent') window.dispatchEvent(new Event('clear:activity'));
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

  // The bell's "Send test" doubles as the enable path: the tap is the user gesture iOS needs to grant
  // notification permission + register the push subscription, then it fires a test.
  const sendTest = useCallback(async () => {
    if (!address) return;
    await enablePush();
    await sendTestNotification(address).catch(() => {});
    await refresh();
  }, [address, enablePush, refresh]);

  return { notifications, unreadCount, refresh, markRead, markAllRead, dismiss, sendTest };
}
