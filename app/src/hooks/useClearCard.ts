import { useCallback, useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { getClearCard, activateClearCard, type ClearCard } from '@/utils/apiClient';

/*
 * Clear card state (Bridge / Stripe Issuing) — P2. `configured` is false until the backend has
 * STRIPE_SECRET_KEY, so the UI cleanly shows an "activating soon" state everywhere until then.
 */
export function useClearCard() {
  const { address, isConnected } = useAppKitAccount();
  const [configured, setConfigured] = useState(false);
  const [card, setCard] = useState<ClearCard | null>(null);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected) {
      setConfigured(false);
      setCard(null);
      return;
    }
    const r = await getClearCard();
    setConfigured(r.configured);
    setCard(r.card);
  }, [isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Activate, and keep the reason if it did not.
   *
   * The result was discarded entirely: activation failed, `refresh()` found no card, the spinner
   * stopped and the button sat there saying "Activate your Clear card" again. Identical to not
   * having pressed it.
   */
  const activate = useCallback(async () => {
    if (!address) return;
    setActivating(true);
    setError(null);
    try {
      const { value, error: reason, unavailable } = await activateClearCard({
        walletAddress: address,
        chainId: ACTIVE_CHAIN_ID,
      });
      if (!value) {
        setError(
          unavailable
            ? "Cards aren't switched on yet. Nothing to do — we'll enable this for your account."
            : `That didn't go through. ${reason ?? 'Please try again.'}`,
        );
        return;
      }
      await refresh();
    } finally {
      setActivating(false);
    }
  }, [address, refresh]);

  return {
    configured,
    card,
    activating,
    /** Why the last activation did not happen. Null when nothing has gone wrong. */
    error,
    activate,
    refresh,
    active: card?.status === 'active',
    hasCard: !!card?.stripeCardId,
  };
}
