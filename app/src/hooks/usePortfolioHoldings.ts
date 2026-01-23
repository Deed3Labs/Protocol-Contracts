import { useMemo, useCallback } from 'react';
import { useMultichainBalances } from './useMultichainBalances';
import { useMultichainDeedNFTs } from './useMultichainDeedNFTs';
import { calculateCashBalance } from '@/utils/tokenUtils';

export interface UnifiedHolding {
  id: string;
  type: 'nft' | 'token';
  asset_name: string;
  asset_symbol: string;
  balance?: string;
  balanceUSD: number;
  chainId: number;
  chainName: string;
  address?: string;
  decimals?: number;
  [key: string]: any;
}

export interface PortfolioHoldings {
  holdings: UnifiedHolding[];
  cashBalance: {
    totalCash: number;
    usdcBalance: number;
    otherStablecoinsBalance: number;
  };
  totalValueUSD: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Unified hook to fetch all portfolio holdings (tokens + NFTs) and calculate cash balance
 * 
 * This hook optimizes the fetching process by:
 * - Using existing optimized hooks (which already use server API with batching)
 * - Calculating cash balance once from all holdings
 * - Providing a single source of truth for portfolio data
 * 
 * @example
 * ```tsx
 * const { holdings, cashBalance, totalValueUSD, refresh } = usePortfolioHoldings();
 * 
 * // Cash balance is automatically calculated from stablecoin holdings
 * console.log(`Cash: $${cashBalance.totalCash}`);
 * console.log(`USDC: $${cashBalance.usdcBalance}`);
 * ```
 */
export function usePortfolioHoldings(): PortfolioHoldings {
  // Use unified hook that fetches both native and ERC20 token balances
  const {
    balances: nativeBalances,
    tokens: tokenBalances,
    isLoading: balancesLoading,
    tokensLoading,
    refresh: refreshAllBalances, // This refreshes both native and ERC20 tokens
  } = useMultichainBalances();
  
  const {
    nfts: nftHoldings,
    isLoading: nftsLoading,
    refresh: refreshNFTs,
  } = useMultichainDeedNFTs();

  // Combine all holdings into unified format
  const holdings = useMemo<UnifiedHolding[]>(() => {
    const allHoldings: UnifiedHolding[] = [];
    
    // Add NFTs
    nftHoldings.forEach((nft) => {
      allHoldings.push({
        ...nft, // Include all NFT properties first
        id: `${nft.chainId}-nft-${nft.tokenId}`,
        type: 'nft' as const,
        asset_name: nft.definition || `T-Deed #${nft.tokenId}`,
        asset_symbol: 'T-Deed',
        balanceUSD: 0, // NFTs don't have USD value yet
        // Override with explicit values to ensure consistency
        chainId: nft.chainId,
        chainName: nft.chainName,
        tokenId: nft.tokenId,
      });
    });
    
    // Add native token balances (ETH, BASE, etc.)
    nativeBalances.forEach((balance) => {
      if (parseFloat(balance.balance) > 0 && balance.balanceUSD > 0) {
        allHoldings.push({
          id: `${balance.chainId}-native-${balance.currencySymbol}`,
          type: 'token',
          asset_name: balance.currencyName,
          asset_symbol: balance.currencySymbol,
          balanceUSD: balance.balanceUSD,
          chainId: balance.chainId,
          chainName: balance.chainName,
          balance: balance.balance,
          address: 'native',
          decimals: 18,
          isNative: true,
        });
      }
    });
    
    // Add ERC20 tokens
    tokenBalances.forEach((token) => {
      allHoldings.push({
        id: `${token.chainId}-token-${token.address}`,
        type: 'token',
        asset_name: token.name,
        asset_symbol: token.symbol,
        balanceUSD: token.balanceUSD,
        chainId: token.chainId,
        chainName: token.chainName,
        balance: token.balance,
        address: token.address,
        decimals: token.decimals,
        balanceRaw: token.balanceRaw,
        logoUrl: token.logoUrl,
      });
    });
    
    // Sort by USD value (descending), then by type (NFTs first if same value)
    return allHoldings.sort((a, b) => {
      if (b.balanceUSD !== a.balanceUSD) {
        return b.balanceUSD - a.balanceUSD;
      }
      if (a.type === 'nft' && b.type === 'token') return -1;
      if (a.type === 'token' && b.type === 'nft') return 1;
      return 0;
    });
  }, [nftHoldings, nativeBalances, tokenBalances]);

  // Calculate cash balance from stablecoin holdings (optimized single calculation)
  const cashBalance = useMemo(() => {
    return calculateCashBalance(holdings);
  }, [holdings]);

  // Calculate total portfolio value
  const totalValueUSD = useMemo(() => {
    return holdings.reduce((sum, h) => sum + (h.balanceUSD || 0), 0);
  }, [holdings]);

  // Combined loading state
  const isLoading = balancesLoading || tokensLoading || nftsLoading;

  // Unified refresh function
  const refresh = useCallback(async () => {
    // refreshAllBalances() refreshes both native and ERC20 tokens
    await Promise.all([
      refreshAllBalances(),
      refreshNFTs(),
    ]);
  }, [refreshAllBalances, refreshNFTs]);

  return {
    holdings,
    cashBalance,
    totalValueUSD,
    isLoading,
    error: null,
    refresh,
  };
}
