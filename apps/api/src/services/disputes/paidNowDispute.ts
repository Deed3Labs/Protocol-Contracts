import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { chargeStore, type ChargeRow } from '../chargeStore.js';
import { notificationStore } from '../notificationStore.js';
import { paidNowRefundLegs, refundChain } from '../paidNowRefund.js';
import { usdcAddressFor } from '../savingsGaslessService.js';
import { disputeStore, type DisputeRecord } from './disputeStore.js';

/*
 * A dispute on a charge the member paid now, from their Clear cash.
 *
 * A plan charge is held by unwinding the plan. A paid-now charge has no plan: the money is already in
 * the shop's wallet. So it is held the way a card chargeback holds it — the shop's share moves from
 * the shop's Clear cash into Clear's hold until the dispute is decided:
 *
 *   open            the shop's share → Clear's hold. Short of it, the hold waits (the sweep retries)
 *                   and the shop is told how much to add.
 *   member wins     the whole amount back to the member: the held share and Clear's fee, from Clear.
 *                   (A hold that never landed: the shop's share straight from the shop, as a refund.)
 *   shop wins, or   the held share back to the shop's Clear cash.
 *   withdrawn
 *
 * Clear's hold is the operator wallet that also returns fees on refunds (paidNowRefund). Holding is
 * marked `sending` before it moves and never re-sent blind, the same rule as a refund's halves.
 */

const UNITS_PER_CENT = 10_000n;
const SENDING = 'sending';
const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface PaidNowHold {
  paidNow: true;
  heldCents?: number;
  holdTx?: string | null;
  pending?: boolean;
  error?: string | null;
}

const detailOf = (dispute: DisputeRecord) => (dispute.heldDetail ?? {}) as Partial<PaidNowHold>;

export async function holdPaidNow(dispute: DisputeRecord, charge: ChargeRow): Promise<void> {
  const token = usdcAddressFor(charge.chainId);
  const clear = refundChain.clearAddress();
  const { shopCents } = paidNowRefundLegs(charge);
  const units = BigInt(shopCents) * UNITS_PER_CENT;
  const detail = detailOf(dispute);
  const pending = async (error: string, extra: Partial<PaidNowHold> = {}) =>
    disputeStore.setHold(dispute.token, 'held', { paidNow: true, pending: true, error, holdTx: null, ...extra });

  if (shopCents === 0) return disputeStore.setHold(dispute.token, 'held', { paidNow: true, heldCents: 0 });
  if (detail.holdTx === SENDING) {
    console.error(`[dispute] ${dispute.token}: a paid-now hold may be mid-transfer; needs a person before it is retried`);
    return;
  }
  if (detail.holdTx) {
    const receipt = await refundChain.receipt(charge.chainId, detail.holdTx);
    if (receipt?.status === 1) return disputeStore.setHold(dispute.token, 'held', { paidNow: true, heldCents: shopCents, holdTx: detail.holdTx });
    if (!receipt && (await refundChain.known(charge.chainId, detail.holdTx))) return; // still landing
  }
  if (!token || !clear) return pending('Clear cannot hold funds on this server.');

  const shop = await refundChain.shopWallet(charge.merchantAddress);
  if ('error' in shop) return pending(shop.error);
  const held = await refundChain.balance(charge.chainId, token, shop.address);
  if (held < units) {
    await pending(`The shop’s Clear cash holds ${usd(Number(held / UNITS_PER_CENT))}; ${usd(shopCents)} is needed.`);
    await notificationStore
      .emit({
        wallet: charge.merchantAddress,
        kind: 'system',
        title: 'A charge is in dispute',
        body: `A member disputed ${charge.code}, paid now. ${usd(shopCents)} is held from your Clear cash while it is open; add cash so it can be.`,
        data: { code: charge.code, dispute: dispute.token },
        dedupeKey: `dispute:${dispute.token}:merchant-short`,
      })
      .catch(() => null);
    return;
  }

  await disputeStore.setHold(dispute.token, 'held', { paidNow: true, pending: true, holdTx: SENDING });
  try {
    const hash = await shop.send(token as Address, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [clear as Address, units] }));
    await disputeStore.setHold(dispute.token, 'held', { paidNow: true, heldCents: shopCents, holdTx: hash.toLowerCase(), pending: false, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dispute] ${dispute.token} paid-now hold failed:`, message);
    // Privy saying it failed means nothing moved; anything else stays `sending` for a person.
    if (/reported the transaction (failed|execution_reverted|provider_error)/.test(message)) await pending('The hold did not go through; retrying.');
    return;
  }

  await notificationStore
    .emit({
      wallet: charge.merchantAddress,
      kind: 'system',
      title: 'A charge is in dispute',
      body: `A member disputed ${charge.code}, paid now. ${usd(shopCents)} is held from your Clear cash while it is open; Clear will ask for your side.`,
      data: { code: charge.code, dispute: dispute.token },
      dedupeKey: `dispute:${dispute.token}:merchant`,
    })
    .catch(() => null);
}

/**
 * Settle a decided dispute's money. Called once (resolveDispute closes the dispute first). A transfer
 * that fails is logged for a person and noted on the dispute, the same as a card re-issue: nothing
 * retries a decision.
 */
export async function releasePaidNow(dispute: DisputeRecord, charge: ChargeRow, memberWon: boolean): Promise<void> {
  const token = usdcAddressFor(charge.chainId);
  const detail = detailOf(dispute);
  const heldCents = detail.holdTx && detail.holdTx !== SENDING ? (detail.heldCents ?? 0) : 0;
  const member = charge.memberWallet as Address | null;
  const note = (extra: Record<string, unknown>) => disputeStore.setHold(dispute.token, 'held', { ...detail, ...extra });
  const fromClear = async (to: string, cents: number) => {
    if (cents <= 0) return null;
    let hash: string | null = null;
    const landed = await refundChain.sendFromClear(charge.chainId, token, to, BigInt(cents) * UNITS_PER_CENT, async (h) => {
      hash = h;
    });
    if (!landed) throw new Error(`reverted${hash ? ` (${hash})` : ''}`);
    return hash;
  };

  try {
    if (memberWon) {
      if (!member) return;
      const { shopCents, clearCents } = paidNowRefundLegs(charge);
      if (heldCents > 0) {
        // Clear holds the shop's share, and has its own fee: all of it back from Clear.
        const tx = await fromClear(member, heldCents + clearCents);
        await note({ releaseTx: tx });
      } else {
        // The hold never landed: the shop's share straight from the shop, then Clear's fee.
        const shop = await refundChain.shopWallet(charge.merchantAddress);
        if ('error' in shop) throw new Error(shop.error);
        const shopTx = await shop.send(token as Address, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [member, BigInt(shopCents) * UNITS_PER_CENT] }));
        const clearTx = await fromClear(member, clearCents);
        await note({ releaseTx: clearTx, releaseShopTx: shopTx });
      }
      await chargeStore.refundAfterDispute(charge.code);
      return;
    }
    // The purchase stands: the held share goes back to the shop.
    const tx = heldCents > 0 ? await fromClear(charge.merchantAddress, heldCents) : null;
    await note({ releaseTx: tx });
    await chargeStore.restoreAfterDispute(charge.code, null, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dispute] ${dispute.token} paid-now release failed; needs a person:`, message);
    await note({ releaseError: message }).catch(() => null);
  }
}
