import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPlaidInvestmentAccounts,
  type PlaidInvestmentAccountsResponse,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

const STALE_MS = 60 * 60 * 1000; // 1 hour

export interface UsePlaidInvestmentAccountsResult {
  accounts: PlaidInvestmentAccountsResponse['accounts'];
  linked: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePlaidInvestmentAccounts(
  walletAddress: string | undefined,
  options?: { enabled?: boolean }
): UsePlaidInvestmentAccountsResult {
  const { isAuthenticated } = useAppKitAuth();
  const queryClient = useQueryClient();
  const queryKey = ['plaid-investment-accounts', walletAddress ?? '', isAuthenticated ? 'auth' : 'guest'] as const;
  const enabled = !!walletAddress && isAuthenticated && (options?.enabled ?? true);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<PlaidInvestmentAccountsResponse> => {
      const result = await getPlaidInvestmentAccounts(walletAddress!);
      return result ?? { accounts: [], linked: false };
    },
    enabled,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(() => {
    if (!walletAddress || !isAuthenticated) return;
    const key = ['plaid-investment-accounts', walletAddress, 'auth'] as const;
    queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        getPlaidInvestmentAccounts(walletAddress, { skipCache: true }) ??
        { accounts: [], linked: false },
      staleTime: STALE_MS,
    });
  }, [isAuthenticated, walletAddress, queryClient]);

  return {
    accounts: data?.accounts ?? [],
    linked: data?.linked ?? false,
    isLoading: enabled ? (isLoading && !data) : false,
    error: error ? (error instanceof Error ? error.message : 'Failed to load investment account summaries') : null,
    refresh,
  };
}
