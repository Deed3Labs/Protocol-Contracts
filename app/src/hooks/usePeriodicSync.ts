import { useEffect, useState, useCallback } from 'react';

/**
 * Hook for Periodic Background Sync API
 * Registers periodic sync tasks for background data updates
 */
export function usePeriodicSync() {
  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  useEffect(() => {
    const checkSupport = async () => {
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          setIsSupported('periodicSync' in registration);
        } catch (error) {
          setIsSupported(false);
        }
      } else {
        setIsSupported(false);
      }
    };
    checkSupport();
  }, []);

  /**
   * Register periodic sync
   */
  const register = useCallback(async (
    tag: string,
    options: { minInterval?: number } = {}
  ): Promise<boolean> => {
    if (!isSupported) {
      console.warn('[PeriodicSync] Not supported in this browser');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const periodicSync = (registration as any).periodicSync;
      if (periodicSync) {
        await periodicSync.register(tag, {
          minInterval: options.minInterval || 24 * 60 * 60 * 1000, // Default: 24 hours
        });
        setIsRegistered(true);
        console.log('[PeriodicSync] Registered:', tag);
        return true;
      }
      return false;
    } catch (error: any) {
      console.error('[PeriodicSync] Registration failed:', error);
      if (error.name === 'NotAllowedError') {
        console.warn('[PeriodicSync] Permission denied - user needs to grant permission');
      }
      return false;
    }
  }, [isSupported]);

  /**
   * Unregister periodic sync
   */
  const unregister = useCallback(async (tag: string): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const periodicSync = (registration as any).periodicSync;
      if (periodicSync) {
        await periodicSync.unregister(tag);
        setIsRegistered(false);
        console.log('[PeriodicSync] Unregistered:', tag);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PeriodicSync] Unregistration failed:', error);
      return false;
    }
  }, [isSupported]);

  /**
   * Get registered tags
   */
  const getTags = useCallback(async (): Promise<string[]> => {
    if (!isSupported) {
      return [];
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const periodicSync = (registration as any).periodicSync;
      if (periodicSync) {
        return await periodicSync.getTags();
      }
      return [];
    } catch (error) {
      console.error('[PeriodicSync] Get tags failed:', error);
      return [];
    }
  }, [isSupported]);

  return {
    isSupported,
    isRegistered,
    register,
    unregister,
    getTags,
  };
}
