import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { chargeStore, type ChargeRow } from '../chargeStore.js';
import { notificationStore } from '../notificationStore.js';
import { paidNowRefundLegs, refundChain } from '../paidNowRefund.js';
import { usdcAddressFor } from '../savingsGaslessService.js';
import { disputeStore, type DisputeRecord } from './disputeStore.js';
import { alertOps } from '../opsAlert.js';

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
    await alertOps({
      key: `dispute:${dispute.token}:hold`,
      subject: `Dispute ${dispute.token}: a hold may be mid-transfer`,
      body: `Holding ${usd(shopCents)} from ${charge.merchantAddress}'s Clear cash for charge ${charge.code} was started and has no transaction to check. Look for a USDC transfer from the shop to Clear's hold (${clear ?? 'the operator wallet'}), then set held_detail.holdTx to its hash, or clear it if none was sent.`,
    });
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

type Outcome = 'member' | 'shop';
type LegKey = 'shop' | 'clear';
interface Leg {
  key: LegKey;
  from: 'shop' | 'clear';
  to: string;
  cents: number;
}
interface Release {
  outcome: Outcome;
  /** Per leg: `sending` while it may be moving, its hash once sent, absent before. */
  legs: Partial<Record<LegKey, string>>;
  error?: string | null;
}

/** What moves for a decision, given whether the shop's share was actually held. */
function legsFor(charge: ChargeRow, outcome: Outcome, heldCents: number): Leg[] {
  const member = (charge.memberWallet ?? '').toLowerCase();
  const { shopCents, clearCents } = paidNowRefundLegs(charge);
  if (outcome === 'member') {
    // Held: Clear has the shop's share and its own fee, so all of it comes back from Clear. Not held:
    // the shop's share straight from the shop, then Clear's fee.
    return heldCents > 0
      ? [{ key: 'clear', from: 'clear', to: member, cents: heldCents + clearCents }]
      : [
          { key: 'shop', from: 'shop', to: member, cents: shopCents },
          { key: 'clear', from: 'clear', to: member, cents: clearCents },
        ];
  }
  // The purchase stands: the held share goes back to the shop. Nothing held, nothing to move.
  return heldCents > 0 ? [{ key: 'clear', from: 'clear', to: charge.merchantAddress, cents: heldCents }] : [];
}

/**
 * Settle a decided dispute's money: start it (from resolveDispute) or finish it (from the sweep).
 * Returns true once everything has moved and the charge says what happened; false while anything is
 * still to go, with the dispute left `releasing` so the sweep comes back to it.
 *
 * Safe to run again at any point. Each transfer is recorded as `sending`, then its hash; a hash is
 * asked of the chain before it is trusted (landed: done; failed or unknown: sent again; still
 * pending: wait). The one thing never retried blind is `sending` without a hash — a transfer that
 * may have left with nothing to check it by — and that is the only case that needs a person.
 */
export async function releasePaidNow(dispute: DisputeRecord, charge: ChargeRow, memberWon: boolean): Promise<boolean> {
  const token = usdcAddressFor(charge.chainId);
  const detail = { ...(dispute.heldDetail ?? {}) } as Partial<PaidNowHold> & { release?: Release };
  const heldCents = detail.holdTx && detail.holdTx !== SENDING ? (detail.heldCents ?? 0) : 0;
  const release: Release = detail.release ?? { outcome: memberWon ? 'member' : 'shop', legs: {} };
  const save = async (error: string | null = null) => {
    release.error = error;
    await disputeStore.setHold(dispute.token, 'releasing', { ...detail, release });
  };
  if (!charge.memberWallet) return false;
  await save(release.error ?? null);

  for (const leg of legsFor(charge, release.outcome, heldCents)) {
    if (leg.cents <= 0) continue;
    const recorded = release.legs[leg.key];
    if (recorded === SENDING) {
      await alertOps({
        key: `dispute:${dispute.token}:release:${leg.key}`,
        subject: `Dispute ${dispute.token}: a payout may be mid-transfer`,
        body: `Paying ${usd(leg.cents)} from ${leg.from === 'clear' ? "Clear's hold" : 'the shop'} to ${leg.to} for charge ${charge.code} was started and has no transaction to check. Look for that USDC transfer, then set held_detail.release.legs.${leg.key} to its hash, or remove it if none was sent; the sweep then finishes the rest.`,
      });
      await save(`The ${leg.key} transfer may have left without a record. Needs a person.`);
      return false;
    }
    if (recorded) {
      const receipt = await refundChain.receipt(charge.chainId, recorded);
      if (receipt?.status === 1) continue;
      if (!receipt && (await refundChain.known(charge.chainId, recorded))) return false; // still landing
      delete release.legs[leg.key]; // failed, or never mined: nothing moved, so it goes again
    }
    const units = BigInt(leg.cents) * UNITS_PER_CENT;
    try {
      if (leg.from === 'clear') {
        release.legs[leg.key] = SENDING;
        await save();
        const landed = await refundChain.sendFromClear(charge.chainId, token, leg.to, units, async (hash) => {
          release.legs[leg.key] = hash;
          await save();
        });
        if (!landed) throw new Error('the transfer reverted');
      } else {
        const shop = await refundChain.shopWallet(charge.merchantAddress);
        if ('error' in shop) throw Object.assign(new Error(shop.error), { nothingMoved: true });
        release.legs[leg.key] = SENDING;
        await save();
        const hash = await shop.send(token as Address, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [leg.to as Address, units] }));
        release.legs[leg.key] = hash.toLowerCase();
        await save();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[dispute] ${dispute.token} ${leg.key} transfer failed; the sweep retries it:`, message);
      // Nothing left the wallet: forget the marker so the next pass sends it. Otherwise (a hash was
      // recorded, or it may have left) the marker stays and the chain answers next time.
      const nothingMoved =
        (error as { nothingMoved?: boolean }).nothingMoved ||
        /reported the transaction (failed|execution_reverted|provider_error)/.test(message) ||
        (leg.from === 'clear' && release.legs[leg.key] === SENDING);
      if (nothingMoved) delete release.legs[leg.key];
      await save(message);
      return false;
    }
  }

  if (release.outcome === 'member') await chargeStore.refundAfterDispute(charge.code);
  else await chargeStore.restoreAfterDispute(charge.code, null, null);
  await save(null);
  return true;
}
