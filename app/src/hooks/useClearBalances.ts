import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMultichainBalances } from '@/hooks/useMultichainBalances';
import { COMMON_TOKENS } from '@/config/tokens';

/**
 * The two balances the app surfaces, abstracted from on-chain tokens:
 *   Cash    = USDC on MAINNET only (real funds)
 *   Savings = CLRUSD on ANY chain (testnet allowed until mainnet launch)
 *
 * Matched by canonical CONTRACT ADDRESS (from config/tokens.ts), NOT by symbol — this excludes
 * spam tokens that spoof the "USDC" symbol and testnet USDC. CLRUSD addresses come from
 * VITE_CLRUSD_<chainId>, so deploying CLRUSD on mainnet (+ setting that env) auto-includes it.
 *
 * useMultichainBalances does NOT auto-fetch — we trigger it once here in a provider and share the
 * derived balances via context (so AccountsPage + TransferModal don't each hit Alchemy). USDC/CLRUSD
 * are $1-pegged, so we sum token UNITS (the backend often returns balanceUSD=0 for USDC).
 */
const MAINNET_CHAIN_IDS = new Set([1, 10, 8453, 42161, 137, 100]);

// `${chainId}:${address}` keys for canonical tokens.
const USDC_KEYS = new Set<string>();
const CLRUSD_KEYS = new Set<string>();
for (const [chainIdStr, tokens] of Object.entries(COMMON_TOKENS)) {
  const chainId = Number(chainIdStr);
  for (const t of tokens) {
    const key = `${chainId}:${t.address.toLowerCase()}`;
    if (t.symbol === 'USDC' && MAINNET_CHAIN_IDS.has(chainId)) USDC_KEYS.add(key);
    if (t.symbol === 'CLRUSD') CLRUSD_KEYS.add(key); // any chain (testnet ok for now)
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
