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

    /*
     * Ask before attempting, so the ordinary case is silent.
     *
     * `periodic-background-sync` is queryable, so the state is knowable without throwing. A browser
     * that does not know the name throws on the query itself, which is why this is wrapped and
     * falls through rather than treating "cannot ask" as "cannot register".
     */
    try {
      const status = await navigator.permissions?.query({
        name: 'periodic-background-sync' as PermissionName,
      });
      if (status && status.state !== 'granted') {
        console.info('[PeriodicSync] Not granted — the browser only allows this for installed apps.');
        return false;
      }
    } catch {
      // The permission name is unknown here; fall through and let the register call answer.
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
      /*
       * NotAllowedError is the expected answer, not a failure.
       *
       * Periodic Background Sync is only granted to an INSTALLED app whose site-engagement score
       * the browser considers high enough, and it is never promptable — Chrome decides silently and
       * there is no setting a member can reach. So in an ordinary tab this rejects every time, by
       * design.
       *
       * It used to be a console.error saying "user needs to grant permission", which was wrong on
       * both counts: nothing failed, and there is nothing for anyone to grant. A red line in the
       * console for a documented no-op is how people learn to stop reading the console — and this
       * one turned up in the middle of debugging something unrelated.
       */
      if (error?.name === 'NotAllowedError') {
        console.info('[PeriodicSync] Not granted — the browser only allows this for installed apps.');
        return false;
      }
      console.error('[PeriodicSync] Registration failed:', error);
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
