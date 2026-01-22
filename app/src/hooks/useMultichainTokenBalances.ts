import { useState, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import { getCommonTokens, isStablecoin } from '@/config/tokens';
import { getUniswapPrice, getCoinGeckoPrice } from './usePricingData';
import { getCachedProvider, executeBatchRpcCalls } from '@/utils/rpcOptimizer';
import { getTokenBalancesBatch } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

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

interface UseMultichainTokenBalancesReturn {
  tokens: MultichainTokenBalance[];
  totalValueUSD: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}


const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

/**
 * Hook to fetch ERC20 token balances across all supported networks
 * 
 * Fetches balances for common ERC20 tokens (USDC, USDT, DAI, WETH, etc.) across all configured chains.
 * Uses server API with Redis caching when available, falls back to direct RPC calls.
 * Automatically fetches token prices and calculates USD values.
 * 
 * @example
 * ```tsx
 * const { tokens, totalValueUSD, refresh } = useMultichainTokenBalances();
 * 
 * // Display tokens
 * tokens.forEach(token => {
 *   console.log(`${token.symbol} on ${token.chainName}: ${token.balance} ($${token.balanceUSD})`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `tokens`: Array of token balances across all chains
 * - `totalValueUSD`: Total USD value of all tokens
 * - `isLoading`: Whether data is currently loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all chains
 * - `refreshChain`: Function to refresh a specific chain
 */
export function useMultichainTokenBalances(): UseMultichainTokenBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [tokens, setTokens] = useState<MultichainTokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Get token price with fallback to CoinGecko
  const getTokenPrice = useCallback(async (symbol: string, address: string, provider: ethers.Provider, chainId: number): Promise<number> => {
    // Stablecoins are always $1 - check this FIRST before any API calls
    // Normalize symbol to uppercase for comparison
    const normalizedSymbol = symbol?.toUpperCase() || '';
    if (isStablecoin(normalizedSymbol)) {
      return 1.0;
    }
    
    // Try Uniswap first (primary source)
    try {
      const price = await getUniswapPrice(provider, address, chainId);
      if (price && price > 0 && isFinite(price)) return price;
    } catch (error) {
      // Continue to fallback
    }
    
    // Fallback to CoinGecko if Uniswap fails
    try {
      const price = await getCoinGeckoPrice(address, chainId);
      if (price && price > 0 && isFinite(price)) return price;
    } catch (error) {
      // Silent fallback - price will default to 0
    }
    
    return 0;
  }, []);

  // Fetch token balances for a specific chain
  const fetchChainTokens = useCallback(async (chainId: number): Promise<MultichainTokenBalance[]> => {
    if (!address) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    const tokenList = getCommonTokens(chainId);
    if (tokenList.length === 0) return [];

    try {
      // Try server API first (with Redis caching) - don't wait for health check
      // This is faster and more resilient - if server is down, API call will fail quickly
      try {
        const batchRequests = tokenList.map(tokenInfo => ({
          chainId,
          tokenAddress: tokenInfo.address,
          userAddress: address,
        }));

        const serverResults = await withTimeout(
          getTokenBalancesBatch(batchRequests),
          3000
        ) as Awaited<ReturnType<typeof getTokenBalancesBatch>> | null;
        
        if (serverResults && Array.isArray(serverResults) && serverResults.length > 0) {
          const provider = getCachedProvider(chainId);
          const tokenBalances: MultichainTokenBalance[] = [];

          // Process server results and get prices
          const tokenPromises = tokenList.map(async (tokenInfo, index) => {
            const serverResult = serverResults[index];
            if (!serverResult || !serverResult.data) {
              return null;
            }

            try {
              const { symbol, name, decimals, balance, balanceRaw } = serverResult.data;
              const balanceNum = parseFloat(balance);
              if (balanceNum === 0) return null;

              // Get token price - ensure stablecoins always get $1
              const normalizedSymbol = (symbol || tokenInfo.symbol || '').toUpperCase();
              let tokenPrice = await getTokenPrice(normalizedSymbol, tokenInfo.address, provider, chainId);
              
              // Double-check: if price is 0 but it's a stablecoin, force to $1
              if (tokenPrice === 0 && isStablecoin(normalizedSymbol)) {
                tokenPrice = 1.0;
              }
              
              const balanceUSD = balanceNum * tokenPrice;

              return {
                address: tokenInfo.address,
                symbol,
                name,
                decimals,
                balance,
                balanceRaw: BigInt(balanceRaw),
                balanceUSD,
                chainId,
                chainName: networkConfig.name,
                logoUrl: tokenInfo.logoUrl,
              } as MultichainTokenBalance;
            } catch (err) {
              return null;
            }
          });

          const results = await Promise.all(tokenPromises);
          results.forEach(result => {
            if (result !== null) {
              tokenBalances.push(result);
            }
          });

          return tokenBalances.sort((a, b) => b.balanceUSD - a.balanceUSD);
        }
        } catch (serverError) {
          // Server failed or timed out, fall through to direct RPC calls
          // Don't log - this is expected if server is unavailable
        }

      // Fallback to direct RPC calls if server is unavailable
      const provider = getCachedProvider(chainId);
      const tokenBalances: MultichainTokenBalance[] = [];

      // Batch fetch balances for all tokens at once (much more efficient)
      const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const balanceOfData = balanceOfInterface.encodeFunctionData('balanceOf', [address]);
      
      // Prepare batch calls for balances
      const balanceCalls = tokenList.map((tokenInfo, index) => ({
        method: 'eth_call',
        params: [{
          to: tokenInfo.address,
          data: balanceOfData
        }, 'latest'],
        id: index
      }));
      
      // Execute batch call
      const balanceResults = await executeBatchRpcCalls(chainId, balanceCalls, { useCache: true });
      
      // Process results - use contracts for metadata (simpler than batch decoding)
      const tokenPromises = tokenList.map(async (tokenInfo, index) => {
        try {
          const balanceHex = balanceResults[index];
          if (!balanceHex || balanceHex === '0x' || balanceHex === '0x0') {
            return null;
          }
          
          const balance = BigInt(balanceHex);
          if (balance === 0n) return null;
          
          // Use contract for metadata (cached provider, so still efficient)
          const contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, provider);
          
          const [symbol, name, decimals] = await Promise.all([
            contract.symbol().catch(() => tokenInfo.symbol),
            contract.name().catch(() => tokenInfo.name),
            contract.decimals().catch(() => tokenInfo.decimals),
          ]);
          
          const formattedBalance = ethers.formatUnits(balance, decimals);
          const balanceNum = parseFloat(formattedBalance);
          
          // Get token price - ensure stablecoins always get $1
          const normalizedSymbol = (symbol || tokenInfo.symbol || '').toUpperCase();
          let tokenPrice = await getTokenPrice(normalizedSymbol, tokenInfo.address, provider, chainId);
          
          // Double-check: if price is 0 but it's a stablecoin, force to $1
          if (tokenPrice === 0 && isStablecoin(normalizedSymbol)) {
            tokenPrice = 1.0;
          }
          
          const balanceUSD = balanceNum * tokenPrice;

          return {
            address: tokenInfo.address,
            symbol,
            name,
            decimals,
            balance: formattedBalance,
            balanceRaw: balance,
            balanceUSD,
            chainId,
            chainName: networkConfig.name,
            logoUrl: tokenInfo.logoUrl,
          } as MultichainTokenBalance;
        } catch (err) {
          // Silent error - skip this token
          return null;
        }
      });
      
      const results = await Promise.all(tokenPromises);
      results.forEach(result => {
        if (result !== null) {
          tokenBalances.push(result);
        }
      });

      return tokenBalances.sort((a, b) => b.balanceUSD - a.balanceUSD);
    } catch (err) {
      // Silent error - return empty array
      return [];
    }
  }, [address, getTokenPrice]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const chainTokens = await fetchChainTokens(chainId);
    setTokens(prev => {
      // Remove old tokens from this chain and add new ones
      const filtered = prev.filter(t => t.chainId !== chainId);
      return [...filtered, ...chainTokens];
    });
  }, [isConnected, address, fetchChainTokens]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setTokens([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use device-optimized fetching (sequential for mobile, parallel for desktop)
      const allTokens = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => await fetchChainTokens(network.chainId)
      );
      setTokens(allTokens);
    } catch (err) {
      // Silent error handling
      setError(err instanceof Error ? err.message : 'Failed to fetch token balances');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainTokens]);

  // Initial load
  // Note: Automatic refresh is now controlled by PortfolioContext
  // This hook only provides the refresh function - it does not auto-refresh

  // Calculate total value
  const totalValueUSD = useMemo(() => {
    return tokens.reduce((sum, t) => sum + (t.balanceUSD || 0), 0);
  }, [tokens]);

  return {
    tokens,
    totalValueUSD,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
