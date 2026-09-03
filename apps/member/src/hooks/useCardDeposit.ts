import { useCallback, useRef, useState } from 'react';
import { createRampBuySession, getRampBuyStatus, rampEvent } from '@/utils/apiClient';

/*
 * Card/Apple Pay deposit for the "fund-then-send" flow: opens the hosted Coinbase checkout for a fixed
 * amount and resolves once the deposit lands in the wallet, so the caller can immediately fire the send.
 * Uses the hosted checkout (new tab) rather than the embedded Apple Pay iframe — the iframe needs Apple
 * Pay domain verification, which isn't set up yet, whereas the hosted flow works today. Card/Apple Pay
 * settle in seconds, so a bounded client-side poll is enough (ACH — which is slow — is "coming soon").
 * The ramp status/notification system (rampEvent + the Coinbase webhook) still fires for the deposit.
 */
export type CardDepositStatus = 'idle' | 'opening' | 'awaiting' | 'success' | 'failed';

const POLL_MS = 4000;
const TIMEOUT_MS = 5 * 60_000;

export function useCardDeposit() {
  const [status, setStatus] = useState<CardDepositStatus>('idle');
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setStatus('idle');
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /** Open the checkout for `amount` and resolve true once the deposit is confirmed in `wallet`. */
  const run = useCallback(async (amount: number, wallet: string): Promise<boolean> => {
    cancelRef.current = false;
    setStatus('opening');
    const ref = `snd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void rampEvent({ type: 'buy', status: 'submitted', amount, walletAddress: wallet, ref });

    const { url } = await createRampBuySession({
      amount,
      paymentMethod: 'card',
      walletAddress: wallet,
      redirectUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    });
    if (!url) {
      setStatus('failed');
      return false;
    }
    window.open(url, '_blank', 'noopener');
    setStatus('awaiting');

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (cancelRef.current) return false;
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelRef.current) return false;
      const s = await getRampBuyStatus(wallet).catch(() => ({ status: null as string | null, id: undefined }));
      if (s.status && /SUCCESS/i.test(s.status)) {
        void rampEvent({ type: 'buy', status: 'completed', amount, walletAddress: wallet, ref: s.id || ref });
        setStatus('success');
        return true;
      }
      if (s.status && /FAIL/i.test(s.status)) {
        void rampEvent({ type: 'buy', status: 'failed', amount, walletAddress: wallet, ref: s.id || ref });
        setStatus('failed');
        return false;
      }
    }
    setStatus('failed');
    return false;
  }, []);

  return { status, run, cancel, reset };
}
