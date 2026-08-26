import { useCallback, useEffect, useRef, useState } from 'react';
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
 *
 * **Call this once, from the provider.** Everything else uses `useNotifications` from
 * `@/context/ClearNotificationsContext`, which shares this one instance.
 *
 * It used to be called directly by the bell, the inbox page and the shell's badge — three
 * independent copies of the state, each with its own `readIds` ref and its own socket. Marking a
 * row read in the bell updated the bell; the badge went on showing the old count until its own
 * 20-second poll came round, which is why it took two goes to make a notification look read. The
 * three sockets were also most of the "seven connections from one tab" in the server logs.
 */
export function useNotificationsState() {
  const { address, isConnected } = useAppKitAccount();
  const { socket } = useWebSocket(address, isConnected);
  const { enablePush } = usePushRegistration();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  /*
   * Derived, never stored.
   *
   * As its own state it had to be adjusted by hand at four sites, and each was a chance to drift
   * from the list: `notification:new` incremented even when the row was already present, so a
   * repeat event bumped a badge that described nothing on screen. A count of unread rows is a fact
   * about the rows — computing it cannot disagree with them.
   */
  const unreadCount = notifications.reduce((count, n) => count + (n.read ? 0 : 1), 0);
  // Ids the user just dismissed/read locally. A poll or focus refetch can start BEFORE the archive/read
  // commits server-side and then clobber the optimistic update (the row reappears / un-reads). These sets
  // guard every refresh + live socket event so that never happens. Cleared on wallet change.
  const dismissedIds = useRef<Set<string>>(new Set());
  const readIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!address || !isConnected) {
      setNotifications([]);
      return;
    }
    const res = await getNotifications(address);
    const list = res.notifications
      .filter((n) => !dismissedIds.current.has(n.id))
      .map((n) => (readIds.current.has(n.id) ? { ...n, read: true } : n));
    setNotifications(list);
  }, [address, isConnected]);

  // Drop the optimistic-action guards when the connected wallet changes.
  useEffect(() => {
    dismissedIds.current.clear();
    readIds.current.clear();
  }, [address]);

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
      if (dismissedIds.current.has(n.id)) return; // don't resurrect a just-dismissed row
      if (readIds.current.has(n.id)) return; // nor un-read one the user just read
      // Count only what was actually added. This used to increment unconditionally, so a repeated
      // `notification:new` for a row already in the list left the list alone and still bumped the
      // badge — a count that no longer described anything on screen.
      setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 40)));
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
      readIds.current.add(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      if (address) void markNotificationRead(address, id).catch(() => {});
    },
    [address],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      prev.forEach((n) => readIds.current.add(n.id));
      return prev.map((n) => ({ ...n, read: true }));
    });
    if (address) void markAllNotificationsRead(address).catch(() => {});
  }, [address]);

  const dismiss = useCallback(
    (id: string) => {
      dismissedIds.current.add(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
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
