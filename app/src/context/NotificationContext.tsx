import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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
      } else {
        // Initialize with sample notifications
        const sampleNotifications: Notification[] = [
          {
            id: '1',
            type: 'success',
            title: 'T-Deed Minted Successfully',
            message: 'Your Land T-Deed #123 has been successfully minted on Base Sepolia.',
            timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
            read: false,
            archived: false,
            action: {
              label: 'View T-Deed',
              onClick: () => console.log('View T-Deed clicked')
            }
          },
          {
            id: '2',
            type: 'info',
            title: 'New Message Received',
            message: 'You have a new message from 0x1234... regarding your Commercial Equipment T-Deed.',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
            read: false,
            archived: false,
            action: {
              label: 'View Message',
              onClick: () => console.log('View Message clicked')
            }
          },
          {
            id: '3',
            type: 'warning',
            title: 'Validation Required',
            message: 'Your Vehicle T-Deed #456 requires validation. Please submit required documents.',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
            read: true,
            archived: false
          }
        ];
        setNotifications(sampleNotifications);
        saveToStorage(sampleNotifications, []);
      }
    } catch (error) {
      console.error('Error loading notifications from localStorage:', error);
    }
  }, []);

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
    unreadCount,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}; 