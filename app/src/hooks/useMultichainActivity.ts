import { useState, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS, getNetworkByChainId, getNetworkInfo } from '@/config/networks';
import type { WalletTransaction } from '@/types/transactions';
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

const normalizeTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  return null;
};

/**
 * Hook to fetch wallet transaction history across all supported networks
 * 
 * Fetches transaction history for the connected wallet across all configured chains.
 * Uses server API with Redis caching when available, falls back to direct RPC calls.
 * Transactions are sorted by timestamp (newest first) and limited to the specified count.
 * 
 * @param limit - Maximum number of transactions to keep after cross-chain merge (default: 20)
 * @param perChainLimit - Maximum transactions to request per chain (defaults to `limit`)
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
export function useMultichainActivity(
  limit: number = 20,
  perChainLimit: number = limit
): UseMultichainActivityReturn {
  const { address, isConnected } = useAppKitAccount();
  const [transactions, setTransactions] = useState<MultichainTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestLimit = Math.max(1, Math.min(Math.floor(perChainLimit), 50));

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Fetch transactions for a specific chain
  const fetchChainTransactions = useCallback(async (chainId: number): Promise<MultichainTransaction[]> => {
    if (!address) return [];

    const networkConfig = getNetworkByChainId(chainId);
    const networkInfo = getNetworkInfo(chainId);

    try {
      // Use server API (with Redis caching)
      // Increased timeout for transaction fetching (15 seconds) - can be slow for many transactions
      const serverTransactions = await withTimeout(
        getTransactions(chainId, address, requestLimit),
        15000
      ) as Awaited<ReturnType<typeof getTransactions>> | null;
      
      if (!serverTransactions || !serverTransactions.transactions) {
        // No transactions found or server error
        if (import.meta.env.PROD && !serverTransactions) {
          console.error(`[useMultichainActivity] Server API failed for chain ${chainId}`);
        }
        return [];
      }

      // Map server response to MultichainTransaction format
      return serverTransactions.transactions.map((tx: any) => {
        const normalizedTimestamp = normalizeTimestampMs(tx?.timestamp);
        const normalizedDate =
          normalizedTimestamp != null
            ? new Date(normalizedTimestamp).toISOString()
            : typeof tx?.date === 'string'
              ? tx.date
              : '';

        return {
          ...tx,
          timestamp: normalizedTimestamp ?? undefined,
          date: normalizedDate,
          chainId,
          chainName: networkConfig?.name || networkInfo?.name || `Chain ${chainId}`,
        };
      });
    } catch (err) {
      // Server is required in production
      if (import.meta.env.PROD) {
        console.error(`[useMultichainActivity] Server API error for chain ${chainId}:`, err);
        throw new Error(`Server API is required but unavailable for chain ${chainId}`);
      }
      // In development, return empty array
      return [];
    }
  }, [address, requestLimit]);

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
