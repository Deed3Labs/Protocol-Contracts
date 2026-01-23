import { useMemo, useCallback } from 'react';
import { useMultichainBalances } from './useMultichainBalances';
import { useMultichainDeedNFTs } from './useMultichainDeedNFTs';
import { useGeneralNFTs } from './useGeneralNFTs';
import { calculateCashBalance } from '@/utils/tokenUtils';

export interface UnifiedHolding {
  id: string;
  type: 'nft' | 'rwa' | 'token'; // 'rwa' for T-Deeds (Real World Assets), 'nft' for general NFTs
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
 * Optional configuration for general NFT contracts to fetch
 * Format: Array of { chainId, contractAddress }
 * 
 * @example
 * const generalNFTContracts = [
 *   { chainId: 84532, contractAddress: '0x1234...' },
 *   { chainId: 1, contractAddress: '0x5678...' }
 * ];
 */
export interface GeneralNFTContractConfig {
  chainId: number;
  contractAddress: string;
}

/**
 * Unified hook to fetch all portfolio holdings (tokens + NFTs) and calculate cash balance
 * 
 * This hook optimizes the fetching process by:
 * - Using existing optimized hooks (which already use server API with batching)
 * - Calculating cash balance once from all holdings
 * - Providing a single source of truth for portfolio data
 * 
 * @param generalNFTContracts - Optional array of general NFT contracts to fetch.
 *                               If not provided, only T-Deeds (RWAs) will be fetched.
 * 
 * @example
 * ```tsx
 * // Basic usage (only T-Deeds)
 * const { holdings, cashBalance, totalValueUSD, refresh } = usePortfolioHoldings();
 * 
 * // With general NFTs
 * const { holdings } = usePortfolioHoldings([
 *   { chainId: 84532, contractAddress: '0x1234...' },
 *   { chainId: 1, contractAddress: '0x5678...' }
 * ]);
 * 
 * // Cash balance is automatically calculated from stablecoin holdings
 * console.log(`Cash: $${cashBalance.totalCash}`);
 * console.log(`USDC: $${cashBalance.usdcBalance}`);
 * ```
 */
export function usePortfolioHoldings(
  generalNFTContracts: GeneralNFTContractConfig[] = []
): PortfolioHoldings {
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

  // Fetch general NFTs if contracts are provided
  const {
    nfts: generalNFTs,
    isLoading: generalNFTsLoading,
    refresh: refreshGeneralNFTs,
  } = useGeneralNFTs(generalNFTContracts);

  // Combine all holdings into unified format
  const holdings = useMemo<UnifiedHolding[]>(() => {
    const allHoldings: UnifiedHolding[] = [];
    
    // Add T-Deeds (RWAs - Real World Assets)
    // These are protocol-controlled DeedNFT contracts
    nftHoldings.forEach((nft) => {
      // Calculate USD value from priceUSD if available
      const priceUSD = (nft as any).priceUSD || 0;
      const balanceUSD = priceUSD; // For NFTs, priceUSD is the value per NFT
      
      allHoldings.push({
        ...nft, // Include all NFT properties first
        id: `${nft.chainId}-rwa-${nft.tokenId}`,
        type: 'rwa' as const, // Mark as RWA (T-Deed) not general NFT
        asset_name: nft.definition || `T-Deed #${nft.tokenId}`,
        asset_symbol: 'T-Deed',
        balanceUSD, // Use priceUSD if available
        // Override with explicit values to ensure consistency
        chainId: nft.chainId,
        chainName: nft.chainName,
        tokenId: nft.tokenId,
        isRWA: true, // Flag to identify T-Deeds
      });
    });

    // Add general NFTs (ERC721/ERC1155)
    generalNFTs.forEach((nft) => {
      // Calculate USD value from priceUSD if available
      const priceUSD = nft.priceUSD || 0;
      const amount = parseFloat(nft.amount || '1');
      const balanceUSD = priceUSD * amount; // For ERC1155, multiply by amount
      
      allHoldings.push({
        ...nft, // Include all NFT properties
        id: `${nft.chainId}-nft-${nft.contractAddress}-${nft.tokenId}`,
        type: 'nft' as const, // Mark as general NFT
        asset_name: nft.name || `NFT #${nft.tokenId}`,
        asset_symbol: nft.symbol || 'NFT',
        balanceUSD,
        chainId: nft.chainId,
        chainName: nft.chainName,
        tokenId: nft.tokenId,
        contractAddress: nft.contractAddress,
        standard: nft.standard,
        amount: nft.amount,
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
    
    // Sort by USD value (descending), then by type (RWAs first, then NFTs, then tokens)
    return allHoldings.sort((a, b) => {
      if (b.balanceUSD !== a.balanceUSD) {
        return b.balanceUSD - a.balanceUSD;
      }
      // Priority: RWAs > NFTs > Tokens
      const typePriority = { rwa: 3, nft: 2, token: 1 };
      const aPriority = typePriority[a.type] || 0;
      const bPriority = typePriority[b.type] || 0;
      return bPriority - aPriority;
    });
  }, [nftHoldings, generalNFTs, nativeBalances, tokenBalances]);

  // Calculate cash balance from stablecoin holdings (optimized single calculation)
  const cashBalance = useMemo(() => {
    return calculateCashBalance(holdings);
  }, [holdings]);

  // Calculate total portfolio value
  const totalValueUSD = useMemo(() => {
    return holdings.reduce((sum, h) => sum + (h.balanceUSD || 0), 0);
  }, [holdings]);

  // Combined loading state
  const isLoading = balancesLoading || tokensLoading || nftsLoading || generalNFTsLoading;

  // Unified refresh function
  const refresh = useCallback(async () => {
    // refreshAllBalances() refreshes both native and ERC20 tokens
    const refreshPromises = [
      refreshAllBalances(),
      refreshNFTs(),
    ];
    
    // Only refresh general NFTs if contracts are provided
    if (generalNFTContracts.length > 0) {
      refreshPromises.push(refreshGeneralNFTs());
    }
    
    await Promise.all(refreshPromises);
  }, [refreshAllBalances, refreshNFTs, refreshGeneralNFTs, generalNFTContracts.length]);

  return {
    holdings,
    cashBalance,
    totalValueUSD,
    isLoading,
    error: null,
    refresh,
  };
}
