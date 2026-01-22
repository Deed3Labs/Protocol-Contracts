import { useMemo, useCallback, useState } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getNetworkByChainId } from '@/config/networks';
import { usePricingData } from './usePricingData';
import { getBalanceOptimized } from '@/utils/rpcOptimizer';
import { getBalance, getBalancesBatch } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

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

interface UseMultichainBalancesReturn {
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

/**
 * Hook to fetch native token balances across all supported networks
 * 
 * Fetches native cryptocurrency balances (ETH, BASE, etc.) for all configured chains.
 * Uses server API with Redis caching when available, falls back to direct RPC calls.
 * Optimizes for mobile (sequential) vs desktop (parallel) fetching.
 * 
 * @example
 * ```tsx
 * const { balances, totalBalanceUSD, refresh } = useMultichainBalances();
 * 
 * // Display balances
 * balances.forEach(balance => {
 *   console.log(`${balance.chainName}: ${balance.balance} ${balance.currencySymbol}`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `balances`: Array of balance objects, one per chain
 * - `totalBalance`: Sum of all native balances as formatted string
 * - `totalBalanceUSD`: Total USD value of all balances
 * - `isLoading`: Whether data is currently loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all chains
 * - `refreshChain`: Function to refresh a specific chain
 */
export function useMultichainBalances(): UseMultichainBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [balances, setBalances] = useState<MultichainBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Get native token prices for each chain
  // Different chains have different native tokens (ETH, MATIC, xDAI)
  // We'll fetch prices per-chain when needed
  const { price: defaultEthPrice } = usePricingData(); // Fallback ETH price

  /**
   * Fetch balance for a specific chain
   * Tries server API first, falls back to direct RPC call
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
      // Try server API first (with Redis caching)
      try {
        const serverBalance = await withTimeout(
          getBalance(chainId, address),
          3000
        ) as Awaited<ReturnType<typeof getBalance>> | null;
        
        if (serverBalance && serverBalance.balance) {
          const balanceWei = BigInt(serverBalance.balanceWei);
          
          // Get native token price for this chain
          const { getNativeTokenPrice } = await import('./usePricingData');
          const nativePrice = await getNativeTokenPrice(chainId);
          const price = nativePrice || defaultEthPrice || 0;
          
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
        }
      } catch (serverError) {
        // Server failed or timed out, fall through to direct RPC call
      }

      // Fallback to direct RPC call if server is unavailable
      const balanceWei = await getBalanceOptimized(chainId, address, true);
      const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);
      
      // Get native token price for this chain
      const { getNativeTokenPrice } = await import('./usePricingData');
      const nativePrice = await getNativeTokenPrice(chainId);
      const price = nativePrice || defaultEthPrice || 0;
      
      const balanceUSD = parseFloat(balance) * price;

      return {
        chainId,
        chainName: networkConfig.name,
        balance,
        balanceWei,
        balanceUSD,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: null,
      };
    } catch (err) {
      // Silent error handling - return zero balance without logging
      return {
        chainId,
        chainName: networkConfig.name,
        balance: '0.00',
        balanceWei: 0n,
        balanceUSD: 0,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch balance',
      };
    }
  }, [address, defaultEthPrice]);

  /**
   * Refresh a specific chain
   */
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    setBalances(prev => {
      const updated = [...prev];
      const index = updated.findIndex(b => b.chainId === chainId);
      if (index >= 0) {
        updated[index] = { ...updated[index], isLoading: true, error: null };
      }
      return updated;
    });

    try {
      const balance = await fetchChainBalance(chainId);
      setBalances(prev => {
        const updated = [...prev];
        const index = updated.findIndex(b => b.chainId === chainId);
        if (index >= 0) {
          updated[index] = balance;
        } else {
          updated.push(balance);
        }
        return updated;
      });
    } catch (err) {
      setBalances(prev => {
        const updated = [...prev];
        const index = updated.findIndex(b => b.chainId === chainId);
        if (index >= 0) {
          updated[index] = {
            ...updated[index],
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to fetch balance',
          };
        }
        return updated;
      });
    }
  }, [isConnected, address, fetchChainBalance]);

  /**
   * Refresh all chains
   * Tries batch API first for efficiency, falls back to individual fetches
   */
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setBalances([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Don't reset balances to 0 during refresh - keep existing balances and mark as loading
    setBalances(prev => {
      if (prev.length > 0) {
        return prev.map(b => ({ ...b, isLoading: true }));
      }
      // Only initialize to 0 if we don't have any balances yet (first load)
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
      // Try batch API first (more efficient)
      try {
        const batchRequests = SUPPORTED_NETWORKS.map(network => ({
          chainId: network.chainId,
          address: address,
        }));
        
        const batchResults = await withTimeout(
          getBalancesBatch(batchRequests),
          3000
        ) as Awaited<ReturnType<typeof getBalancesBatch>> | null;
        
        if (batchResults && Array.isArray(batchResults) && batchResults.length > 0) {
          // Convert batch results to MultichainBalance format
          // Fetch native token prices for all chains in parallel
          const { getNativeTokenPrice } = await import('./usePricingData');
          const pricePromises = SUPPORTED_NETWORKS.map(network => 
            getNativeTokenPrice(network.chainId)
          );
          const nativePrices = await Promise.all(pricePromises);
          
          const results: MultichainBalance[] = batchResults.map((result, index) => {
            const network = SUPPORTED_NETWORKS[index];
            if (result.balance && result.balanceWei) {
              const balanceWei = BigInt(result.balanceWei);
              
              // Use native token price for this chain, fallback to default ETH price
              // Find the correct price by matching chainId (not index, in case order differs)
              const networkIndex = SUPPORTED_NETWORKS.findIndex(n => n.chainId === result.chainId);
              const nativePrice = networkIndex >= 0 ? nativePrices[networkIndex] : null;
              const price = nativePrice || defaultEthPrice || 0;
              
              // Debug: Log price calculation in development
              if (import.meta.env.DEV && parseFloat(result.balance) > 0) {
                console.log(`[useMultichainBalances] Chain ${result.chainId} (${network.name}):`, {
                  balance: result.balance,
                  nativePrice,
                  defaultEthPrice,
                  finalPrice: price,
                  balanceUSD: parseFloat(result.balance) * price
                });
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
          
          // For any failed batch results, try individual fetch
          const failedIndices = batchResults
            .map((result, index) => (!result.balance || result.error ? index : -1))
            .filter(index => index !== -1);
          
          if (failedIndices.length > 0) {
            const individualPromises = failedIndices.map(async (index) => {
              const network = SUPPORTED_NETWORKS[index];
              try {
                return await fetchChainBalance(network.chainId);
              } catch (err) {
                return results[index]; // Keep the error result
              }
            });
            
            const individualResults = await Promise.all(individualPromises);
            failedIndices.forEach((originalIndex, i) => {
              results[originalIndex] = individualResults[i];
            });
          }
          
          setBalances(results);
          setIsLoading(false);
          return;
        }
      } catch (batchError) {
        // Batch API failed or timed out, fall through to individual fetches
      }

      // Fallback to individual fetches
      // Use device-optimized fetching from helpers
      const results = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => {
          try {
            const balance = await fetchChainBalance(network.chainId);
            return [balance];
          } catch (err) {
            // Return error balance
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
              error: err instanceof Error ? err.message : 'Failed to fetch',
            }];
          }
        }
      );

      setBalances(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainBalance, defaultEthPrice]);

  // Calculate totals
  const totalBalance = useMemo(() => {
    const total = balances.reduce((sum, b) => sum + parseFloat(b.balance || '0'), 0);
    return total.toFixed(4);
  }, [balances]);

  const totalBalanceUSD = useMemo(() => {
    return balances.reduce((sum, b) => sum + (b.balanceUSD || 0), 0);
  }, [balances]);

  return {
    balances,
    totalBalance,
    totalBalanceUSD,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
