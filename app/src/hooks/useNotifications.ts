import { useCallback, useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotificationApi,
  type ApiNotification,
} from '@/utils/apiClient';

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
