import { useState, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getNetworkByChainId } from '@/config/networks';
import { usePricingData } from './usePricingData';
import { getBalanceOptimized } from '@/utils/rpcOptimizer';
import { getBalance, getBalancesBatch, checkServerHealth } from '@/utils/apiClient';

// Detect mobile device
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

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
 */
export function useMultichainBalances(): UseMultichainBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [balances, setBalances] = useState<MultichainBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Get ETH price for USD conversion (using mainnet price as reference)
  const { price: ethPrice } = usePricingData();

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Fetch balance for a specific chain (retry logic handled by rpcOptimizer)
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
      const isServerAvailable = await checkServerHealth();
      if (isServerAvailable) {
        try {
          const serverBalance = await getBalance(chainId, address);
          if (serverBalance && serverBalance.balance) {
            const balanceWei = BigInt(serverBalance.balanceWei);
            const balanceUSD = parseFloat(serverBalance.balance) * (ethPrice || 0);
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
          // Server failed, fall through to direct RPC call
        }
      }

      // Fallback to direct RPC call if server is unavailable
      // Use optimized RPC call with caching and rate limiting
      const balanceWei = await getBalanceOptimized(chainId, address, true);
      const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);
      const balanceUSD = parseFloat(balance) * (ethPrice || 0);

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
      // Error handling is done in rpcOptimizer with retry logic
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
  }, [address, ethPrice]);

  // Refresh a specific chain
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

  // Refresh all chains
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
    // This prevents the balance from flashing to 0.00 during refresh
    setBalances(prev => {
      // If we have existing balances, update them to show loading state
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
      // Try batch API first if server is available (more efficient)
      const isServerAvailable = await checkServerHealth();
      if (isServerAvailable) {
        try {
          const batchRequests = SUPPORTED_NETWORKS.map(network => ({
            chainId: network.chainId,
            address: address,
          }));
          
          const batchResults = await getBalancesBatch(batchRequests);
          
          // Convert batch results to MultichainBalance format
          const results: MultichainBalance[] = batchResults.map((result, index) => {
            const network = SUPPORTED_NETWORKS[index];
            if (result.balance && result.balanceWei) {
              const balanceWei = BigInt(result.balanceWei);
              const balanceUSD = parseFloat(result.balance) * (ethPrice || 0);
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
              // Fallback to individual fetch if batch failed for this chain
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
        } catch (batchError) {
          // Batch API failed, fall through to individual fetches
          console.log('Batch API unavailable, using individual fetches');
        }
      }

      // Fallback to individual fetches (original logic)
      const isMobile = isMobileDevice();
      
      if (isMobile) {
        // On mobile, fetch sequentially with delays to avoid overwhelming the browser
        const results: MultichainBalance[] = [];
        for (let i = 0; i < SUPPORTED_NETWORKS.length; i++) {
          const network = SUPPORTED_NETWORKS[i];
          
          // Update loading state for current chain
          setBalances(prev => {
            const updated = [...prev];
            const index = updated.findIndex(b => b.chainId === network.chainId);
            if (index >= 0) {
              updated[index] = { ...updated[index], isLoading: true };
            }
            return updated;
          });
          
          try {
            const balance = await fetchChainBalance(network.chainId);
            results.push(balance);
            
            // Update state with this chain's result
            setBalances(prev => {
              const updated = [...prev];
              const index = updated.findIndex(b => b.chainId === network.chainId);
              if (index >= 0) {
                updated[index] = balance;
              }
              return updated;
            });
          } catch (err) {
            // Continue with other chains even if one fails
            const errorBalance: MultichainBalance = {
              chainId: network.chainId,
              chainName: network.name,
              balance: '0.00',
              balanceWei: 0n,
              balanceUSD: 0,
              currencySymbol: network.nativeCurrency.symbol,
              currencyName: network.nativeCurrency.name,
              isLoading: false,
              error: err instanceof Error ? err.message : 'Failed to fetch',
            };
            results.push(errorBalance);
            
            // Update state with error
            setBalances(prev => {
              const updated = [...prev];
              const index = updated.findIndex(b => b.chainId === network.chainId);
              if (index >= 0) {
                updated[index] = errorBalance;
              }
              return updated;
            });
          }
          
          // Add delay between chains on mobile (except for the last one)
          if (i < SUPPORTED_NETWORKS.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      } else {
        // On desktop, fetch all chains in parallel
        const balancePromises = SUPPORTED_NETWORKS.map(network => fetchChainBalance(network.chainId));
        const results = await Promise.all(balancePromises);
        setBalances(results);
      }
    } catch (err) {
      // Silent error handling - only set error state, don't log
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainBalance]);

  // Initial load and refresh on address/connection change
  // Note: Automatic refresh is now controlled by PortfolioContext
  // This hook only provides the refresh function - it does not auto-refresh

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
