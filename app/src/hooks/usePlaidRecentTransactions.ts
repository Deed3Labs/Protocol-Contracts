import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidRecentTransactions,
  type PlaidRecentTransactionsResponse,
} from '@/utils/apiClient';

const STALE_MS = 15 * 60 * 1000; // 15 minutes – transaction list can update frequently

export interface UsePlaidRecentTransactionsResult {
  transactions: PlaidRecentTransactionsResponse['transactions'];
  linked: boolean;
  notReady: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches recent Plaid transactions (rolling 90 days, newest first) for the given wallet.
 * Supports `enabled` gate and refresh() to force bypassing cache.
 */
export function usePlaidRecentTransactions(
  walletAddress: string | undefined,
  options?: { enabled?: boolean; limit?: number }
): UsePlaidRecentTransactionsResult {
  const queryClient = useQueryClient();
  const limit = options?.limit && Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : 500;
  const queryKey = ['plaid-recent-transactions', walletAddress ?? '', limit] as const;
  const enabled = !!walletAddress && (options?.enabled ?? true);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidRecentTransactionsResponse> => {
      const result = await getPlaidRecentTransactions(walletAddress!, { limit });
      return result ?? { transactions: [], linked: false, notReady: false };
    },
    enabled,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(async () => {
    if (!walletAddress || !enabled) return;
    const key = ['plaid-recent-transactions', walletAddress, limit] as const;
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const result = await getPlaidRecentTransactions(walletAddress, { refresh: true, limit });
        return result ?? { transactions: [], linked: false, notReady: false };
      },
      staleTime: 0,
    });
  }, [enabled, limit, queryClient, walletAddress]);

  return {
    transactions: data?.transactions ?? [],
    linked: data?.linked ?? false,
    notReady: data?.notReady ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load recent transactions') : null,
    refresh,
  };
}
