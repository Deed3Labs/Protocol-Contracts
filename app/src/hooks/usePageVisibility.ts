/**
 * Hook to detect when the page/tab is visible or hidden
 * Used to pause polling when user is not actively viewing the app
 * This reduces unnecessary API calls and Alchemy compute unit consumption
 */

import { useEffect, useState, useRef } from 'react';

export interface UsePageVisibilityReturn {
  isVisible: boolean;
  isHidden: boolean;
}

/**
 * Hook to detect page visibility
 * Returns true when page is visible, false when hidden
 * 
 * @example
 * ```tsx
 * const { isVisible } = usePageVisibility();
 * 
 * useEffect(() => {
 *   if (!isVisible) {
 *     // Pause polling when tab is hidden
 *     return;
 *   }
 *   // Resume polling when tab is visible
 * }, [isVisible]);
 * ```
 */
export function usePageVisibility(): UsePageVisibilityReturn {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    // Check initial state
    if (typeof document === 'undefined') {
      return true; // SSR - assume visible
    }
    return !document.hidden;
  });

  const visibilityChangeHandler = useRef(() => {
    if (typeof document !== 'undefined') {
      setIsVisible(!document.hidden);
    }
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return; // SSR - no document
    }

    // Use Page Visibility API
    const handler = visibilityChangeHandler.current;
    document.addEventListener('visibilitychange', handler);

    return () => {
      document.removeEventListener('visibilitychange', handler);
    };
  }, []);

  return {
    isVisible,
    isHidden: !isVisible,
  };
}
