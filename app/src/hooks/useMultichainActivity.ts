import { useState, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { formatDistanceToNow } from 'date-fns';
import { SUPPORTED_NETWORKS, getNetworkByChainId, getNetworkInfo } from '@/config/networks';
import { executeRpcCall } from '@/utils/rpcOptimizer';
import type { WalletTransaction } from './useWalletActivity';
import { getTransactions } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

export interface MultichainTransaction extends WalletTransaction {
  chainId: number;
  chainName: string;
}

interface UseMultichainActivityReturn {
  transactions: MultichainTransaction[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

/**
 * Hook to fetch wallet transaction history across all supported networks
 * 
 * Fetches transaction history for the connected wallet across all configured chains.
 * Uses server API with Redis caching when available, falls back to direct RPC calls.
 * Transactions are sorted by timestamp (newest first) and limited to the specified count.
 * 
 * @param limit - Maximum number of transactions to return (default: 20)
 * 
 * @example
 * ```tsx
 * const { transactions, refresh } = useMultichainActivity(10);
 * 
 * // Display recent transactions
 * transactions.forEach(tx => {
 *   console.log(`${tx.type} on ${tx.chainName}: ${tx.amount} ${tx.currencySymbol}`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `transactions`: Array of transactions across all chains (sorted by timestamp)
 * - `isLoading`: Whether data is currently loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all chains
 * - `refreshChain`: Function to refresh a specific chain
 */
export function useMultichainActivity(limit: number = 20): UseMultichainActivityReturn {
  const { address, isConnected } = useAppKitAccount();
  const [transactions, setTransactions] = useState<MultichainTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Fetch transactions for a specific chain
  const fetchChainTransactions = useCallback(async (chainId: number): Promise<MultichainTransaction[]> => {
    if (!address) return [];

    const networkConfig = getNetworkByChainId(chainId);
    const networkInfo = getNetworkInfo(chainId);
    const currencySymbol = networkConfig?.nativeCurrency.symbol || networkInfo?.nativeCurrency.symbol || 'ETH';

    try {
      // Try server API first (with Redis caching) - don't wait for health check
      // This is faster and more resilient - if server is down, API call will fail quickly
      try {
        const serverTransactions = await withTimeout(
          getTransactions(chainId, address, limit),
          3000
        ) as Awaited<ReturnType<typeof getTransactions>> | null;
        
        if (serverTransactions && serverTransactions.transactions) {
          // Map server response to MultichainTransaction format
          return serverTransactions.transactions.map((tx: any) => ({
            ...tx,
            date: formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true }),
            chainId,
            chainName: networkConfig?.name || networkInfo?.name || `Chain ${chainId}`,
          }));
        }
      } catch (serverError) {
        // Server failed or timed out, fall through to direct RPC calls
        // Don't log - this is expected if server is unavailable
      }

      // Fallback to direct RPC calls if server is unavailable
      // Use optimized RPC call for getBlockNumber with longer cache (block numbers change slowly)
      const blockNumber = await executeRpcCall(
        chainId,
        'eth_blockNumber',
        [],
        { useCache: true, cacheTTL: 12000 } // Cache for 12 seconds (longer than default)
      ).then(result => parseInt(result, 16));
      
      const parsedTransactions: MultichainTransaction[] = [];

      // Limit blocks to check
      const blocksToCheck = Math.min(limit * 3, 50);
      const batchSize = 5; // Reduced batch size to avoid overwhelming RPC
      let foundCount = 0;

      for (let batchStart = 0; batchStart < blocksToCheck && foundCount < limit; batchStart += batchSize) {
        const batchPromises: Promise<void>[] = [];

        for (let i = batchStart; i < Math.min(batchStart + batchSize, blocksToCheck) && foundCount < limit; i++) {
          batchPromises.push(
            (async () => {
              try {
                // Use optimized RPC call for getBlock with caching
                const blockNumberHex = `0x${(blockNumber - i).toString(16)}`;
                const blockData = await executeRpcCall(
                  chainId,
                  'eth_getBlockByNumber',
                  [blockNumberHex, true], // true = include full transaction objects
                  { useCache: true, cacheTTL: 30000 } // Cache blocks for 30 seconds (they don't change)
                );
                
                // Convert RPC response to ethers Block format
                if (!blockData || !blockData.transactions) return;
                
                // Convert transaction hashes/objects
                const transactions = blockData.transactions.map((tx: any) => {
                  if (typeof tx === 'string') return { hash: tx };
                  return tx;
                });

                for (const tx of transactions) {
                  if (foundCount >= limit) return;

                  if (typeof tx === 'string' || !tx.hash) continue;

                  const transaction = tx;
                  const txHash = typeof tx === 'string' ? tx : tx.hash;
                  const isFromAddress = transaction.from?.toLowerCase() === address.toLowerCase();
                  const isToAddress = transaction.to?.toLowerCase() === address.toLowerCase();

                  if (isFromAddress || isToAddress) {
                    try {
                      // Use optimized RPC call for transaction receipt
                      const receiptData = await executeRpcCall(
                        chainId,
                        'eth_getTransactionReceipt',
                        [txHash],
                        { useCache: true, cacheTTL: 60000 } // Cache receipts for 60 seconds (they never change)
                      );
                      
                      const receipt = receiptData;
                      const txStatus = receipt?.status === '0x1' || receipt?.status === 1 ? 'completed' : receipt?.status === '0x0' || receipt?.status === 0 ? 'failed' : 'pending';

                      // Parse value (handle both hex and decimal)
                      const valueHex = transaction.value || '0x0';
                      const value = parseFloat(ethers.formatEther(BigInt(valueHex)));
                      
                      // Parse timestamp (handle both hex and decimal)
                      const timestampHex = blockData.timestamp || '0x0';
                      const timestamp = Number(BigInt(timestampHex)) * 1000;
                      const date = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

                      parsedTransactions.push({
                        id: `${chainId}-${txHash}`,
                        type: isFromAddress
                          ? (value > 0 ? 'withdraw' : transaction.to ? 'transfer' : 'contract')
                          : (value > 0 ? 'deposit' : 'transfer'),
                        assetSymbol: currencySymbol,
                        amount: value,
                        currency: currencySymbol,
                        date,
                        status: txStatus,
                        hash: txHash,
                        from: transaction.from,
                        to: transaction.to || undefined,
                        timestamp,
                        chainId,
                        chainName: networkConfig?.name || networkInfo?.name || `Chain ${chainId}`,
                      });

                      foundCount++;
                    } catch (receiptError) {
                      // Silent error - skip this transaction
                    }
                  }
                }
              } catch (blockError) {
                // Silent error - skip this block
              }
            })()
          );
        }

        await Promise.all(batchPromises);
      }

      // Sort by timestamp (newest first)
      parsedTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return parsedTransactions;
    } catch (err) {
      // Silent error - return empty array
      return [];
    }
  }, [address, limit]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const chainTransactions = await fetchChainTransactions(chainId);
    setTransactions(prev => {
      // Remove old transactions from this chain and add new ones
      const filtered = prev.filter(t => t.chainId !== chainId);
      const merged = [...filtered, ...chainTransactions];
      // Sort by timestamp (newest first)
      return merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    });
  }, [isConnected, address, fetchChainTransactions]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setTransactions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use device-optimized fetching (sequential for mobile, parallel for desktop)
      const allTransactions = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => await fetchChainTransactions(network.chainId)
      );
      
      // Sort by timestamp (newest first) and limit
      allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setTransactions(allTransactions.slice(0, limit));
    } catch (err) {
      // Silent error handling
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainTransactions, limit]);

  // Note: Automatic refresh is now controlled by PortfolioContext
  // This hook only provides the refresh function - it does not auto-refresh

  return {
    transactions,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
