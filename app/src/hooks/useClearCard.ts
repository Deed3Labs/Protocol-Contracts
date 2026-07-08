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

  const activate = useCallback(async () => {
    if (!address) return;
    setActivating(true);
    try {
      await activateClearCard({ walletAddress: address, chainId: ACTIVE_CHAIN_ID });
      await refresh();
    } finally {
      setActivating(false);
    }
  }, [address, refresh]);

  return {
    configured,
    card,
    activating,
    activate,
    refresh,
    active: card?.status === 'active',
    hasCard: !!card?.stripeCardId,
  };
}
