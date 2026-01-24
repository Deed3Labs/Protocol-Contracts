import { useMemo, useCallback } from 'react';
import { useMultichainBalances } from './useMultichainBalances';
import { useMultichainDeedNFTs } from './useMultichainDeedNFTs';
import { useGeneralNFTs } from './useGeneralNFTs';
import { calculateCashBalance } from '@/utils/tokenUtils';
import { getAllNFTContracts } from '@/config/nfts';
import { SUPPORTED_NETWORKS, getContractAddressForNetwork } from '@/config/networks';
import { ethers } from 'ethers';

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
 * @deprecated Use NFT_CONTRACTS from @/config/nfts instead
 * This interface is kept for backward compatibility
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
 * - Automatically fetches NFTs from NFT_CONTRACTS config (RWA, Collectible, General)
 * 
 * @param generalNFTContracts - Optional array of additional NFT contracts to fetch.
 *                               If not provided, uses NFT_CONTRACTS from config.
 *                               This parameter is for backward compatibility and custom contracts.
 * 
 * @example
 * ```tsx
 * // Basic usage (uses NFT_CONTRACTS from config automatically)
 * const { holdings, cashBalance, totalValueUSD, refresh } = usePortfolioHoldings();
 * 
 * // With additional custom NFT contracts
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
  // Get NFT contracts from config (includes RWA, Collectible, and General NFTs)
  const configNFTContracts = getAllNFTContracts();
  
  // Get T-Deed contract addresses to exclude them from general NFT fetching
  // (T-Deeds are fetched separately via useMultichainDeedNFTs)
  const tDeedContracts = new Set<string>();
  SUPPORTED_NETWORKS.forEach(network => {
    const tDeedAddress = getContractAddressForNetwork(network.chainId);
    if (tDeedAddress && tDeedAddress !== '0x0000000000000000000000000000000000000000') {
      tDeedContracts.add(tDeedAddress.toLowerCase());
    }
  });
  
  // Combine config NFTs with user-provided contracts
  // Filter out T-Deed contracts (they're handled by useMultichainDeedNFTs)
  // Convert config NFTs to GeneralNFTContractConfig format
  const allNFTContracts: GeneralNFTContractConfig[] = [
    ...configNFTContracts
      .filter(nft => {
        // Exclude T-Deed contracts - they're fetched via useMultichainDeedNFTs
        const isTDeed = tDeedContracts.has(nft.address.toLowerCase());
        return !isTDeed;
      })
      .map(nft => ({
        chainId: nft.chainId,
        contractAddress: nft.address,
      })),
    ...generalNFTContracts,
  ];
  
  // Remove duplicates (same chainId + contractAddress)
  const uniqueNFTContracts = allNFTContracts.filter((contract, index, self) =>
    index === self.findIndex(c => 
      c.chainId === contract.chainId && 
      c.contractAddress.toLowerCase() === contract.contractAddress.toLowerCase()
    )
  );
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

  // Fetch all NFTs (from config + user-provided contracts)
  const {
    nfts: generalNFTs,
    isLoading: generalNFTsLoading,
    refresh: refreshGeneralNFTs,
  } = useGeneralNFTs(uniqueNFTContracts);

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

    // Add general NFTs (ERC721/ERC1155) - categorized by type from config
    generalNFTs.forEach((nft) => {
      // Get contract address from Portfolio API format
      const contractAddress = nft.contractAddress || nft.contract?.address || '';
      
      // Find the NFT config to determine type (rwa, collectible, general)
      const nftConfig = configNFTContracts.find(
        config => config.chainId === nft.chainId && 
        config.address.toLowerCase() === contractAddress.toLowerCase()
      );
      
      // Determine type: if it's in config as 'rwa', use 'rwa', otherwise use 'nft'
      // Note: T-Deeds are already handled above, so config RWAs are separate protocol RWAs
      const nftType = nftConfig?.type === 'rwa' ? 'rwa' : 
                     nftConfig?.type === 'collectible' ? 'nft' : 
                     'nft';
      
      // Calculate USD value from priceUSD if available (from Portfolio API openseaMetadata)
      const priceUSD = nft.priceUSD || nft.contract?.openseaMetadata?.floorPrice || 0;
      const amount = parseFloat(nft.amount || '1');
      const balanceUSD = priceUSD * amount; // For ERC1155, multiply by amount
      
      allHoldings.push({
        ...nft, // Include all NFT properties (Portfolio API format)
        id: `${nft.chainId}-nft-${contractAddress}-${nft.tokenId}`,
        type: nftType as 'nft' | 'rwa', // Use type from config
        asset_name: nft.name || nft.raw?.metadata?.name || nftConfig?.name || `NFT #${nft.tokenId}`,
        asset_symbol: nft.symbol || nft.contract?.symbol || nftConfig?.symbol || 'NFT',
        balanceUSD,
        chainId: nft.chainId,
        chainName: nft.chainName,
        tokenId: nft.tokenId,
        contractAddress,
        standard: nft.standard || (nft.contract?.tokenType === 'ERC1155' ? 'ERC1155' : 'ERC721'),
        amount: nft.amount,
        // Add metadata from config if available
        ...(nftConfig && {
          nftType: nftConfig.type, // 'rwa' | 'collectible' | 'general'
          nftDescription: nftConfig.description,
        }),
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
    
    // Add ERC20 tokens (Portfolio API format)
    tokenBalances.forEach((token) => {
      // Get token address from Portfolio API format
      const tokenAddress = token.tokenAddress || token.address || '';
      const balance = token.balance || (token.tokenBalance ? ethers.formatUnits(BigInt(token.tokenBalance), token.decimals || token.tokenMetadata?.decimals || 18) : '0');
      const balanceUSD = token.balanceUSD || (() => {
        // Calculate from Portfolio API prices if available
        if (token.tokenPrices && token.tokenPrices.length > 0) {
          const usdPrice = token.tokenPrices.find(p => p.currency === 'USD') || token.tokenPrices[0];
          if (usdPrice && usdPrice.value) {
            return parseFloat(balance) * parseFloat(usdPrice.value);
          }
        }
        return 0;
      })();
      
      allHoldings.push({
        ...token, // Include all token properties (Portfolio API format)
        id: `${token.chainId}-token-${tokenAddress}`,
        type: 'token',
        asset_name: token.name || token.tokenMetadata?.name || 'Unknown Token',
        asset_symbol: token.symbol || token.tokenMetadata?.symbol || 'UNKNOWN',
        balanceUSD,
        chainId: token.chainId,
        chainName: token.chainName,
        balance,
        address: tokenAddress,
        decimals: token.decimals || token.tokenMetadata?.decimals || 18,
        balanceRaw: token.balanceRaw || (token.tokenBalance ? BigInt(token.tokenBalance) : 0n),
        logoUrl: token.logoUrl || token.tokenMetadata?.logo,
      });
    });
    
    // Sort by USD value (descending), then by type (Tokens first, then RWAs, then NFTs)
    return allHoldings.sort((a, b) => {
      if (b.balanceUSD !== a.balanceUSD) {
        return b.balanceUSD - a.balanceUSD;
      }
      // Priority: Tokens > RWAs > NFTs
      const typePriority = { token: 3, rwa: 2, nft: 1 };
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
    
    // Refresh general NFTs if we have contracts (from config or user-provided)
    if (uniqueNFTContracts.length > 0) {
      refreshPromises.push(refreshGeneralNFTs());
    }
    
    await Promise.all(refreshPromises);
  }, [refreshAllBalances, refreshNFTs, refreshGeneralNFTs, uniqueNFTContracts.length]);

  return {
    holdings,
    cashBalance,
    totalValueUSD,
    isLoading,
    error: null,
    refresh,
  };
}
