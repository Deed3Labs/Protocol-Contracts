import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';
import { useMultichainActivity } from '@/hooks/useMultichainActivity';
import { usePortfolioHoldings } from '@/hooks/usePortfolioHoldings';
import { useWebSocket } from '@/hooks/useWebSocket';
import { DynamicIntervalManager } from '@/utils/dynamicInterval';
import type { MultichainBalance } from '@/hooks/useMultichainBalances';
import type { WalletTransaction } from '@/types/transactions';

interface PortfolioContextType {
  // Balances
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  previousTotalBalanceUSD: number; // For animations
  
  // Holdings
  holdings: Array<{
    id: string;
    type: 'nft' | 'rwa' | 'token'; // 'rwa' for T-Deeds (Real World Assets)
    asset_name: string;
    asset_symbol: string;
    balance?: string;
    balanceUSD: number;
    chainId: number;
    chainName: string;
    [key: string]: any;
  }>;
  
  // Cash balance (automatically calculated from stablecoin holdings)
  cashBalance: {
    totalCash: number;
    usdcBalance: number;
    otherStablecoinsBalance: number;
  };
  
  // Activity
  transactions: WalletTransaction[];
  
  // Loading states
  isLoading: boolean;
  balancesLoading: boolean;
  holdingsLoading: boolean;
  activityLoading: boolean;
  
  // Errors
  error: string | null;
  
  // Refresh functions
  refreshBalances: () => Promise<void>;
  refreshHoldings: () => Promise<void>;
  refreshActivity: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isConnected, address } = useAppKitAccount();
  
  // WebSocket connection for real-time updates
  const { socket, isConnected: wsConnected } = useWebSocket(address, isConnected);
  
  // Use unified portfolio holdings hook (optimized - handles tokens + NFTs + cash balance)
  const {
    holdings: portfolioHoldings,
    cashBalance,
    isLoading: holdingsLoadingFromHook,
    refresh: refreshHoldingsHook,
  } = usePortfolioHoldings();
  
  // Use multichain hooks for balances and activity (not covered by usePortfolioHoldings)
  const {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    isLoading: balancesLoadingFromHook,
    refresh: refreshBalancesHook,
  } = useMultichainBalances();
  
  const {
    transactions: walletTransactions,
    isLoading: activityLoading,
    refresh: refreshActivityHook,
  } = useMultichainActivity(10);
  
  // Store previous values for smooth transitions
  const previousTotalBalanceUSDRef = useRef<number>(0);
  const [previousTotalBalanceUSD, setPreviousTotalBalanceUSD] = useState<number>(0);
  
  // Track if this is the first load
  const isFirstLoadRef = useRef<boolean>(true);
  
  // Track if we're currently refreshing to prevent resetting to 0
  const isRefreshingRef = useRef<boolean>(false);
  
  // Update previous balance when totalBalanceUSD changes (but not on first load or during refresh)
  useEffect(() => {
    // If we're refreshing and the new value is 0, don't update - preserve the previous value
    // This prevents the balance from resetting to 0.00 during refresh
    if (isRefreshingRef.current && totalBalanceUSD === 0) {
      return;
    }
    
    if (isFirstLoadRef.current) {
      // On first load, set both current and previous to the same value
      // Even if it's 0, we need to initialize it
      previousTotalBalanceUSDRef.current = totalBalanceUSD;
      setPreviousTotalBalanceUSD(totalBalanceUSD);
      // Only mark as not first load once we have a non-zero value
      if (totalBalanceUSD > 0) {
        isFirstLoadRef.current = false;
      }
    } else {
      // On subsequent updates, preserve the old value for animation
      // Only update if the new value is different from the current stored value
      // This ensures animation triggers when balance changes
      const currentStoredValue = previousTotalBalanceUSDRef.current;
      if (totalBalanceUSD !== currentStoredValue) {
        // Preserve the old value for animation
        setPreviousTotalBalanceUSD(currentStoredValue);
        // Update the ref to the new value
        previousTotalBalanceUSDRef.current = totalBalanceUSD;
      }
    }
  }, [totalBalanceUSD]);
  
  // Mark first load as complete after initial data fetch (even if balance is 0)
  useEffect(() => {
    if (isConnected && multichainBalances.length > 0) {
      // Data has been fetched, mark first load as complete
      const timer = setTimeout(() => {
        isFirstLoadRef.current = false;
      }, 1000); // Give it 1 second to load initial data
      return () => clearTimeout(timer);
    }
  }, [isConnected, multichainBalances.length]);
  
  // Holdings are now provided by usePortfolioHoldings hook (optimized)
  const holdings = portfolioHoldings;
  
  // Determine loading states
  const balancesLoading = useMemo(() => {
    // Use the loading state from the hook, or consider loading if we're connected but have no balances yet
    return balancesLoadingFromHook || (isConnected && multichainBalances.length === 0 && totalBalanceUSD === 0);
  }, [balancesLoadingFromHook, isConnected, multichainBalances.length, totalBalanceUSD]);
  
  const holdingsLoading = useMemo(() => {
    return holdingsLoadingFromHook || (isConnected && holdings.length === 0);
  }, [holdingsLoadingFromHook, isConnected, holdings.length]);
  
  const isLoading = balancesLoading || holdingsLoading || activityLoading;
  
  // Track when refresh starts and ends (must be after loading states are defined)
  useEffect(() => {
    if (balancesLoading || holdingsLoading || activityLoading) {
      isRefreshingRef.current = true;
    } else {
      // When refresh completes, mark as not refreshing
      isRefreshingRef.current = false;
    }
  }, [balancesLoading, holdingsLoading, activityLoading]);
  
  // Refresh functions
  const refreshBalances = useCallback(async () => {
    await refreshBalancesHook();
  }, [refreshBalancesHook]);
  
  const refreshHoldings = useCallback(async () => {
    await refreshHoldingsHook();
  }, [refreshHoldingsHook]);
  
  const refreshActivity = useCallback(async () => {
    await refreshActivityHook();
  }, [refreshActivityHook]);
  
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshBalances(),
      refreshHoldings(),
      refreshActivity(),
    ]);
  }, [refreshBalances, refreshHoldings, refreshActivity]);
  
  // Reset previous balance when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      previousTotalBalanceUSDRef.current = 0;
      setPreviousTotalBalanceUSD(0);
      isFirstLoadRef.current = true;
    }
  }, [isConnected]);

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket || !wsConnected) return;

    const handleBalances = (data: any) => {
      console.log('[WebSocket] Received balances update:', data);
      // Trigger refresh to update with new data
      refreshBalances();
    };

    const handleNFTs = (data: any) => {
      console.log('[WebSocket] Received NFTs update:', data);
      refreshHoldings();
    };

    const handleTransactions = (data: any) => {
      console.log('[WebSocket] Received transactions update:', data);
      refreshActivity();
    };

    const handlePrices = (data: any) => {
      console.log('[WebSocket] Received prices update:', data);
      // Prices affect balance calculations, so refresh balances
      refreshBalances();
    };

    const handlePriceUpdate = (data: any) => {
      console.log('[WebSocket] Received price update:', data);
      refreshBalances();
    };

    socket.on('balances', handleBalances);
    socket.on('nfts', handleNFTs);
    socket.on('transactions', handleTransactions);
    socket.on('prices', handlePrices);
    socket.on('price_update', handlePriceUpdate);

    return () => {
      socket.off('balances', handleBalances);
      socket.off('nfts', handleNFTs);
      socket.off('transactions', handleTransactions);
      socket.off('prices', handlePrices);
      socket.off('price_update', handlePriceUpdate);
    };
  }, [socket, wsConnected, refreshBalances, refreshHoldings, refreshActivity]);

  // Auto-refresh with dynamic intervals (5-60 minutes)
  // Adjusts based on WebSocket connection, user activity, and data changes
  const intervalManagerRef = useRef<DynamicIntervalManager | null>(null);
  const lastDataChangeRef = useRef<number>(Date.now());
  const dataChangeCountRef = useRef<number>(0);
  const prevTotalBalanceRef = useRef<number>(totalBalanceUSD);
  const prevHoldingsCountRef = useRef<number>(holdings.length);
  const prevTransactionsCountRef = useRef<number>(walletTransactions.length);

  // Track data changes
  useEffect(() => {
    if (prevTotalBalanceRef.current !== totalBalanceUSD || 
        prevHoldingsCountRef.current !== holdings.length ||
        prevTransactionsCountRef.current !== walletTransactions.length) {
      dataChangeCountRef.current++;
      lastDataChangeRef.current = Date.now();
      if (intervalManagerRef.current) {
        intervalManagerRef.current.recordDataChange();
      }
    }

    prevTotalBalanceRef.current = totalBalanceUSD;
    prevHoldingsCountRef.current = holdings.length;
    prevTransactionsCountRef.current = walletTransactions.length;
  }, [totalBalanceUSD, holdings.length, walletTransactions.length]);

  // Setup dynamic interval manager
  useEffect(() => {
    if (!isConnected) {
      if (intervalManagerRef.current) {
        intervalManagerRef.current.stop();
        intervalManagerRef.current = null;
      }
      return;
    }

    // Initial load - refresh all data
    const initialRefresh = async () => {
      try {
        await refreshAll();
      } catch (error) {
        console.error('[PortfolioContext] Error in initial refresh:', error);
        if (intervalManagerRef.current) {
          intervalManagerRef.current.recordExecution(false);
        }
      }
    };
    initialRefresh();

    // Create dynamic interval manager
    const refreshCallback = async () => {
      try {
        await refreshAll();
        if (intervalManagerRef.current) {
          intervalManagerRef.current.recordExecution(true);
        }
      } catch (error) {
        console.error('[PortfolioContext] Error in auto-refresh:', error);
        if (intervalManagerRef.current) {
          intervalManagerRef.current.recordExecution(false);
        }
      }
    };

    intervalManagerRef.current = new DynamicIntervalManager(refreshCallback, {
      minInterval: 5 * 60 * 1000, // 5 minutes
      maxInterval: 60 * 60 * 1000, // 60 minutes
      initialInterval: wsConnected ? 30 * 60 * 1000 : 10 * 60 * 1000, // Start at 30 min if WS connected, 10 min otherwise
    });

    // Update conditions based on WebSocket status
    intervalManagerRef.current.updateConditions({
      wsConnected,
      isUserActive: true, // Will be updated by activity tracking
    });

    intervalManagerRef.current.start();

    // Update conditions when WebSocket status changes
    const updateConditions = () => {
      if (intervalManagerRef.current) {
        const timeSinceLastChange = Date.now() - lastDataChangeRef.current;
        const dataChangeFrequency = timeSinceLastChange > 0 
          ? (dataChangeCountRef.current * 60000) / timeSinceLastChange 
          : 0;

        intervalManagerRef.current.updateConditions({
          wsConnected,
          dataChangeFrequency,
          lastChangeTime: dataChangeCountRef.current > 0 ? lastDataChangeRef.current : undefined,
        });
      }
    };

    // Update conditions periodically and when WebSocket status changes
    const conditionUpdateInterval = setInterval(updateConditions, 60000); // Update every minute

    return () => {
      if (intervalManagerRef.current) {
        intervalManagerRef.current.stop();
        intervalManagerRef.current = null;
      }
      clearInterval(conditionUpdateInterval);
    };
  }, [isConnected, wsConnected, refreshAll]); // Include wsConnected to adjust interval based on WebSocket status
  
  const contextValue: PortfolioContextType = {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    previousTotalBalanceUSD,
    holdings,
    cashBalance, // Automatically calculated from stablecoin holdings
    transactions: walletTransactions,
    isLoading,
    balancesLoading,
    holdingsLoading,
    activityLoading,
    error: null,
    refreshBalances,
    refreshHoldings,
    refreshActivity,
    refreshAll,
  };
  
  return (
    <PortfolioContext.Provider value={contextValue}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = () => {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
};
