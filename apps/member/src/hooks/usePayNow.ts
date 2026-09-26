import { useCallback } from 'react';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { scPayShop } from '@/lib/sendCalls';
import { markChainStale } from '@/lib/chainStale';
import { confirmPayNow, startPayNow, type ChargeView } from '@/utils/apiClient';

export interface PayNowOutcome {
  charge?: ChargeView;
  /** Sent, and not on chain yet: the charge is marked paid when it lands. */
  pending?: boolean;
  /** Something moved and needs a second look, or nothing did — the sentence says which. */
  error?: string;
}

/** 1 holding it, 2 paying from the wallet, 3 checking it on chain. */
export type PayNowStep = 1 | 2 | 3;

/**
 * Pay a charge now, from Ready to allocate (the member's USDC).
 *
 * Three steps, in order, and the order is the safety:
 *
 *   hold     the server takes the charge (the shop can't cancel it, no plan can open on it) and says
 *            what to send; Face ID first
 *   pay      the member's own wallet sends the shop's share and Clear's fee in one batch
 *   confirm  the server reads the transfers on chain before it calls the charge paid
 *
 * If the app dies between pay and confirm, the server still finds the payment: nothing here is the
 * record of it, the chain is.
 */
export function usePayNow(): (code: string, onStep?: (step: PayNowStep) => void) => Promise<PayNowOutcome> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (code: string, onStep?: (step: PayNowStep) => void) => {
      if (!address) return { error: 'Sign in first.' };
      onStep?.(1);
      const held = await startPayNow(code);
      if (held.error || !held.pay) return { error: held.error ?? 'We could not get this ready. Nothing was charged.' };
      const pay = held.pay;

      onStep?.(2);
      let txHash: string;
      try {
        const client = getClientForChain ? await getClientForChain({ id: pay.chainId }).catch(() => undefined) : undefined;
        txHash = await scPayShop({
          smartWalletClient: client,
          ownerWallet: address,
          chainId: pay.chainId,
          token: pay.token as `0x${string}`,
          shop: { to: pay.shop.to as `0x${string}`, units: BigInt(pay.shop.units) },
          fee: { to: pay.fee.to as `0x${string}`, units: BigInt(pay.fee.units) },
        });
      } catch (e) {
        // Nothing left the wallet. The hold stays until they go back or it lapses; paying again
        // picks up the same one.
        return { error: e instanceof Error && e.message ? e.message : 'That did not go through. Nothing was paid.' };
      }
      markChainStale();

      onStep?.(3);
      const confirmed = await confirmPayNow(code, txHash);
      if (confirmed.pending) return { charge: confirmed.charge, pending: true };
      if (confirmed.error || !confirmed.charge) {
        // The money left: say so, and that it is being checked, rather than "try again".
        return { error: `${confirmed.error ?? 'We could not confirm it yet.'} Your payment was sent, so don’t pay again — we’ll finish checking it.`, pending: true };
      }
      return { charge: confirmed.charge };
    },
    [address, getClientForChain],
  );
}
