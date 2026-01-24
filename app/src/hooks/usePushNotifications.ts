import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { useAppKitAccount } from '@reown/appkit/react';

interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  requireInteraction?: boolean;
}

/**
 * Hook for managing push notifications
 * Leverages WebSocket for real-time notification delivery
 */
export function usePushNotifications() {
  const { address, isConnected } = useAppKitAccount();
  const { socket, isConnected: wsConnected } = useWebSocket(address, isConnected);
  const [permission, setPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('Notification' in window && 'serviceWorker' in navigator);
  }, []);

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn('[Notifications] Not supported in this browser');
      return false;
    }

    if (permission === 'granted') {
      return true;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('[Notifications] Permission request failed:', error);
      return false;
    }
  }, [isSupported, permission]);

  /**
   * Show a notification
   */
  const showNotification = useCallback(async (options: NotificationOptions) => {
    if (!isSupported || permission !== 'granted') {
      console.warn('[Notifications] Notifications not permitted');
      return;
    }

    try {
      // Try to use Service Worker registration
      const registration = await navigator.serviceWorker.ready;
      
      // Use type assertion for extended notification options
      // Note: title is passed as first parameter, not in options
      const notificationOptions: Omit<NotificationOptions, 'title'> & {
        vibrate?: number[];
        timestamp?: number;
        actions?: Array<{ action: string; title: string; icon?: string }>;
      } = {
        body: options.body,
        icon: options.icon || '/ClearPath-Logo.png',
        badge: options.badge || '/ClearPath-Logo.png',
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction || false,
        vibrate: [200, 100, 200],
        timestamp: Date.now(),
        actions: [
          {
            action: 'view',
            title: 'View',
            icon: '/ClearPath-Logo.png'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ]
      };
      
      await registration.showNotification(options.title, notificationOptions);
    } catch (error) {
      console.error('[Notifications] Failed to show notification:', error);
      
      // Fallback to regular Notification API
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/ClearPath-Logo.png',
          badge: options.badge || '/ClearPath-Logo.png',
          tag: options.tag,
          data: options.data
        });
      }
    }
  }, [isSupported, permission]);

  /**
   * Listen for WebSocket events and show notifications
   */
  useEffect(() => {
    if (!socket || !wsConnected || permission !== 'granted') return;

    const handleBalanceUpdate = (data: any) => {
      showNotification({
        title: 'Balance Updated',
        body: `Your balance has been updated`,
        tag: 'balance-update',
        data: data
      });
    };

    const handleTransactionUpdate = (data: any) => {
      showNotification({
        title: 'New Transaction',
        body: `Transaction ${data.hash?.substring(0, 10)}... confirmed`,
        tag: `tx-${data.hash}`,
        data: data,
        requireInteraction: true
      });
    };

    const handleNFTUpdate = (data: any) => {
      showNotification({
        title: 'NFT Update',
        body: `Your NFT collection has been updated`,
        tag: 'nft-update',
        data: data
      });
    };

    const handlePriceUpdate = (data: any) => {
      // Price alerts are now handled by NotificationContext
      // This handler is kept for backward compatibility but won't show notifications
      // as NotificationContext handles price change detection and notifications
      console.log('[PushNotifications] Price update received:', data);
    };

    const handleTransferReceived = (data: any) => {
      const transfer = data.transfer;
      const asset = transfer.asset || 'asset';
      const value = transfer.value ? `${transfer.value} ${asset}` : asset;
      showNotification({
        title: 'Transfer Received',
        body: `You received ${value}`,
        tag: `transfer-${transfer.hash}`,
        data: {
          ...data,
          type: 'transfer',
          hash: transfer.hash,
          chainId: data.chainId
        },
        requireInteraction: false
      });
    };

    const handleTransferSent = (data: any) => {
      const transfer = data.transfer;
      const asset = transfer.asset || 'asset';
      const value = transfer.value ? `${transfer.value} ${asset}` : asset;
      showNotification({
        title: 'Transfer Sent',
        body: `You sent ${value}`,
        tag: `transfer-${transfer.hash}`,
        data: {
          ...data,
          type: 'transfer',
          hash: transfer.hash,
          chainId: data.chainId
        },
        requireInteraction: false
      });
    };

    socket.on('balance_update', handleBalanceUpdate);
    socket.on('transaction_update', handleTransactionUpdate);
    socket.on('nft_update', handleNFTUpdate);
    socket.on('price_update', handlePriceUpdate);
    socket.on('transfer_received', handleTransferReceived);
    socket.on('transfer_sent', handleTransferSent);

    return () => {
      socket.off('balance_update', handleBalanceUpdate);
      socket.off('transaction_update', handleTransactionUpdate);
      socket.off('nft_update', handleNFTUpdate);
      socket.off('price_update', handlePriceUpdate);
      socket.off('transfer_received', handleTransferReceived);
      socket.off('transfer_sent', handleTransferSent);
    };
  }, [socket, wsConnected, permission, showNotification]);

  /**
   * Listen for messages from Service Worker about notification clicks
   * Note: Notification clicks are handled in the Service Worker (sw.js)
   * The Service Worker can send messages to clients when notifications are clicked
   */
  useEffect(() => {
    if (!isSupported) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICKED') {
        const { action, data } = event.data;
        
        if (action === 'view' && data) {
          window.focus();
          // Navigate to relevant page based on notification data
          if (data.type === 'transaction' && data.hash) {
            // Navigate to transaction details
            // router.push(`/transaction/${data.hash}`);
            window.location.href = `/transaction/${data.hash}`;
          } else if (data.type === 'nft' && data.tokenId) {
            // Navigate to NFT details
            // router.push(`/nft/${data.tokenId}`);
            window.location.href = `/nft/${data.tokenId}`;
          }
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [isSupported]);

  return {
    isSupported,
    permission,
    requestPermission,
    showNotification,
  };
}
