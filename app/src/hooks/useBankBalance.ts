import { useState, useEffect, useCallback } from 'react';
import {
  getBankBalances,
  type BankBalancesResponse,
  type BankAccountBalance,
} from '@/utils/apiClient';

export interface UseBankBalanceResult {
  bankCash: number;
  accounts: BankBalancesResponse['accounts'];
  totalBankBalance: number;
  /** Sum of available credit from linked liability accounts (off-chain + on-chain). */
  borrowingPower: number;
  /** Off-chain contribution (Plaid liability/credit accounts). */
  offchainBorrowingPower: number;
  /** On-chain contribution (reserved for protocol credit lines). */
  onchainBorrowingPower: number;
  linked: boolean;
  isLoading: boolean;
  error: string | null;
  /** Refetch balances. Pass true to bypass server cache (Plaid API call). Use true for "Refresh" button or after linking bank. */
  refresh: (skipCache?: boolean) => Promise<void>;
}

type BankBalanceState = BankBalancesResponse & {
  borrowingPower: number;
  offchainBorrowingPower: number;
  onchainBorrowingPower: number;
};

const EMPTY_STATE: BankBalanceState = {
  accounts: [],
  totalBankBalance: 0,
  borrowingPower: 0,
  offchainBorrowingPower: 0,
  onchainBorrowingPower: 0,
  linked: false,
};

function isLiabilityLikeAccount(account: BankAccountBalance): boolean {
  const type = (account.type ?? '').toLowerCase();
  const subtype = (account.subtype ?? '').toLowerCase();
  return (
    type === 'credit' ||
    type === 'loan' ||
    subtype.includes('credit') ||
    subtype.includes('loan') ||
    subtype.includes('mortgage') ||
    subtype.includes('student')
  );
}

function isCashContributionAccount(account: BankAccountBalance): boolean {
  const type = (account.type ?? '').toLowerCase();
  const subtype = (account.subtype ?? '').toLowerCase();

  if (type === 'investment') return false;
  if (isLiabilityLikeAccount(account)) return false;
  if (type === 'depository') return true;

  return (
    subtype === 'checking' ||
    subtype === 'savings' ||
    subtype === 'money market' ||
    subtype === 'cash management'
  );
}

function normalizeBankBalances(response: BankBalancesResponse | null): BankBalanceState {
  if (!response) return EMPTY_STATE;

  const totalBankBalance = response.accounts.reduce((sum, account) => {
    const current = account.current;
    if (typeof current !== 'number' || Number.isNaN(current)) return sum;
    if (!isCashContributionAccount(account)) return sum;
    return sum + current;
  }, 0);

  const offchainBorrowingPower = response.accounts.reduce((sum, account) => {
    if (!isLiabilityLikeAccount(account)) return sum;
    const available = account.available;
    if (typeof available !== 'number' || Number.isNaN(available)) return sum;
    return sum + Math.max(available, 0);
  }, 0);

  const onchainBorrowingPower = 0;

  return {
    ...response,
    totalBankBalance,
    borrowingPower: offchainBorrowingPower + onchainBorrowingPower,
    offchainBorrowingPower,
    onchainBorrowingPower,
  };
}

/**
 * Fetches linked bank account balances for the given wallet address.
 * Returns normalized totals:
 * - totalBankBalance: cash-like balances only (depository/checking/savings), excluding liabilities/investments.
 * - borrowingPower: available credit across linked liability accounts.
 */
export function useBankBalance(walletAddress: string | undefined): UseBankBalanceResult {
  const [data, setData] = useState<BankBalanceState | null>(null);
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
      setData(normalizeBankBalances(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bank balance');
      setData(EMPTY_STATE);
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
    borrowingPower: data?.borrowingPower ?? 0,
    offchainBorrowingPower: data?.offchainBorrowingPower ?? 0,
    onchainBorrowingPower: data?.onchainBorrowingPower ?? 0,
    linked: data?.linked ?? false,
    isLoading,
    error,
    /** Refetch. skipCache=false (default) uses server cache for polling; skipCache=true for explicit Refresh or after link. */
    refresh: (skipCache = false) => fetchBalances(skipCache),
  };
}
