import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidRecurringTransactions,
  type PlaidRecurringResponse,
} from '@/utils/apiClient';

const STALE_MS = 60 * 60 * 1000; // 1 hour – recurring streams are monthly-scale; avoid refetch on remount

export interface UseRecurringTransactionsResult {
  inflowStreams: PlaidRecurringResponse['inflowStreams'];
  outflowStreams: PlaidRecurringResponse['outflowStreams'];
  linked: boolean;
  notReady: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches Plaid recurring transaction streams (inflow = deposits, outflow = subscriptions)
 * for the given wallet. Uses React Query with staleTime to avoid excessive API calls:
 * - Only runs when walletAddress is set
 * - Data considered fresh for 5 minutes; no refetch on remount or window focus
 * - refresh() bypasses server cache for user-triggered refresh
 */
export function useRecurringTransactions(
  walletAddress: string | undefined
): UseRecurringTransactionsResult {
  const queryClient = useQueryClient();
  const queryKey = ['plaid-recurring', walletAddress ?? ''] as const;

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidRecurringResponse> => {
      const result = await getPlaidRecurringTransactions(walletAddress!);
      return result ?? { inflowStreams: [], outflowStreams: [], linked: false, notReady: false };
    },
    enabled: !!walletAddress,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(() => {
    if (!walletAddress) return;
    const key = ['plaid-recurring', walletAddress] as const;
    queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        getPlaidRecurringTransactions(walletAddress, { refresh: true }) ??
        { inflowStreams: [], outflowStreams: [], linked: false, notReady: false },
      staleTime: STALE_MS,
    });
  }, [walletAddress, queryClient]);

  return {
    inflowStreams: data?.inflowStreams ?? [],
    outflowStreams: data?.outflowStreams ?? [],
    linked: data?.linked ?? false,
    notReady: data?.notReady ?? false,
    isLoading: walletAddress ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load recurring transactions') : null,
    refresh,
  };
}
