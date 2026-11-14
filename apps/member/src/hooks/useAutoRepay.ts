import { useRemembered, walletKey } from '@/lib/rememberedState';
import { useCallback, useEffect, useState } from 'react';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { scSetAutoClear, scSetSavingsDrawAllowance } from '@/lib/sendCalls';
import { getAutoRepay, recordAutoRepay } from '@/utils/apiClient';
import { useCreditRepay } from './useCreditRepay';
import { markChainStale } from '@/lib/chainStale';

export interface AutoRepay {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
  /** 0 = income-backed and Boost only (the default), 1 = everything. */
  scope?: number;
  onScopeChange?: (scope: number) => void;
  /** Auto-clear is switched off across Clear by the governed switch. */
  pausedForEveryone?: boolean;
  /**
   * What is owed within the chosen scope, in dollars, for a one-tap "Clear $X now?" (a Repay the
   * member signs). Null when nothing is owed or it could not be read.
   */
  clearNow?: { amount: number; onClear: () => void; done: string | null } | null;
  /** Card spending against Savings (12.7): what may still be drawn, in dollars; null when unread. */
  savingsAllowance?: { amount: number | null; unlimited: boolean; busy: boolean; onSet: (dollars: number) => void };
}

/**
 * Auto-clear — the member's switch (Phase 2b, section 12.2).
 *
 * When a deposit lands, what the member owes is cleared from it first, dearest tier first, within
 * the scope they choose. The switch moves the on-chain setting (`setAutoClear(on, scope)`, one
 * sponsored call, no approval: the settler delivers the cash, so the member's USDC and CLRUSD are
 * never swept), then asks the server to record it; a server that has not seen the chain catch up
 * says so rather than pretending.
 *
 * Auto-clear runs only on bank deposits to Spendable (owner's option 1): Clear's settler pays the
 * clearing, which is only right when the dollars arrived at Clear's partner bank. A USDC deposit
 * lands in the member's own wallet and is never swept, so whenever something is owed this also
 * offers a one-tap "Clear $X now?": a Repay the member signs themselves, from their own USDC.
 *
 * Also the Savings draw allowance (12.7): how much card spending may draw against Savings, set or
 * revoked to 0 by the member's own call.
 */
export function useAutoRepay(): AutoRepay {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const repay = useCreditRepay();
  // Remembered, so the switch does not show off and then flip on each time Settings opens.
  const [enabled, setEnabled] = useRemembered(`autorepay:${walletKey(address)}`, false);
  const [scope, setScope] = useState(0);
  const [paused, setPaused] = useState(false);
  const [owedCents, setOwedCents] = useState<number | null>(null);
  const [allowanceCents, setAllowanceCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowanceBusy, setAllowanceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!address) return;
    void getAutoRepay(address).then((status) => {
      if (!status) return;
      setEnabled(status.enabled);
      if (typeof status.scope === 'number') setScope(status.scope);
      setPaused(Boolean(status.pausedForEveryone));
      setOwedCents(status.owedInScopeCents ?? null);
      setAllowanceCents(status.savingsDrawAllowanceCents ?? null);
    });
  }, [address]);

  useEffect(() => refresh(), [refresh]);

  const write = useCallback(
    (next: boolean, nextScope: number) => {
      if (!address) return;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const client = getClientForChain ? await getClientForChain({ id: ACTIVE_CHAIN_ID }).catch(() => undefined) : undefined;
          await scSetAutoClear({ smartWalletClient: client, ownerWallet: address, enabled: next, scope: nextScope, chainId: ACTIVE_CHAIN_ID });
          const saved = await recordAutoRepay(address, next, nextScope);
          if (!saved.ok) setError(saved.error ?? 'Set in your wallet, but not saved yet. Try again in a moment.');
          else {
            setEnabled(next);
            setScope(nextScope);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That did not go through. Nothing changed.');
        } finally {
          setBusy(false);
        }
      })();
    },
    [address, getClientForChain],
  );

  const onChange = useCallback((next: boolean) => write(next, scope), [write, scope]);
  const onScopeChange = useCallback((next: number) => write(enabled, next), [write, enabled]);

  const onClear = useCallback(() => {
    if (!owedCents) return;
    setBusy(true);
    setError(null);
    void repay(owedCents / 100).then((outcome) => {
      setBusy(false);
      if (outcome.repaid) setCleared(`$${outcome.repaid.toFixed(2)} cleared`);
      if (outcome.error && !outcome.repaid) setError(outcome.error);
      markChainStale();
      refresh();
    });
  }, [owedCents, repay, refresh]);

  const onSetAllowance = useCallback(
    (dollars: number) => {
      if (!address || !Number.isFinite(dollars) || dollars < 0) return;
      setAllowanceBusy(true);
      setError(null);
      void (async () => {
        try {
          const client = getClientForChain ? await getClientForChain({ id: ACTIVE_CHAIN_ID }).catch(() => undefined) : undefined;
          const units = BigInt(Math.round(dollars * 100)) * 10_000n;
          await scSetSavingsDrawAllowance({ smartWalletClient: client, ownerWallet: address, units, chainId: ACTIVE_CHAIN_ID });
          setAllowanceCents(Math.round(dollars * 100));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That did not go through. Nothing changed.');
        } finally {
          setAllowanceBusy(false);
        }
      })();
    },
    [address, getClientForChain],
  );

  return {
    enabled,
    busy,
    error,
    onChange,
    scope,
    onScopeChange,
    pausedForEveryone: paused,
    // Offered whenever something in scope is owed: with auto-clear off, and also with it on, because
    // only a bank deposit to Spendable auto-clears (option 1). A USDC deposit stays the member's, and
    // this is how they clear from it themselves.
    clearNow: owedCents && owedCents > 0 ? { amount: owedCents / 100, onClear, done: cleared } : cleared ? { amount: 0, onClear, done: cleared } : null,
    savingsAllowance: {
      amount: allowanceCents === null || allowanceCents < 0 ? null : allowanceCents / 100,
      unlimited: allowanceCents === -1,
      busy: allowanceBusy,
      onSet: onSetAllowance,
    },
  };
}
