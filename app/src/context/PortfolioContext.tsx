import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';
import { useMultichainActivity } from '@/hooks/useMultichainActivity';
import { usePortfolioHoldings } from '@/hooks/usePortfolioHoldings';
import { useBankBalance } from '@/hooks/useBankBalance';
import { usePlaidInvestmentsHoldings } from '@/hooks/usePlaidInvestmentsHoldings';
import { useWebSocket } from '@/hooks/useWebSocket';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import type { MultichainBalance } from '@/hooks/useMultichainBalances';
import type { WalletTransaction } from '@/types/transactions';
import type { BankAccountBalance } from '@/utils/apiClient';

interface PortfolioContextType {
  // Balances
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  previousTotalBalanceUSD: number; // For animations
  
  // Holdings (crypto/NFTs + Plaid investment/brokerage when linked)
  holdings: Array<{
    id: string;
    type: 'nft' | 'rwa' | 'token' | 'equity'; // 'equity' = Plaid brokerage holdings
    asset_name: string;
    asset_symbol: string;
    balance?: string;
    balanceUSD: number;
    chainId: number;
    chainName: string;
    [key: string]: any;
  }>;
  
  // Cash balance (crypto stablecoins + connected bank balance)
  cashBalance: {
    totalCash: number;
    usdcBalance: number;
    otherStablecoinsBalance: number;
    /** Sum of connected bank account balances (from Plaid) */
    bankCash?: number;
    /** Sum of stablecoin holdings (USDC + other stablecoins) */
    cryptoCash?: number;
    /** Whether user has linked a bank account (Plaid) for payouts */
    bankLinked?: boolean;
  };

  // Linked bank accounts (Plaid) – single source for modal + Linked Accounts section
  bankAccounts: BankAccountBalance[];
  bankAccountsLoading: boolean;
  refreshBankBalance: (skipCache?: boolean) => Promise<void>;

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
  
  // User Activity Detection: Only poll when tab is visible
  const { isVisible: isPageVisible } = usePageVisibility();
  
  // Use unified portfolio holdings hook (optimized - handles tokens + NFTs + cash balance)
  const {
    holdings: portfolioHoldings,
    cashBalance: portfolioCashBalance,
    isLoading: holdingsLoadingFromHook,
    refresh: refreshHoldingsHook,
  } = usePortfolioHoldings();

  // Bank balance (Plaid) - single source for modal + Linked Accounts; merged into cash balance
  const {
    bankCash,
    linked: bankLinked,
    accounts: bankAccounts,
    isLoading: bankAccountsLoading,
    refresh: refreshBankBalance,
  } = useBankBalance(address ?? undefined);

  // Plaid investment holdings (brokerage) – merged into portfolio holdings for display
  const {
    holdings: plaidInvestmentHoldings,
    isLoading: plaidInvestmentsLoading,
    refresh: refreshPlaidInvestments,
  } = usePlaidInvestmentsHoldings(address ?? undefined);

  // Consolidated cash balance: crypto (stablecoins) + bank
  const cashBalance = useMemo(() => {
    const cryptoCash = portfolioCashBalance.totalCash;
    const totalCash = cryptoCash + bankCash;
    return {
      ...portfolioCashBalance,
      totalCash,
      bankCash,
      cryptoCash,
      bankLinked,
    };
  }, [portfolioCashBalance, bankCash, bankLinked]);
  
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
  
  // Holdings: portfolio (tokens/NFTs/RWAs) + Plaid investment holdings (brokerage)
  const holdings = useMemo(
    () => [...portfolioHoldings, ...plaidInvestmentHoldings],
    [portfolioHoldings, plaidInvestmentHoldings]
  );
  
  // Determine loading states
  const balancesLoading = useMemo(() => {
    // Use the loading state from the hook, or consider loading if we're connected but have no balances yet
    return balancesLoadingFromHook || (isConnected && multichainBalances.length === 0 && totalBalanceUSD === 0);
  }, [balancesLoadingFromHook, isConnected, multichainBalances.length, totalBalanceUSD]);
  
  const holdingsLoading = useMemo(() => {
    return holdingsLoadingFromHook || plaidInvestmentsLoading || (isConnected && holdings.length === 0);
  }, [holdingsLoadingFromHook, plaidInvestmentsLoading, isConnected, holdings.length]);
  
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
      refreshBankBalance(),
      refreshPlaidInvestments(),
    ]);
  }, [refreshBalances, refreshHoldings, refreshActivity, refreshBankBalance, refreshPlaidInvestments]);
  
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

  // Auto-refresh with optimized intervals to reduce Alchemy compute unit usage
  // Optimized: Increased intervals (30min no WS, 60min with WS) to reduce API calls
  // User Activity Detection: Only poll when tab is visible
  // This is a fallback in case WebSocket is not available
  useEffect(() => {
    if (!isConnected) return;

    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true;

    // Initial load - refresh all data (only if page is visible)
    const initialRefresh = async () => {
      if (isMounted && isPageVisible) {
        await refreshAll();
      }
    };
    initialRefresh();

    // Set up auto-refresh with optimized intervals
    // Only use if WebSocket is not connected
    const setupInterval = () => {
      if (wsConnected) {
        // WebSocket is connected, rely on real-time updates
        // Still refresh every 60 minutes as backup (optimized from 30 minutes)
        intervalId = setInterval(() => {
          // User Activity Detection: Only refresh if page is visible
          if (isMounted && !wsConnected && isPageVisible) {
            refreshAll();
          }
        }, 60 * 60 * 1000); // 60 minutes as backup (optimized from 30 minutes)
      } else {
        // No WebSocket, use polling every 30 minutes (optimized from 10 minutes)
        intervalId = setInterval(() => {
          // User Activity Detection: Only refresh if page is visible
          if (isMounted && isPageVisible) {
            refreshAll();
          }
        }, 30 * 60 * 1000); // 30 minutes (optimized from 10 minutes to reduce Alchemy compute units)
      }
    };

    // Delay interval setup to avoid immediate refresh after initial load
    const timeoutId = setTimeout(setupInterval, 60000); // Wait 1 minute before setting up interval

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      clearTimeout(timeoutId);
    };
  }, [isConnected, wsConnected, isPageVisible]); // Include isPageVisible to pause when tab is hidden
  
  const contextValue: PortfolioContextType = {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    previousTotalBalanceUSD,
    holdings,
    cashBalance,
    bankAccounts,
    bankAccountsLoading,
    refreshBankBalance,
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
