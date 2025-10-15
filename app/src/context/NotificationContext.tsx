import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useDeedNFTData } from '@/hooks/useDeedNFTData';

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
const ARCHIVE_DAYS = 30; // Archive notifications older than 30 days

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<Notification[]>([]);
  const { address, isConnected } = useAppKitAccount();
  
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
  }, []);

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