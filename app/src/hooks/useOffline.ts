import { useState, useEffect, useCallback } from 'react';

interface OfflineAction {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  retries: number;
}

/**
 * Hook for offline detection and action queue management
 */
export function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedActions, setQueuedActions] = useState<OfflineAction[]>([]);

  // Load queued actions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('offline-actions-queue');
      if (stored) {
        setQueuedActions(JSON.parse(stored));
      }
    } catch (error) {
      console.error('[Offline] Failed to load queued actions:', error);
    }
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Offline] Connection restored');
      setIsOnline(true);
      processQueuedActions();
    };

    const handleOffline = () => {
      console.log('[Offline] Connection lost');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Save queued actions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('offline-actions-queue', JSON.stringify(queuedActions));
    } catch (error) {
      console.error('[Offline] Failed to save queued actions:', error);
    }
  }, [queuedActions]);

  /**
   * Queue an action to be executed when online
   */
  const queueAction = useCallback((type: string, data: any) => {
    const action: OfflineAction = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    setQueuedActions(prev => [...prev, action]);
    return action.id;
  }, []);

  /**
   * Remove an action from the queue
   */
  const removeQueuedAction = useCallback((id: string) => {
    setQueuedActions(prev => prev.filter(action => action.id !== id));
  }, []);

  /**
   * Process queued actions when back online
   */
  const processQueuedActions = useCallback(async () => {
    if (!isOnline || queuedActions.length === 0) return;

    const actions = [...queuedActions];
    setQueuedActions([]);

    for (const action of actions) {
      try {
        // Try to execute the action
        // This would typically call an API or perform the operation
        console.log('[Offline] Processing queued action:', action.type, action.data);
        
        // Emit event for components to handle
        window.dispatchEvent(new CustomEvent('offline-action-process', {
          detail: action
        }));

        // If successful, action is removed
        // If failed, re-queue with incremented retries
        if (action.retries < 3) {
          // Re-queue if max retries not reached
          // In a real implementation, you'd check if the action succeeded
        }
      } catch (error) {
        console.error('[Offline] Failed to process action:', error);
        // Re-queue with incremented retries
        if (action.retries < 3) {
          setQueuedActions(prev => [...prev, {
            ...action,
            retries: action.retries + 1,
          }]);
        }
      }
    }
  }, [isOnline, queuedActions]);

  // Process actions when coming back online
  useEffect(() => {
    if (isOnline && queuedActions.length > 0) {
      processQueuedActions();
    }
  }, [isOnline, queuedActions.length, processQueuedActions]);

  return {
    isOnline,
    isOffline: !isOnline,
    queuedActions,
    queueAction,
    removeQueuedAction,
    processQueuedActions,
  };
}
