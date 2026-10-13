import { useCallback, useState } from 'react';
import { useOptionalAddress, useOptionalIsSmartAccount, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { installAutopaySession } from '@/lib/autopay';
import { isAaUnsupportedError } from '@/lib/aa';
import { markChainSettled } from '@/lib/chainStale';
import { cancelAutopayRule, readAutopay } from '@/utils/apiClient';
import { AUTO_SAVE_RUNS } from '@/lib/clearModel';


export interface AutoSaveControls {
  busy: boolean;
  error: string | null;
  /** Set auto-save, replacing any rule already running. Resolves true once it is in place. */
  turnOn: (amount: number, cadence: 'weekly' | 'monthly') => Promise<boolean>;
  /** Stop every running rule. Resolves true once they are cancelled. */
  turnOff: () => Promise<boolean>;
  clearError: () => void;
}

/** Every active rule, read fresh at the moment of a change rather than trusted from the page. */
async function activeRuleIds(address: string): Promise<string[]> {
  const summary = await readAutopay(address);
  if (!summary) throw new Error("Couldn't read your auto-save. Try again.");
  return summary.rules.filter((r) => r.status === 'active').map((r) => r.id);
}

/**
 * Auto-save on Savings: the autopay rule behind "Saving $X a month".
 *
 * Setting it signs a new mandate (`installAutopaySession`, the same path the original modal took),
 * and only once that is stored are the rules it replaces cancelled — so a member who backs out of
 * the signature still has the auto-save they had. Savings frames auto-save as one rule, so a change
 * replaces every running rule and turning it off stops them all.
 *
 * After either, the page re-reads at once: the server has finished its writes when it answers.
 */
export function useAutoSave(): AutoSaveControls {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const isSmartAccount = useOptionalIsSmartAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnOn = useCallback(
    async (amount: number, cadence: 'weekly' | 'monthly') => {
      if (!address) {
        setError('Sign in to set up auto-save.');
        return false;
      }
      if (!clearContracts(ACTIVE_CHAIN_ID)) {
        setError("Auto-save isn't available on this network yet.");
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const replaced = await activeRuleIds(address);
        const smartWalletClient =
          isSmartAccount && getClientForChain
            ? await getClientForChain({ id: ACTIVE_CHAIN_ID }).catch(() => undefined)
            : undefined;
        await installAutopaySession({
          chainId: ACTIVE_CHAIN_ID,
          ownerWallet: address,
          amountUsdc: amount,
          cadence,
          runs: AUTO_SAVE_RUNS,
          isSmartAccount,
          smartWalletClient,
        });
        const stopped = await Promise.all(replaced.map((id) => cancelAutopayRule(address, id)));
        markChainSettled();
        if (stopped.includes(false)) {
          // The new rule is in place; say so, so a retry doesn't sign a third.
          setError('Your new auto-save is on, but the old one is still running. Turn it off from here to stop both.');
          return false;
        }
        return true;
      } catch (e) {
        setError(
          isAaUnsupportedError(e)
            ? "Auto-save isn't available on your wallet yet. One-time deposits still work."
            : e instanceof Error
              ? e.message
              : "Couldn't set up auto-save.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [address, getClientForChain, isSmartAccount],
  );

  const turnOff = useCallback(async () => {
    if (!address) {
      setError('Sign in to turn off auto-save.');
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const ids = await activeRuleIds(address);
      const results = await Promise.all(ids.map((id) => cancelAutopayRule(address, id)));
      markChainSettled();
      if (results.includes(false)) {
        setError("Couldn't turn off auto-save. Try again.");
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn off auto-save.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [address]);

  return { busy, error, turnOn, turnOff, clearError: () => setError(null) };
}
