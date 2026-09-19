import { useRemembered } from '@/lib/rememberedState';
import { useCallback, useEffect, useState } from 'react';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { scSetAutoRepay } from '@/lib/sendCalls';
import { getAutoRepay, recordAutoRepay } from '@/utils/apiClient';

export interface AutoRepay {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
}

/**
 * Automatic repayment from USDC deposits — the member's switch.
 *
 * The switch reads what the server recorded, and the server records only what the chain shows the
 * member's own wallet set. Flipping it sends the one sponsored batch (approve + mandate), then asks
 * the server to record it; a server that has not seen the chain catch up says so rather than
 * pretending.
 */
export function useAutoRepay(): AutoRepay {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  // Remembered, so the switch does not show off and then flip on each time Settings opens.
  const [enabled, setEnabled] = useRemembered(`autorepay:${address ?? ''}`, false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    void getAutoRepay(address).then((status) => status && setEnabled(status.enabled));
  }, [address]);

  const onChange = useCallback(
    (next: boolean) => {
      if (!address) return;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const client = getClientForChain ? await getClientForChain({ id: ACTIVE_CHAIN_ID }).catch(() => undefined) : undefined;
          await scSetAutoRepay({ smartWalletClient: client, ownerWallet: address, enabled: next, chainId: ACTIVE_CHAIN_ID });
          const saved = await recordAutoRepay(address, next);
          if (!saved.ok) setError(saved.error ?? 'Set in your wallet, but not saved yet. Try again in a moment.');
          else setEnabled(next);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That did not go through. Nothing changed.');
        } finally {
          setBusy(false);
        }
      })();
    },
    [address, getClientForChain],
  );

  return { enabled, busy, error, onChange };
}
