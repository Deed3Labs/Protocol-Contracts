import { useEffect, useCallback, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { useAppKitAccount } from '@reown/appkit/react';

/**
 * Hook for managing app badge (unread count indicator)
 * Updates badge in real-time via WebSocket
 */
export function useAppBadge() {
  const { address, isConnected } = useAppKitAccount();
  const { socket, isConnected: wsConnected } = useWebSocket(address, isConnected);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('setAppBadge' in navigator);
  }, []);

  /**
   * Set app badge count
   */
  const setBadge = useCallback(async (count: number | null) => {
    if (!isSupported) return;

    try {
      if (count === null || count === 0) {
        await navigator.clearAppBadge?.();
      } else {
        await navigator.setAppBadge?.(count);
      }
    } catch (error) {
      console.error('[Badge] Failed to set badge:', error);
    }
  }, [isSupported]);

  /**
   * Listen for WebSocket updates and update badge
   */
  useEffect(() => {
    if (!socket || !wsConnected || !isSupported) return;

    let unreadCount = 0;

    const handleNewTransaction = () => {
      unreadCount++;
      setBadge(unreadCount);
    };

    const handleNewNFT = () => {
      unreadCount++;
      setBadge(unreadCount);
    };

    socket.on('transaction_update', handleNewTransaction);
    socket.on('nft_update', handleNewNFT);

    return () => {
      socket.off('transaction_update', handleNewTransaction);
      socket.off('nft_update', handleNewNFT);
    };
  }, [socket, wsConnected, isSupported, setBadge]);

  /**
   * Clear badge when user views activity
   */
  const clearBadge = useCallback(() => {
    setBadge(0);
  }, [setBadge]);

  return {
    isSupported,
    setBadge,
    clearBadge,
  };
}
