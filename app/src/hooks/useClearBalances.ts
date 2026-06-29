import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';
import { COMMON_TOKENS } from '@/config/tokens';
import { includeChainBalance } from '@/lib/clearNetwork';

/**
 * The two balances the app surfaces, abstracted from on-chain tokens:
 *   Cash    = USDC, Savings = CLRUSD
 *
 * Gated BY DOMAIN: the live app (app.useclear.org) counts MAINNET chains only (real funds); the
 * demo/preview also counts testnet chains (so test funds show). Matched by canonical CONTRACT ADDRESS
 * (config/tokens.ts), NOT symbol — excludes spoofed "USDC" spam.
 *
 * useMultichainBalances does NOT auto-fetch — we trigger it once here in a provider and share the
 * derived balances via context (so AccountsPage + TransferModal don't each hit Alchemy). USDC/CLRUSD
 * are $1-pegged, so we sum token UNITS (the backend often returns balanceUSD=0 for USDC).
 */

// `${chainId}:${address}` keys for canonical tokens (chains gated to the current domain's networks).
const USDC_KEYS = new Set<string>();
const CLRUSD_KEYS = new Set<string>();
for (const [chainIdStr, tokens] of Object.entries(COMMON_TOKENS)) {
  const chainId = Number(chainIdStr);
  if (!includeChainBalance(chainId)) continue;
  for (const t of tokens) {
    const key = `${chainId}:${t.address.toLowerCase()}`;
    if (t.symbol === 'USDC') USDC_KEYS.add(key);
    if (t.symbol === 'CLRUSD') CLRUSD_KEYS.add(key);
  }
}

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

  useEffect(() => {
    void refreshTokens();
  }, [refreshTokens]);

  const value = useMemo<ClearBalances>(() => {
    const sumByKeys = (keys: Set<string>) =>
      tokens
        .filter((t) => keys.has(`${t.chainId}:${(t.tokenAddress ?? '').toLowerCase()}`))
        .reduce((sum, t) => sum + (Number(t.balance ?? 0) || 0), 0);
    const cash = sumByKeys(USDC_KEYS);
    const savings = sumByKeys(CLRUSD_KEYS);
    return { cash, savings, total: cash + savings, loading: tokensLoading, refresh: () => void refreshTokens(true) };
  }, [tokens, tokensLoading, refreshTokens]);

  return createElement(Ctx.Provider, { value }, children);
}
