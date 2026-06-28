import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';

/**
 * The two balances the app surfaces, abstracted from on-chain tokens:
 *   Cash    = USDC  (spendable)
 *   Savings = CLRUSD (ESA savings)
 *
 * useMultichainBalances does NOT auto-fetch — the consumer must trigger it. We do that once here in
 * a provider (so AccountsPage + TransferModal etc. share one fetch instead of each hitting Alchemy)
 * and expose the derived balances via context. Both are $1-pegged stablecoins, so we sum token
 * UNITS (balanceUSD is often 0 from the backend when no price is returned for USDC).
 */
export interface ClearBalances {
  cash: number;
  savings: number;
  total: number;
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<ClearBalances | null>(null);

export function useClearBalances(): ClearBalances {
  return useContext(Ctx) ?? { cash: 0, savings: 0, total: 0, loading: false, refresh: () => {} };
}

export function ClearBalancesProvider({ children }: { children: ReactNode }) {
  const { tokens, tokensLoading, refreshTokens } = useMultichainBalances();

  // Trigger the fetch when connected (and whenever the wallet/connection changes).
  useEffect(() => {
    void refreshTokens();
  }, [refreshTokens]);

  const value = useMemo<ClearBalances>(() => {
    const amountFor = (symbol: string) =>
      tokens
        .filter((t) => t.symbol?.toUpperCase() === symbol)
        .reduce((sum, t) => sum + (Number(t.balance ?? 0) || 0), 0);
    const cash = amountFor('USDC');
    const savings = amountFor('CLRUSD');
    return { cash, savings, total: cash + savings, loading: tokensLoading, refresh: () => void refreshTokens(true) };
  }, [tokens, tokensLoading, refreshTokens]);

  return createElement(Ctx.Provider, { value }, children);
}
