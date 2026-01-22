import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';
import { useMultichainTokenBalances } from '@/hooks/useMultichainTokenBalances';
import { useMultichainDeedNFTs } from '@/hooks/useMultichainDeedNFTs';
import { useMultichainActivity } from '@/hooks/useMultichainActivity';
import type { MultichainBalance } from '@/hooks/useMultichainBalances';
import type { WalletTransaction } from '@/hooks/useWalletActivity';

interface PortfolioContextType {
  // Balances
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  previousTotalBalanceUSD: number; // For animations
  
  // Holdings
  holdings: Array<{
    id: string;
    type: 'nft' | 'token';
    asset_name: string;
    asset_symbol: string;
    balance?: string;
    balanceUSD: number;
    chainId: number;
    chainName: string;
    [key: string]: any;
  }>;
  
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
  const { isConnected } = useAppKitAccount();
  
  // Use multichain hooks
  const {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    refresh: refreshBalancesHook,
  } = useMultichainBalances();
  
  const {
    tokens: tokenBalances,
    refresh: refreshTokensHook,
  } = useMultichainTokenBalances();
  
  const {
    nfts: multichainNFTs,
    refresh: refreshNFTsHook,
  } = useMultichainDeedNFTs();
  
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
  
  // Update previous balance when totalBalanceUSD changes (but not on first load)
  useEffect(() => {
    if (isFirstLoadRef.current) {
      // On first load, set both current and previous to the same value
      // Even if it's 0, we need to initialize it
      previousTotalBalanceUSDRef.current = totalBalanceUSD;
      setPreviousTotalBalanceUSD(totalBalanceUSD);
      // Only mark as not first load once we have a non-zero value or after a delay
      if (totalBalanceUSD > 0) {
        isFirstLoadRef.current = false;
      }
    } else {
      // On subsequent updates, preserve the old value for animation
      setPreviousTotalBalanceUSD(previousTotalBalanceUSDRef.current);
      previousTotalBalanceUSDRef.current = totalBalanceUSD;
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
  
  // Combine NFTs and tokens into holdings
  const holdings = useMemo(() => {
    const allHoldings: PortfolioContextType['holdings'] = [];
    
    // Add NFTs
    multichainNFTs.forEach((nft) => {
      allHoldings.push({
        id: `${nft.chainId}-nft-${nft.tokenId}`,
        type: 'nft',
        asset_name: nft.definition || `T-Deed #${nft.tokenId}`,
        asset_symbol: 'T-Deed',
        balanceUSD: 0, // NFTs don't have USD value yet
        chainId: nft.chainId,
        chainName: nft.chainName,
        tokenId: nft.tokenId,
        // Include all NFT properties
        owner: nft.owner,
        assetType: nft.assetType,
        uri: nft.uri,
        definition: nft.definition,
        configuration: nft.configuration,
        validatorAddress: nft.validatorAddress,
        token: nft.token,
        salt: nft.salt,
        isMinted: nft.isMinted,
      });
    });
    
    // Add tokens
    tokenBalances.forEach((token) => {
      const holding: PortfolioContextType['holdings'][0] = {
        id: `${token.chainId}-token-${token.address}`,
        type: 'token',
        asset_name: token.name,
        asset_symbol: token.symbol,
        balanceUSD: token.balanceUSD,
        chainId: token.chainId,
        chainName: token.chainName,
        // Additional properties
        balance: token.balance,
        address: token.address,
        decimals: token.decimals,
        balanceRaw: token.balanceRaw,
        logoUrl: token.logoUrl,
      };
      allHoldings.push(holding);
    });
    
    // Sort by USD value (descending), then by type (NFTs first if same value)
    return allHoldings.sort((a, b) => {
      if (b.balanceUSD !== a.balanceUSD) {
        return b.balanceUSD - a.balanceUSD;
      }
      // If same value, show NFTs first
      if (a.type === 'nft' && b.type === 'token') return -1;
      if (a.type === 'token' && b.type === 'nft') return 1;
      return 0;
    });
  }, [multichainNFTs, tokenBalances]);
  
  // Determine loading states
  const balancesLoading = useMemo(() => {
    // Consider loading if we're connected but have no balances yet
    return isConnected && multichainBalances.length === 0 && totalBalanceUSD === 0;
  }, [isConnected, multichainBalances.length, totalBalanceUSD]);
  
  const holdingsLoading = useMemo(() => {
    return isConnected && holdings.length === 0 && multichainNFTs.length === 0 && tokenBalances.length === 0;
  }, [isConnected, holdings.length, multichainNFTs.length, tokenBalances.length]);
  
  const isLoading = balancesLoading || holdingsLoading || activityLoading;
  
  // Refresh functions
  const refreshBalances = useCallback(async () => {
    await refreshBalancesHook();
  }, [refreshBalancesHook]);
  
  const refreshHoldings = useCallback(async () => {
    await Promise.all([
      refreshTokensHook(),
      refreshNFTsHook(),
    ]);
  }, [refreshTokensHook, refreshNFTsHook]);
  
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

  // Auto-refresh balances every hour after initial load
  useEffect(() => {
    if (!isConnected) return;

    // Initial load - refresh all data
    const initialRefresh = async () => {
      await refreshAll();
    };
    initialRefresh();

    // Set up hourly auto-refresh
    const intervalId = setInterval(() => {
      refreshAll();
    }, 60 * 60 * 1000); // 1 hour in milliseconds

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected, refreshAll]);
  
  const contextValue: PortfolioContextType = {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    previousTotalBalanceUSD,
    holdings,
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
