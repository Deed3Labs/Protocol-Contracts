import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
 * AUTO-REFRESH + OPTIMISTIC: the provider polls (and refreshes on window focus) so balances update
 * without a manual reload. `applyOptimistic(cashDelta, savingsDelta)` shifts the displayed balances
 * immediately after a known-successful action (deposit/redeem/send/withdraw) and reconciles to the
 * real on-chain value once the indexer catches up — so the indexing delay isn't visible to the user.
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
  /**
   * Optimistically shift the displayed balances right after a known-successful action; reconciles to
   * the real on-chain value once the indexer catches up (or after a timeout). Deltas are USDC units
   * (e.g. deposit $20: applyOptimistic(-20, +20)).
   */
  applyOptimistic: (cashDelta: number, savingsDelta: number) => void;
}

const Ctx = createContext<ClearBalances | null>(null);

export function useClearBalances(): ClearBalances {
  return (
    useContext(Ctx) ?? { cash: 0, savings: 0, total: 0, loading: false, refresh: () => {}, applyOptimistic: () => {} }
  );
}

const POLL_MS = 30_000; // steady auto-refresh
const FAST_POLL_MS = 6_000; // while an optimistic update awaits on-chain reconciliation
const PENDING_TTL_MS = 90_000; // give up the overlay after this and trust the chain
const EPS = 0.005; // "the chain moved" threshold (USDC units)

interface Pending {
  cash: number;
  savings: number;
  baseCash: number;
  baseSavings: number;
  until: number;
}

export function ClearBalancesProvider({ children }: { children: ReactNode }) {
  const { tokens, tokensLoading, refreshTokens } = useMultichainBalances();
  const [pending, setPending] = useState<Pending | null>(null);

  // Authoritative (on-chain) balances derived from fetched tokens.
  const fetched = useMemo(() => {
    const sumByKeys = (keys: Set<string>) =>
      tokens
        .filter((t) => keys.has(`${t.chainId}:${(t.tokenAddress ?? '').toLowerCase()}`))
        .reduce((sum, t) => sum + (Number(t.balance ?? 0) || 0), 0);
    return { cash: sumByKeys(USDC_KEYS), savings: sumByKeys(CLRUSD_KEYS) };
  }, [tokens]);

  // Initial fetch.
  useEffect(() => {
    void refreshTokens();
  }, [refreshTokens]);

  // Auto-refresh: poll steadily, faster while an optimistic overlay is pending.
  useEffect(() => {
    const id = setInterval(() => void refreshTokens(true), pending ? FAST_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [refreshTokens, pending]);

  // Refresh when the tab/app regains focus so returning users see fresh data without a reload.
  useEffect(() => {
    const onFocus = () => void refreshTokens(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTokens]);

  // Reconcile: drop the optimistic overlay once the chain moves off the baseline or the TTL elapses.
  useEffect(() => {
    if (!pending) return;
    const moved =
      Math.abs(fetched.cash - pending.baseCash) > EPS || Math.abs(fetched.savings - pending.baseSavings) > EPS;
    if (moved || Date.now() >= pending.until) {
      setPending(null);
      return;
    }
    const t = setTimeout(() => setPending(null), Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(t);
  }, [fetched, pending]);

  const applyOptimistic = useCallback(
    (cashDelta: number, savingsDelta: number) => {
      setPending((prev) => {
        // Compound onto the currently-displayed value, but baseline off the latest fetched value.
        const curCash = prev ? prev.cash : fetched.cash;
        const curSavings = prev ? prev.savings : fetched.savings;
        return {
          cash: Math.max(0, curCash + cashDelta),
          savings: Math.max(0, curSavings + savingsDelta),
          baseCash: fetched.cash,
          baseSavings: fetched.savings,
          until: Date.now() + PENDING_TTL_MS,
        };
      });
      void refreshTokens(true);
    },
    [fetched, refreshTokens],
  );

  const value = useMemo<ClearBalances>(() => {
    const cash = pending ? pending.cash : fetched.cash;
    const savings = pending ? pending.savings : fetched.savings;
    return {
      cash,
      savings,
      total: cash + savings,
      loading: tokensLoading,
      refresh: () => void refreshTokens(true),
      applyOptimistic,
    };
  }, [pending, fetched, tokensLoading, refreshTokens, applyOptimistic]);

  return createElement(Ctx.Provider, { value }, children);
}
