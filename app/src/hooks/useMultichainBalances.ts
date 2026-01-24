import { useMemo, useCallback, useState } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS, getNetworkByChainId } from '@/config/networks';
import { getCommonTokens } from '@/config/tokens';
import { isStablecoin } from '@/utils/tokenUtils';
import { getBalance, getBalancesBatch, getTokenBalancesBatch, getAllTokenBalances, getTokenPrice as getTokenPriceFromApi, getTokenPricesBatch } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';
import { getNativeTokenAddress } from './usePricingData';

/**
 * Native token balance for a specific chain
 */
export interface MultichainBalance {
  chainId: number;
  chainName: string;
  balance: string;
  balanceWei: bigint;
  balanceUSD: number;
  currencySymbol: string;
  currencyName: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * ERC20 token balance
 */
export interface MultichainTokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: bigint;
  balanceUSD: number;
  chainId: number;
  chainName: string;
  logoUrl?: string;
}

interface UseMultichainBalancesReturn {
  // Native token balances
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  
  // ERC20 token balances
  tokens: MultichainTokenBalance[];
  totalTokenValueUSD: number;
  
  // Combined totals
  totalValueUSD: number;
  
  // Loading and error states
  isLoading: boolean;
  balancesLoading: boolean;
  tokensLoading: boolean;
  error: string | null;
  
  // Refresh functions
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshTokens: () => Promise<void>;
}

/**
 * Unified hook to fetch both native token balances and ERC20 token balances across all supported networks
 * 
 * This hook consolidates the functionality of fetching both native cryptocurrency balances (ETH, BASE, etc.)
 * and ERC20 token balances (USDC, USDT, DAI, WETH, etc.) across all configured chains.
 * Uses server API with Redis caching for optimal performance.
 * 
 * @example
 * ```tsx
 * const { balances, tokens, totalValueUSD, refresh } = useMultichainBalances();
 * 
 * // Display native balances
 * balances.forEach(balance => {
 *   console.log(`${balance.chainName}: ${balance.balance} ${balance.currencySymbol}`);
 * });
 * 
 * // Display ERC20 tokens
 * tokens.forEach(token => {
 *   console.log(`${token.symbol} on ${token.chainName}: ${token.balance} ($${token.balanceUSD})`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `balances`: Array of native token balances, one per chain
 * - `tokens`: Array of ERC20 token balances across all chains
 * - `totalBalance`: Sum of all native balances as formatted string
 * - `totalBalanceUSD`: Total USD value of native balances
 * - `totalTokenValueUSD`: Total USD value of ERC20 tokens
 * - `totalValueUSD`: Combined total USD value of all balances
 * - `isLoading`: Whether any data is currently loading
 * - `balancesLoading`: Whether native balances are loading
 * - `tokensLoading`: Whether ERC20 tokens are loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all data
 * - `refreshChain`: Function to refresh a specific chain
 * - `refreshBalances`: Function to refresh only native balances
 * - `refreshTokens`: Function to refresh only ERC20 tokens
 */
export function useMultichainBalances(): UseMultichainBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [balances, setBalances] = useState<MultichainBalance[]>([]);
  const [tokens, setTokens] = useState<MultichainTokenBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Get token price from server API
   */
  const getTokenPrice = useCallback(async (symbol: string, address: string, chainId: number): Promise<number> => {
    // Stablecoins are always $1 - check this FIRST before any API calls
    const normalizedSymbol = symbol?.toUpperCase() || '';
    if (isStablecoin(normalizedSymbol)) {
      return 1.0;
    }
    
    // Use server API for all pricing
    const priceData = await getTokenPriceFromApi(chainId, address);
    if (priceData && priceData.price > 0 && isFinite(priceData.price)) {
      return priceData.price;
    }
    
    if (import.meta.env.PROD && (!priceData || !priceData.price)) {
      console.error(`[useMultichainBalances] Server API returned no price for token ${address} on chain ${chainId}`);
    }
    
    return 0;
  }, []);

  /**
   * Fetch native balance for a specific chain
   */
  const fetchChainBalance = useCallback(async (chainId: number): Promise<MultichainBalance> => {
    if (!address) {
      throw new Error('No address available');
    }

    const networkConfig = getNetworkByChainId(chainId);
    if (!networkConfig) {
      throw new Error(`Network ${chainId} not supported`);
    }

    try {
      // Single balance requests are faster, but still need reasonable timeout
      const serverBalance = await withTimeout(
        getBalance(chainId, address),
        10000
      ) as Awaited<ReturnType<typeof getBalance>> | null;
      
      if (!serverBalance || !serverBalance.balance) {
        throw new Error(`Server API returned no balance data for chain ${chainId}`);
      }

      const balanceWei = BigInt(serverBalance.balanceWei);
      
      // Get native token price using wrapped token address
      const nativeTokenAddress = getNativeTokenAddress(chainId);
      
      let price = 0;
      if (nativeTokenAddress) {
        // For xDAI (Gnosis), default to $1 (it's a stablecoin)
        if (chainId === 100) {
          price = 1.0;
        } else {
          const priceData = await getTokenPriceFromApi(chainId, nativeTokenAddress);
          price = (priceData?.price && isFinite(priceData.price) && priceData.price > 0) ? priceData.price : 0;
        }
      }
      
      const balanceUSD = parseFloat(serverBalance.balance) * price;
      
      return {
        chainId,
        chainName: networkConfig.name,
        balance: serverBalance.balance,
        balanceWei,
        balanceUSD,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: null,
      };
    } catch (err) {
      const errorMessage = err instanceof Error 
        ? `Server API error: ${err.message}` 
        : 'Failed to fetch balance from server';
      
      if (import.meta.env.PROD) {
        console.error(`[useMultichainBalances] Server API failed for chain ${chainId}:`, errorMessage);
      }
      
      return {
        chainId,
        chainName: networkConfig.name,
        balance: '0.00',
        balanceWei: 0n,
        balanceUSD: 0,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: errorMessage,
      };
    }
  }, [address]);

  /**
   * Fetch ERC20 token balances for a specific chain
   * Uses Alchemy's getAllTokenBalances API to get ALL tokens, with fallback to COMMON_TOKENS
   */
  const fetchChainTokens = useCallback(async (chainId: number): Promise<MultichainTokenBalance[]> => {
    if (!address) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    try {
      // First, try to get ALL tokens using Alchemy API
      const allTokens = await withTimeout(
        getAllTokenBalances(chainId, address),
        30000 // 30 second timeout
      ) as Awaited<ReturnType<typeof getAllTokenBalances>> | null;

      let tokensToProcess: Array<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceRaw: string }> = [];

      if (allTokens && allTokens.length > 0) {
        // Use Alchemy API results (ALL tokens)
        tokensToProcess = allTokens;
      } else {
        // Fallback to COMMON_TOKENS approach if Alchemy API is not available
        const tokenList = getCommonTokens(chainId);
        if (tokenList.length === 0) return [];

        const batchRequests = tokenList.map(tokenInfo => ({
          chainId,
          tokenAddress: tokenInfo.address,
          userAddress: address,
        }));

        const serverResults = await withTimeout(
          getTokenBalancesBatch(batchRequests),
          15000
        ) as Awaited<ReturnType<typeof getTokenBalancesBatch>> | null;
        
        if (!serverResults || !Array.isArray(serverResults) || serverResults.length === 0) {
          return [];
        }

        // Convert to same format as Alchemy API results
        tokensToProcess = serverResults
          .map((result, index) => {
            if (result.data) {
              return {
                address: tokenList[index].address,
                symbol: result.data.symbol,
                name: result.data.name,
                decimals: result.data.decimals,
                balance: result.data.balance,
                balanceRaw: result.data.balanceRaw,
              };
            }
            return null;
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);
      }

      if (tokensToProcess.length === 0) {
        return [];
      }

      // Get COMMON_TOKENS for metadata (logoUrl) and to prioritize known tokens
      const commonTokens = getCommonTokens(chainId);
      const commonTokensMap = new Map(
        commonTokens.map(t => [t.address.toLowerCase(), t])
      );

      const tokenBalances: MultichainTokenBalance[] = [];

      // Prepare tokens with metadata
      const tokensWithMetadata = tokensToProcess
        .map(tokenData => {
          const balanceNum = parseFloat(tokenData.balance);
          if (balanceNum === 0) return null;

          // Get metadata from COMMON_TOKENS if available
          const commonToken = commonTokensMap.get(tokenData.address.toLowerCase());
          const symbol = tokenData.symbol || commonToken?.symbol || 'UNKNOWN';
          const name = tokenData.name || commonToken?.name || 'Unknown Token';
          const logoUrl = commonToken?.logoUrl;

          return {
            tokenData,
            symbol,
            name,
            logoUrl,
            balanceNum,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);

      if (tokensWithMetadata.length === 0) {
        return [];
      }

      // Batch fetch prices for all tokens at once (much more efficient!)
      const priceRequests = tokensWithMetadata.map(({ tokenData }) => ({
        chainId,
        tokenAddress: tokenData.address,
      }));

      let prices: Map<string, number> = new Map();
      try {
        const priceResults = await getTokenPricesBatch(priceRequests);
        priceResults.forEach((result, index) => {
          const { tokenData, symbol } = tokensWithMetadata[index];
          const normalizedSymbol = symbol.toUpperCase();
          const tokenAddressLower = tokenData.address.toLowerCase();
          
          // Handle stablecoins first (always $1)
          if (isStablecoin(normalizedSymbol)) {
            prices.set(tokenAddressLower, 1.0);
          } else if (result.price && result.price > 0 && isFinite(result.price)) {
            prices.set(tokenAddressLower, result.price);
          }
        });
      } catch (err) {
        // If batch pricing fails, fall back to individual calls (but this shouldn't happen)
        console.warn(`[useMultichainBalances] Batch pricing failed for chain ${chainId}, falling back to individual calls`);
      }

      // Process tokens with prices
      for (const { tokenData, symbol, name, logoUrl, balanceNum } of tokensWithMetadata) {
        try {
          const normalizedSymbol = symbol.toUpperCase();
          
          // Get price from batch results or fallback to individual call
          let tokenPrice = prices.get(tokenData.address.toLowerCase());
          
          if (tokenPrice === undefined) {
            // Fallback to individual price call (should be rare)
            tokenPrice = await getTokenPrice(normalizedSymbol, tokenData.address, chainId);
          }
          
          // Force stablecoins to $1 if price is missing or 0
          if (isStablecoin(normalizedSymbol)) {
            if (!tokenPrice || tokenPrice === 0 || !isFinite(tokenPrice)) {
              tokenPrice = 1.0;
            }
          }
          
          const balanceUSD = balanceNum * (tokenPrice || 0);

          tokenBalances.push({
            address: tokenData.address,
            symbol,
            name,
            decimals: tokenData.decimals,
            balance: tokenData.balance,
            balanceRaw: BigInt(tokenData.balanceRaw),
            balanceUSD,
            chainId,
            chainName: networkConfig.name,
            logoUrl,
          });
        } catch (err) {
          if (import.meta.env.PROD) {
            console.error(`[useMultichainBalances] Error processing token ${tokenData.address}:`, err);
          }
        }
      }

      // Sort by USD value (descending), with known tokens (from COMMON_TOKENS) prioritized
      return tokenBalances.sort((a, b) => {
        const aIsKnown = commonTokensMap.has(a.address.toLowerCase());
        const bIsKnown = commonTokensMap.has(b.address.toLowerCase());
        
        // Known tokens first, then by USD value
        if (aIsKnown && !bIsKnown) return -1;
        if (!aIsKnown && bIsKnown) return 1;
        return b.balanceUSD - a.balanceUSD;
      });
    } catch (err) {
      if (import.meta.env.PROD) {
        console.error(`[useMultichainBalances] Server API failed for chain ${chainId}:`, err);
        // Don't throw - return empty array to allow other chains to continue
      }
      return [];
    }
  }, [address, getTokenPrice]);

  /**
   * Refresh native balances for all chains
   */
  const refreshBalances = useCallback(async () => {
    if (!isConnected || !address) {
      setBalances([]);
      setBalancesLoading(false);
      return;
    }

    setBalancesLoading(true);
    setError(null);

    setBalances(prev => {
      if (prev.length > 0) {
        return prev.map(b => ({ ...b, isLoading: true }));
      }
      return SUPPORTED_NETWORKS.map(network => ({
        chainId: network.chainId,
        chainName: network.name,
        balance: '0.00',
        balanceWei: 0n,
        balanceUSD: 0,
        currencySymbol: network.nativeCurrency.symbol,
        currencyName: network.nativeCurrency.name,
        isLoading: true,
        error: null,
      }));
    });

    try {
      // Try batch API first
      try {
        const batchRequests = SUPPORTED_NETWORKS.map(network => ({
          chainId: network.chainId,
          address: address,
        }));
        
        // Increased timeout for batch requests (15 seconds) - batch operations take longer
        const batchResults = await withTimeout(
          getBalancesBatch(batchRequests),
          15000
        ) as Awaited<ReturnType<typeof getBalancesBatch>> | null;
        
        if (batchResults && Array.isArray(batchResults) && batchResults.length > 0) {
          // Prepare price requests for all native tokens
          const priceRequests = SUPPORTED_NETWORKS.map(network => {
            const nativeTokenAddress = getNativeTokenAddress(network.chainId);
            return {
              chainId: network.chainId,
              tokenAddress: nativeTokenAddress || '',
            };
          }).filter(req => req.tokenAddress);
          
          // Fetch prices in batch
          const priceResults = priceRequests.length > 0 
            ? await getTokenPricesBatch(priceRequests)
            : [];
          
          // Create a map of chainId -> price
          const priceMap = new Map<number, number>();
          priceResults.forEach((result) => {
            if (result && result.price && result.price > 0 && isFinite(result.price)) {
              priceMap.set(result.chainId, result.price);
            }
          });
          
          // For xDAI (Gnosis), always use $1
          if (priceMap.has(100)) {
            priceMap.set(100, 1.0);
          }
          
          const results: MultichainBalance[] = batchResults.map((result, index) => {
            const network = SUPPORTED_NETWORKS[index];
            if (result.balance && result.balanceWei) {
              const balanceWei = BigInt(result.balanceWei);
              let price = priceMap.get(result.chainId) || 0;
              
              if (result.chainId === 100 && price === 0) {
                price = 1.0;
              }
              
              const balanceUSD = parseFloat(result.balance) * price;
              return {
                chainId: result.chainId,
                chainName: network.name,
                balance: result.balance,
                balanceWei,
                balanceUSD,
                currencySymbol: network.nativeCurrency.symbol,
                currencyName: network.nativeCurrency.name,
                isLoading: false,
                error: result.error || null,
              };
            } else {
              return {
                chainId: result.chainId,
                chainName: network.name,
                balance: '0.00',
                balanceWei: 0n,
                balanceUSD: 0,
                currencySymbol: network.nativeCurrency.symbol,
                currencyName: network.nativeCurrency.name,
                isLoading: false,
                error: result.error || 'Failed to fetch balance',
              };
            }
          });
          
          setBalances(results);
          setBalancesLoading(false);
          return;
        }
      } catch (batchError) {
        if (import.meta.env.PROD) {
          console.error('[useMultichainBalances] Batch API failed:', batchError);
          throw new Error('Server API batch endpoint failed - server is required in production');
        }
      }

      // Fallback to individual fetches (dev only)
      const results = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => {
          try {
            const balance = await fetchChainBalance(network.chainId);
            return [balance];
          } catch (err) {
            const networkConfig = getNetworkByChainId(network.chainId);
            return [{
              chainId: network.chainId,
              chainName: networkConfig?.name || `Chain ${network.chainId}`,
              balance: '0.00',
              balanceWei: 0n,
              balanceUSD: 0,
              currencySymbol: networkConfig?.nativeCurrency.symbol || 'ETH',
              currencyName: networkConfig?.nativeCurrency.name || 'Ether',
              isLoading: false,
              error: err instanceof Error ? err.message : 'Failed to fetch from server',
            }];
          }
        }
      );

      setBalances(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setBalancesLoading(false);
    }
  }, [isConnected, address, fetchChainBalance]);

  /**
   * Refresh ERC20 tokens for all chains
   */
  const refreshTokens = useCallback(async () => {
    if (!isConnected || !address) {
      setTokens([]);
      setTokensLoading(false);
      return;
    }

    setTokensLoading(true);
    setError(null);

    // Capture previous tokens to preserve during refresh
    let previousTokens: MultichainTokenBalance[] = [];
    setTokens(prev => {
      previousTokens = prev;
      // Keep previous tokens visible while loading (don't clear them)
      return prev;
    });

    try {
      const allTokens = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => await fetchChainTokens(network.chainId)
      );
      // Only update with new data - this prevents clearing to empty array during refresh
      setTokens(allTokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch token balances');
      // On error, restore previous tokens to prevent UI from showing empty state
      if (previousTokens.length > 0) {
        setTokens(previousTokens);
      }
    } finally {
      setTokensLoading(false);
    }
  }, [isConnected, address, fetchChainTokens]);

  /**
   * Refresh a specific chain (both native and ERC20)
   */
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const [chainBalance, chainTokens] = await Promise.all([
      fetchChainBalance(chainId),
      fetchChainTokens(chainId),
    ]);

    setBalances(prev => {
      const updated = [...prev];
      const index = updated.findIndex(b => b.chainId === chainId);
      if (index >= 0) {
        updated[index] = chainBalance;
      } else {
        updated.push(chainBalance);
      }
      return updated;
    });

    setTokens(prev => {
      const filtered = prev.filter(t => t.chainId !== chainId);
      return [...filtered, ...chainTokens];
    });
  }, [isConnected, address, fetchChainBalance, fetchChainTokens]);

  /**
   * Refresh all data (both native and ERC20)
   */
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshBalances(),
      refreshTokens(),
    ]);
  }, [refreshBalances, refreshTokens]);

  // Calculate totals
  const totalBalance = useMemo(() => {
    const total = balances.reduce((sum, b) => sum + parseFloat(b.balance || '0'), 0);
    return total.toFixed(4);
  }, [balances]);

  const totalBalanceUSD = useMemo(() => {
    return balances.reduce((sum, b) => sum + (b.balanceUSD || 0), 0);
  }, [balances]);

  const totalTokenValueUSD = useMemo(() => {
    return tokens.reduce((sum, t) => sum + (t.balanceUSD || 0), 0);
  }, [tokens]);

  const totalValueUSD = useMemo(() => {
    return totalBalanceUSD + totalTokenValueUSD;
  }, [totalBalanceUSD, totalTokenValueUSD]);

  const isLoading = balancesLoading || tokensLoading;

  return {
    balances,
    totalBalance,
    totalBalanceUSD,
    tokens,
    totalTokenValueUSD,
    totalValueUSD,
    isLoading,
    balancesLoading,
    tokensLoading,
    error,
    refresh,
    refreshChain,
    refreshBalances,
    refreshTokens,
  };
}
