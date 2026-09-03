import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidLiabilities,
  type PlaidLiabilitiesResponse,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

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
  const { isAuthenticated } = useAppKitAuth();
  const queryClient = useQueryClient();
  const queryKey = ['plaid-liabilities', walletAddress ?? '', isAuthenticated ? 'auth' : 'guest'] as const;
  const enabled = !!walletAddress && isAuthenticated && (options?.enabled ?? true);

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
    if (!walletAddress || !isAuthenticated) return;
    const key = ['plaid-liabilities', walletAddress, 'auth'] as const;
    queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        getPlaidLiabilities(walletAddress, { skipCache: true }) ??
        { accounts: [], linked: false },
      staleTime: STALE_MS,
    });
  }, [isAuthenticated, walletAddress, queryClient]);

  return {
    accounts: data?.accounts ?? [],
    linked: data?.linked ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load liabilities') : null,
    refresh,
  };
}
