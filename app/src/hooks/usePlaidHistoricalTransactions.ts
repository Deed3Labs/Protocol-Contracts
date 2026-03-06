import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidHistoricalTransactions,
  type PlaidHistoricalTransactionsResponse,
} from '@/utils/apiClient';

const STALE_MS = 30 * 60 * 1000; // 30 minutes – historical window changes less frequently

export interface UsePlaidHistoricalTransactionsResult {
  transactions: PlaidHistoricalTransactionsResponse['transactions'];
  linked: boolean;
  notReady: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches historical Plaid transactions (last 2 years, newest first) for the given wallet.
 * Intended for longer-range filters (1Y/2Y/All) where lazy-loading historical data is acceptable.
 */
export function usePlaidHistoricalTransactions(
  walletAddress: string | undefined,
  options?: { enabled?: boolean; limit?: number }
): UsePlaidHistoricalTransactionsResult {
  const queryClient = useQueryClient();
  const limit = options?.limit && Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : 1500;
  const queryKey = ['plaid-historical-transactions', walletAddress ?? '', limit] as const;
  const enabled = !!walletAddress && (options?.enabled ?? true);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidHistoricalTransactionsResponse> => {
      const result = await getPlaidHistoricalTransactions(walletAddress!, { limit });
      return result ?? { transactions: [], linked: false, notReady: false };
    },
    enabled,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    const key = ['plaid-historical-transactions', walletAddress, limit] as const;
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const result = await getPlaidHistoricalTransactions(walletAddress, { refresh: true, limit });
        return result ?? { transactions: [], linked: false, notReady: false };
      },
      staleTime: 0,
    });
  }, [limit, queryClient, walletAddress]);

  return {
    transactions: data?.transactions ?? [],
    linked: data?.linked ?? false,
    notReady: data?.notReady ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load historical transactions') : null,
    refresh,
  };
}
