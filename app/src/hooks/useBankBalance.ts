import { useState, useEffect, useCallback } from 'react';
import { getBankBalances, type BankBalancesResponse } from '@/utils/apiClient';

export interface UseBankBalanceResult {
  bankCash: number;
  accounts: BankBalancesResponse['accounts'];
  totalBankBalance: number;
  linked: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches linked bank account balances for the given wallet address.
 * Returns totalBankBalance (sum of account balances) and accounts list.
 * Used to merge with portfolio crypto cash for consolidated "cash balance" display.
 */
export function useBankBalance(walletAddress: string | undefined): UseBankBalanceResult {
  const [data, setData] = useState<BankBalancesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async (skipCache?: boolean) => {
    if (!walletAddress) {
      setData(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await getBankBalances(walletAddress, skipCache ? { skipCache: true } : undefined);
      setData(result ?? { accounts: [], totalBankBalance: 0, linked: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bank balance');
      setData({ accounts: [], totalBankBalance: 0, linked: false });
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return {
    bankCash: data?.totalBankBalance ?? 0,
    accounts: data?.accounts ?? [],
    totalBankBalance: data?.totalBankBalance ?? 0,
    linked: data?.linked ?? false,
    isLoading,
    error,
    /** Refetch and bypass server cache (one Plaid API call). Use for "Refresh" button. */
    refresh: () => fetchBalances(true),
  };
}
