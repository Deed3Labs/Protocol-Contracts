import { useState, useEffect, useCallback, useRef } from 'react';

// Type definition for WakeLockSentinel
interface WakeLockSentinel extends EventTarget {
  released: boolean;
  type: 'screen';
  release(): Promise<void>;
}

/**
 * Hook for Wake Lock API
 * Prevents screen from sleeping during critical operations
 */
export function useWakeLock() {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    setIsSupported('wakeLock' in navigator);
  }, []);

  /**
   * Request wake lock
   */
  const request = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn('[WakeLock] Not supported in this browser');
      return false;
    }

    try {
      const wakeLock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = wakeLock;
      setIsActive(true);

      // Handle release (e.g., when user switches tabs)
      wakeLock.addEventListener('release', () => {
        setIsActive(false);
        wakeLockRef.current = null;
      });

      return true;
    } catch (error: any) {
      console.error('[WakeLock] Request failed:', error);
      // User denied or other error
      if (error.name === 'NotAllowedError') {
        console.warn('[WakeLock] Permission denied');
      }
      return false;
    }
  }, [isSupported]);

  /**
   * Release wake lock
   */
  const release = useCallback(async (): Promise<void> => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setIsActive(false);
      } catch (error) {
        console.error('[WakeLock] Release failed:', error);
      }
    }
  }, []);

  // Auto-release on page visibility change
  useEffect(() => {
    if (!isSupported) return;

    const handleVisibilityChange = () => {
      if (document.hidden && wakeLockRef.current) {
        // Wake lock is automatically released when page is hidden
        // But we should release it manually for better control
        release();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSupported, release]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        release();
      }
    };
  }, [release]);

  return {
    isSupported,
    isActive,
    request,
    release,
  };
}
