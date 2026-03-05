import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidSpend,
  type PlaidSpendResponse,
} from '@/utils/apiClient';

const STALE_MS = 15 * 60 * 1000; // 15 minutes – spend updates more often than recurring

export interface UseSpendTransactionsResult {
  spendingByDay: PlaidSpendResponse['spendingByDay'];
  totalSpent: number;
  linked: boolean;
  notReady: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches Plaid spend-by-day for the current month (outflows from /transactions/get).
 * Uses React Query with staleTime to avoid excessive API calls:
 * - Only runs when walletAddress is set
 * - Supports `enabled` gate so callers can skip Plaid calls when no bank is linked
 * - Data considered fresh for 15 minutes
 * - refresh() bypasses server cache for user-triggered refresh
 */
export function useSpendTransactions(
  walletAddress: string | undefined,
  options?: { enabled?: boolean }
): UseSpendTransactionsResult {
  const queryClient = useQueryClient();
  const queryKey = ['plaid-spend', walletAddress ?? ''] as const;
  const enabled = !!walletAddress && (options?.enabled ?? true);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidSpendResponse> => {
      const result = await getPlaidSpend(walletAddress!);
      return result ?? { spendingByDay: {}, totalSpent: 0, linked: false, notReady: false };
    },
    enabled,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(async () => {
    if (!walletAddress || !enabled) return;
    const key = ['plaid-spend', walletAddress] as const;
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const result = await getPlaidSpend(walletAddress, { refresh: true });
        return result ?? { spendingByDay: {}, totalSpent: 0, linked: false, notReady: false };
      },
      staleTime: 0,
    });
  }, [enabled, walletAddress, queryClient]);

  return {
    spendingByDay: data?.spendingByDay ?? {},
    totalSpent: data?.totalSpent ?? 0,
    linked: data?.linked ?? false,
    notReady: data?.notReady ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load spend data') : null,
    refresh,
  };
}
