import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidLiabilities,
  type PlaidLiabilitiesResponse,
} from '@/utils/apiClient';

const STALE_MS = 60 * 60 * 1000; // 1 hour

export interface UsePlaidLiabilitiesResult {
  accounts: PlaidLiabilitiesResponse['accounts'];
  linked: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePlaidLiabilities(
  walletAddress: string | undefined,
  options?: { enabled?: boolean }
): UsePlaidLiabilitiesResult {
  const queryClient = useQueryClient();
  const queryKey = ['plaid-liabilities', walletAddress ?? ''] as const;
  const enabled = !!walletAddress && (options?.enabled ?? true);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidLiabilitiesResponse> => {
      const result = await getPlaidLiabilities(walletAddress!);
      return result ?? { accounts: [], linked: false };
    },
    enabled,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(() => {
    if (!walletAddress) return;
    const key = ['plaid-liabilities', walletAddress] as const;
    queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        getPlaidLiabilities(walletAddress, { skipCache: true }) ??
        { accounts: [], linked: false },
      staleTime: STALE_MS,
    });
  }, [walletAddress, queryClient]);

  return {
    accounts: data?.accounts ?? [],
    linked: data?.linked ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load liabilities') : null,
    refresh,
  };
}
