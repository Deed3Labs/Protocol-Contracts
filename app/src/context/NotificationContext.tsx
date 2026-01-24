import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useDeedNFTData } from '@/hooks/useDeedNFTData';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAppBadge } from '@/hooks/useAppBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { usePortfolio } from '@/context/PortfolioContext';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  archived: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationContextType {
  notifications: Notification[];
  archivedNotifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'archived'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  archiveNotification: (id: string) => void;
  archiveOldNotifications: () => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;
  clearArchive: () => void;
  refreshValidationNotifications: () => void;
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: React.ReactNode;
}

const STORAGE_KEY = 'deed-protocol-notifications';
const PRICE_STORAGE_KEY = 'deed-protocol-price-history';
const ARCHIVE_DAYS = 30; // Archive notifications older than 30 days
const PRICE_CHANGE_THRESHOLD = 5; // Notify when price changes by 5% or more

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<Notification[]>([]);
  const { address, isConnected } = useAppKitAccount();
  const { showNotification, requestPermission } = usePushNotifications();
  const { setBadge } = useAppBadge();
  const { socket, isConnected: wsConnected } = useWebSocket(address, isConnected);
  const { holdings } = usePortfolio();
  
  // Track previous prices for assets user holds
  // Key format: `${chainId}-${tokenAddress.toLowerCase()}`
  const previousPricesRef = useRef<Map<string, { price: number; timestamp: number }>>(new Map());
  
  // Get user's T-Deed data - simple and direct
  let userDeedNFTs: any[] = [];
  let getValidationStatus: any = null;
  
  try {
    const deedData = useDeedNFTData();
    userDeedNFTs = deedData.userDeedNFTs || [];
    getValidationStatus = deedData.getValidationStatus;
    console.log('✅ NotificationContext: Got T-Deed data:', userDeedNFTs.length, 'deeds');
  } catch (error) {
    console.log('⚠️ NotificationContext: No T-Deed data available yet');
  }

  // Load notifications from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        const loadedNotifications = data.notifications?.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        })) || [];
        const loadedArchived = data.archived?.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        })) || [];
        
        setNotifications(loadedNotifications);
        setArchivedNotifications(loadedArchived);
      }
    } catch (error) {
      console.error('Error loading notifications from localStorage:', error);
    }
  }, []);

  // Load previous prices from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRICE_STORAGE_KEY);
      if (stored) {
        const priceData = JSON.parse(stored);
        const priceMap = new Map<string, { price: number; timestamp: number }>();
        Object.entries(priceData).forEach(([key, value]: [string, any]) => {
          priceMap.set(key, { price: value.price, timestamp: value.timestamp });
        });
        previousPricesRef.current = priceMap;
      }
    } catch (error) {
      console.error('Error loading price history from localStorage:', error);
    }
  }, []);

  // Initialize prices from current holdings when they load
  // This establishes a baseline for price change detection
  useEffect(() => {
    if (holdings.length === 0) return;

    holdings.forEach(holding => {
      // Only track prices for assets that have a priceUSD value
      if (holding.balanceUSD && holding.balanceUSD > 0 && holding.address) {
        const priceKey = `${holding.chainId}-${holding.address.toLowerCase()}`;
        
        // Get price per unit (for tokens) or total value (for NFTs)
        let currentPrice = 0;
        if (holding.type === 'token' && holding.balance && parseFloat(holding.balance) > 0) {
          // For tokens: price = balanceUSD / balance
          currentPrice = holding.balanceUSD / parseFloat(holding.balance);
        } else if (holding.type === 'nft' || holding.type === 'rwa') {
          // For NFTs: use balanceUSD as the price (it's already the value per NFT)
          currentPrice = holding.balanceUSD;
        }

        if (currentPrice > 0) {
          // Only set if we don't already have a price for this asset
          // This prevents overwriting existing price history
          if (!previousPricesRef.current.has(priceKey)) {
            previousPricesRef.current.set(priceKey, {
              price: currentPrice,
              timestamp: Date.now()
            });
          }
        }
      }
    });

    // Save updated price history
    try {
      const priceData: Record<string, { price: number; timestamp: number }> = {};
      previousPricesRef.current.forEach((value, key) => {
        priceData[key] = value;
      });
      localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(priceData));
    } catch (error) {
      console.error('Error saving price history to localStorage:', error);
    }
  }, [holdings.length]); // Only run when holdings count changes (initial load)

  // Save price history to localStorage whenever it changes
  useEffect(() => {
    try {
      const priceData: Record<string, { price: number; timestamp: number }> = {};
      previousPricesRef.current.forEach((value, key) => {
        priceData[key] = value;
      });
      localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(priceData));
    } catch (error) {
      console.error('Error saving price history to localStorage:', error);
    }
  }, [holdings]); // Save when holdings change (which includes price updates)

  // Check for unvalidated T-Deeds and create notifications
  const checkValidationNotifications = useCallback(() => {
    console.log('🔍 Checking validation notifications...', {
      isConnected,
      address: address?.slice(0, 10) + '...',
      userDeedNFTsCount: userDeedNFTs.length,
      hasValidationFunction: !!getValidationStatus
    });

    if (!isConnected || !address) {
      console.log('❌ Skipping validation check - not connected');
      return;
    }

    if (!userDeedNFTs.length || !getValidationStatus) {
      console.log('❌ Skipping validation check - no DeedNFT data available');
      return;
    }

    const unvalidatedDeeds = userDeedNFTs.filter((deed: any) => {
      const validationStatus = getValidationStatus(deed);
      console.log(`🔍 T-Deed #${deed.tokenId} validation status:`, validationStatus);
      return validationStatus.status === "Pending";
    });

    console.log('🔍 Found unvalidated deeds:', unvalidatedDeeds.length);

    // Remove existing validation notifications for deeds that are now validated
    setNotifications(prev => {
      const filteredNotifications = prev.filter(notification => {
        if (notification.title.includes('Validation Required')) {
          const deedId = notification.message.match(/T-Deed #(\d+)/)?.[1];
          if (deedId) {
            const deed = userDeedNFTs.find((d: any) => d.tokenId === deedId);
            if (deed) {
              const validationStatus = getValidationStatus(deed);
              return validationStatus.status === "Pending"; // Keep only if still pending
            }
          }
        }
        return true; // Keep all other notifications
      });

      // Add new validation notifications for unvalidated deeds
      const newNotifications = [...filteredNotifications];
      unvalidatedDeeds.forEach((deed: any) => {
        const existingNotification = newNotifications.find(n => 
          n.title.includes('Validation Required') && 
          n.message.includes(`T-Deed #${deed.tokenId}`)
        );

        if (!existingNotification) {
          const assetTypeLabel = deed.assetType === 0 ? 'Land' : 
                                deed.assetType === 1 ? 'Vehicle' : 
                                deed.assetType === 2 ? 'Commercial Equipment' : 
                                deed.assetType === 3 ? 'Estate' : 'Asset';
          
          const newNotification: Notification = {
            id: Date.now().toString() + deed.tokenId,
            type: 'warning',
            title: 'Validation Required',
            message: `Your ${assetTypeLabel} T-Deed #${deed.tokenId} requires validation. Please submit required documents.`,
            timestamp: new Date(),
            read: false,
            archived: false,
            action: {
              label: 'View T-Deed',
              onClick: () => {
                // Navigate to validation page or deed details
                window.location.href = `/validation`;
              }
            }
          };
          newNotifications.unshift(newNotification);
        }
      });

      return newNotifications;
    });
  }, [isConnected, address, userDeedNFTs, getValidationStatus]);

  // Single validation check when data becomes available
  useEffect(() => {
    if (isConnected && address && userDeedNFTs.length > 0 && getValidationStatus) {
      console.log('🔍 NotificationContext: Data available, checking validation notifications...');
      checkValidationNotifications();
    }
  }, [isConnected, address, userDeedNFTs.length, getValidationStatus, checkValidationNotifications]);



  // Save to localStorage whenever notifications change
  const saveToStorage = useCallback((notifs: Notification[], archived: Notification[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        notifications: notifs,
        archived: archived
      }));
    } catch (error) {
      console.error('Error saving notifications to localStorage:', error);
    }
  }, []);

  // Auto-archive old notifications
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoffDate = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
      const oldNotifications = notifications.filter(n => n.timestamp < cutoffDate && !n.archived);
      
      if (oldNotifications.length > 0) {
        setNotifications(prev => prev.filter(n => n.timestamp >= cutoffDate || n.archived));
        setArchivedNotifications(prev => [...prev, ...oldNotifications.map(n => ({ ...n, archived: true }))]);
      }
    }, 24 * 60 * 60 * 1000); // Check every 24 hours

    return () => clearInterval(interval);
  }, [notifications]);

  // Save whenever notifications or archived change
  useEffect(() => {
    saveToStorage(notifications, archivedNotifications);
  }, [notifications, archivedNotifications, saveToStorage]);

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'archived'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date(),
      read: false,
      archived: false,
    };
    setNotifications(prev => [newNotification, ...prev]);

    // Show push notification for important notifications
    if (notification.type === 'error' || notification.type === 'warning' || notification.type === 'success') {
      showNotification({
        title: notification.title,
        body: notification.message,
        tag: `notification-${newNotification.id}`,
        data: {
          notificationId: newNotification.id,
          type: notification.type,
        },
        requireInteraction: notification.type === 'error',
      });
    }
  }, [showNotification]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: true }))
    );
  }, []);

  const archiveNotification = useCallback((id: string) => {
    const notification = notifications.find(n => n.id === id);
    if (notification) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      setArchivedNotifications(prev => [...prev, { ...notification, archived: true }]);
    }
  }, [notifications]);

  const archiveOldNotifications = useCallback(() => {
    const cutoffDate = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    const oldNotifications = notifications.filter(n => n.timestamp < cutoffDate && !n.archived);
    
    if (oldNotifications.length > 0) {
      setNotifications(prev => prev.filter(n => n.timestamp >= cutoffDate || n.archived));
      setArchivedNotifications(prev => [...prev, ...oldNotifications.map(n => ({ ...n, archived: true }))]);
    }
  }, [notifications]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(notification => notification.id !== id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const clearArchive = useCallback(() => {
    setArchivedNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Update app badge when unread count changes
  useEffect(() => {
    setBadge(unreadCount > 0 ? unreadCount : null);
  }, [unreadCount, setBadge]);

  // Request notification permission on mount
  useEffect(() => {
    if (isConnected) {
      requestPermission();
    }
  }, [isConnected, requestPermission]);

  // Listen to WebSocket events for transfer notifications
  useEffect(() => {
    if (!socket || !wsConnected || !address) return;

    const handleTransferReceived = (data: any) => {
      const transfer = data.transfer;
      const asset = transfer.asset || 'asset';
      const value = transfer.value ? `${transfer.value} ${asset}` : asset;
      
      addNotification({
        type: 'success',
        title: 'Transfer Received',
        message: `You received ${value} on chain ${data.chainId}`,
        action: transfer.hash ? {
          label: 'View Transaction',
          onClick: () => {
            // Navigate to transaction details if available
            window.open(`https://etherscan.io/tx/${transfer.hash}`, '_blank');
          }
        } : undefined
      });
    };

    const handleTransferSent = (data: any) => {
      const transfer = data.transfer;
      const asset = transfer.asset || 'asset';
      const value = transfer.value ? `${transfer.value} ${asset}` : asset;
      
      addNotification({
        type: 'info',
        title: 'Transfer Sent',
        message: `You sent ${value} on chain ${data.chainId}`,
        action: transfer.hash ? {
          label: 'View Transaction',
          onClick: () => {
            // Navigate to transaction details if available
            window.open(`https://etherscan.io/tx/${transfer.hash}`, '_blank');
          }
        } : undefined
      });
    };

    const handleBalanceUpdate = (data: any) => {
      // Only notify for significant balance changes, not every update
      // This prevents notification spam
      console.log('[NotificationContext] Balance update received:', data);
    };

    const handlePriceUpdate = (data: { chainId: number; tokenAddress: string; price: number; timestamp: number }) => {
      if (!data || !data.chainId || !data.tokenAddress || !data.price || data.price <= 0) {
        return;
      }

      const { chainId, tokenAddress, price } = data;
      const normalizedAddress = tokenAddress.toLowerCase();
      const priceKey = `${chainId}-${normalizedAddress}`;

      // Find the holding that matches this asset
      const holding = holdings.find(h => {
        // For tokens, check by address and chainId
        if (h.type === 'token' && h.address) {
          return h.chainId === chainId && 
                 h.address.toLowerCase() === normalizedAddress;
        }
        // For NFTs, check by contract address and chainId
        if ((h.type === 'nft' || h.type === 'rwa') && h.address) {
          return h.chainId === chainId && 
                 h.address.toLowerCase() === normalizedAddress;
        }
        return false;
      });

      if (!holding) {
        // User doesn't hold this asset, skip notification
        return;
      }

      // Get previous price
      const previousPriceData = previousPricesRef.current.get(priceKey);
      
      // If we have a previous price, check for significant change
      if (previousPriceData && previousPriceData.price > 0) {
        const previousPrice = previousPriceData.price;
        const priceChange = ((price - previousPrice) / previousPrice) * 100;
        const absPriceChange = Math.abs(priceChange);

        // Only notify if price change is >= threshold (5%)
        if (absPriceChange >= PRICE_CHANGE_THRESHOLD) {
          const isIncrease = priceChange > 0;
          const direction = isIncrease ? 'up' : 'down';
          const changeEmoji = isIncrease ? '📈' : '📉';
          
          const assetName = holding.asset_symbol || holding.asset_name || 'Asset';
          
          // Format price based on asset type
          let formattedPrice: string;
          if (price >= 1) {
            formattedPrice = price.toFixed(2);
          } else if (price >= 0.01) {
            formattedPrice = price.toFixed(4);
          } else {
            formattedPrice = price.toFixed(6);
          }
          
          const formattedChange = Math.abs(priceChange).toFixed(2);
          
          // Calculate impact on user's position
          const userValue = holding.balanceUSD || 0;
          const valueChange = (userValue * absPriceChange) / 100;
          const formattedValueChange = valueChange >= 1 
            ? `$${valueChange.toFixed(2)}` 
            : `$${valueChange.toFixed(4)}`;

          addNotification({
            type: isIncrease ? 'success' : 'warning',
            title: `${changeEmoji} Price Alert: ${assetName}`,
            message: `${assetName} ${direction} ${formattedChange}% ($${formattedPrice}). Your position ${isIncrease ? 'gained' : 'lost'} ${formattedValueChange}.`,
            action: {
              label: 'View Portfolio',
              onClick: () => {
                // Navigate to portfolio
                window.location.href = '/';
              }
            }
          });
        }
      }

      // Always update previous price (even if we didn't notify)
      // This ensures we have the latest price for future comparisons
      previousPricesRef.current.set(priceKey, {
        price,
        timestamp: data.timestamp || Date.now()
      });

      // Save to localStorage
      try {
        const priceData: Record<string, { price: number; timestamp: number }> = {};
        previousPricesRef.current.forEach((value, key) => {
          priceData[key] = value;
        });
        localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(priceData));
      } catch (error) {
        console.error('Error saving price history:', error);
      }
    };

    socket.on('transfer_received', handleTransferReceived);
    socket.on('transfer_sent', handleTransferSent);
    socket.on('balance_update', handleBalanceUpdate);
    socket.on('price_update', handlePriceUpdate);

    return () => {
      socket.off('transfer_received', handleTransferReceived);
      socket.off('transfer_sent', handleTransferSent);
      socket.off('balance_update', handleBalanceUpdate);
      socket.off('price_update', handlePriceUpdate);
    };
  }, [socket, wsConnected, address, addNotification, holdings]);

  const value: NotificationContextType = {
    notifications,
    archivedNotifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    archiveNotification,
    archiveOldNotifications,
    removeNotification,
    clearAllNotifications,
    clearArchive,
    refreshValidationNotifications: checkValidationNotifications,
    unreadCount,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}; 