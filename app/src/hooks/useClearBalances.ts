import { useMemo } from 'react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';

/**
 * The two balances the app surfaces, abstracted away from on-chain tokens:
 *   Cash    = USDC  (spendable)
 *   Savings = CLRUSD (ESA savings)
 *
 * Built on useMultichainBalances (real wallet balances via the backend). Both are ~$1 stablecoins,
 * so we use the priced USD value when present and fall back to the token balance otherwise. Summed
 * across all configured chains.
 */
export interface ClearBalances {
  cash: number;
  savings: number;
  total: number;
  loading: boolean;
}

export function useClearBalances(): ClearBalances {
  const { tokens, tokensLoading } = useMultichainBalances();
  return useMemo(() => {
    // USDC & CLRUSD are $1-pegged — sum the token UNITS (1 token ≈ $1). We deliberately ignore
    // balanceUSD: the backend often returns no USD price for USDC, which surfaces here as 0.
    const amountFor = (symbol: string) =>
      tokens
        .filter((t) => t.symbol?.toUpperCase() === symbol)
        .reduce((sum, t) => sum + (Number(t.balance ?? 0) || 0), 0);
    const cash = amountFor('USDC');
    const savings = amountFor('CLRUSD');
    return { cash, savings, total: cash + savings, loading: tokensLoading };
  }, [tokens, tokensLoading]);
}
