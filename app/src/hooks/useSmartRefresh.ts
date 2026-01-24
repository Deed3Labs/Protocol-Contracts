import { useCallback, useRef } from 'react';
import { usePortfolio } from '@/context/PortfolioContext';

interface RefreshOptions {
  priority?: 'high' | 'medium' | 'low';
  debounceMs?: number;
  onlyVisible?: boolean;
}

/**
 * Hook for smart refresh with debouncing and prioritization
 */
export function useSmartRefresh() {
  const { refreshAll, refreshBalances, refreshHoldings, refreshActivity } = usePortfolio();
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastRefresh = useRef<Map<string, number>>(new Map());

  /**
   * Debounced refresh function
   */
  const debouncedRefresh = useCallback((
    refreshFn: () => Promise<void>,
    key: string,
    debounceMs: number = 1000
  ) => {
    // Clear existing timer
    const existingTimer = debounceTimers.current.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      await refreshFn();
      debounceTimers.current.delete(key);
      lastRefresh.current.set(key, Date.now());
    }, debounceMs);

    debounceTimers.current.set(key, timer);
  }, []);

  /**
   * Smart refresh with prioritization
   */
  const smartRefresh = useCallback(async (options: RefreshOptions = {}) => {
    const {
      priority = 'medium',
      debounceMs = 1000,
      onlyVisible = false,
    } = options;

    // Skip if only visible data is requested and page is not visible
    if (onlyVisible && document.hidden) {
      return;
    }

    const now = Date.now();
    const minInterval = priority === 'high' ? 0 : priority === 'medium' ? 5000 : 30000;

    // Check if we recently refreshed
    const lastRefreshTime = lastRefresh.current.get('all') || 0;
    if (now - lastRefreshTime < minInterval) {
      // Use debounced refresh instead
      debouncedRefresh(refreshAll, 'all', debounceMs);
      return;
    }

    // High priority: refresh immediately
    if (priority === 'high') {
      await refreshAll();
      lastRefresh.current.set('all', now);
      return;
    }

    // Medium/Low priority: use debounced refresh
    debouncedRefresh(refreshAll, 'all', debounceMs);
  }, [refreshAll, debouncedRefresh]);

  /**
   * Smart refresh for balances only
   */
  const smartRefreshBalances = useCallback(async (options: RefreshOptions = {}) => {
    const { debounceMs = 1000 } = options;
    debouncedRefresh(refreshBalances, 'balances', debounceMs);
  }, [refreshBalances, debouncedRefresh]);

  /**
   * Smart refresh for holdings only
   */
  const smartRefreshHoldings = useCallback(async (options: RefreshOptions = {}) => {
    const { debounceMs = 1000 } = options;
    debouncedRefresh(refreshHoldings, 'holdings', debounceMs);
  }, [refreshHoldings, debouncedRefresh]);

  /**
   * Smart refresh for activity only
   */
  const smartRefreshActivity = useCallback(async (options: RefreshOptions = {}) => {
    const { debounceMs = 1000 } = options;
    debouncedRefresh(refreshActivity, 'activity', debounceMs);
  }, [refreshActivity, debouncedRefresh]);

  /**
   * Cleanup on unmount
   */
  const cleanup = useCallback(() => {
    for (const timer of debounceTimers.current.values()) {
      clearTimeout(timer);
    }
    debounceTimers.current.clear();
  }, []);

  return {
    smartRefresh,
    smartRefreshBalances,
    smartRefreshHoldings,
    smartRefreshActivity,
    cleanup,
  };
}
