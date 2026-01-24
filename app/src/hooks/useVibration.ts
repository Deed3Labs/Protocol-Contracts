import { useCallback, useState, useEffect } from 'react';

/**
 * Hook for Vibration API
 * Provides haptic feedback for user interactions
 */
export function useVibration() {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('vibrate' in navigator);
  }, []);

  /**
   * Vibrate with a pattern
   * @param pattern - Vibration pattern (number or array of numbers)
   */
  const vibrate = useCallback((pattern: number | number[]): boolean => {
    if (!isSupported) {
      return false;
    }

    try {
      navigator.vibrate(pattern);
      return true;
    } catch (error) {
      console.error('[Vibration] Failed:', error);
      return false;
    }
  }, [isSupported]);

  /**
   * Cancel vibration
   */
  const cancel = useCallback((): boolean => {
    if (!isSupported) {
      return false;
    }

    try {
      navigator.vibrate(0);
      return true;
    } catch (error) {
      console.error('[Vibration] Cancel failed:', error);
      return false;
    }
  }, [isSupported]);

  /**
   * Short vibration for button clicks
   */
  const short = useCallback((): boolean => {
    return vibrate(50);
  }, [vibrate]);

  /**
   * Medium vibration for notifications
   */
  const medium = useCallback((): boolean => {
    return vibrate([100, 50, 100]);
  }, [vibrate]);

  /**
   * Long vibration for errors
   */
  const long = useCallback((): boolean => {
    return vibrate([200, 100, 200, 100, 200]);
  }, [vibrate]);

  /**
   * Success pattern
   */
  const success = useCallback((): boolean => {
    return vibrate([50, 30, 50]);
  }, [vibrate]);

  /**
   * Error pattern
   */
  const error = useCallback((): boolean => {
    return vibrate([200, 100, 200]);
  }, [vibrate]);

  return {
    isSupported,
    vibrate,
    cancel,
    short,
    medium,
    long,
    success,
    error,
  };
}
