/**
 * What a refund does beyond the merchant's own books.
 *
 * Settling the refund row and flagging the charge is the merchant half: a `refunded` charge drops
 * out of the payout query, so the money is clawed back on its own. The member's half was missing
 * entirely — their term plan stayed open, so the app kept showing an obligation for a purchase
 * that had been given back, and nobody told them it happened.
 *
 * Two things, in this order: close the plan, then say so. Never the reverse. A member told they
 * were refunded while their plan still runs is worse off than one who has not been told yet — they
 * would stop expecting the payments that are still coming.
 */
import { ethers } from 'ethers';
import { chargeStore, type ChargeRow } from './chargeStore.js';
import { notificationStore } from './notificationStore.js';
import { memberStore } from './memberStore.js';
import { sendNotificationService } from './sendNotificationService.js';
import { chainId, explainChainError } from './chargeService.js';
import { getContractAddress } from '../config/contracts.js';
import { savingsIntentService } from './savingsIntentService.js';

const TERM_ABI = [
  'function planAt(uint256 planId) view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function closePlanForRefund(uint256 planId, uint256 amount, address merchant, uint256 payout) returns (uint256)',
];

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export interface SettleResult {
  ok: boolean;
  reason?: string;
  /** Set when a plan was paid down. Absent when there was nothing left to close. */
  txHash?: string;
}

/**
 * Unwind the member's plan by what is being given back.
 *
 * `closePlanForRefund`, not `payPlan`. A payment brings reserve tokens in to settle an obligation;
 * a refund undoes the entry that created one. Origination was capital-free, so this is too — which
 * is why no wallet needs funding for a refund to work.
 *
 * The legs are reconstructed from the charge, proportionally for a partial refund, and StableCredit
 * asserts they net. Rounding is given to the discount rather than the payout: the co-op absorbing a
 * cent is better than a merchant being clawed back one they were never paid.
 */
async function closePlan(charge: ChargeRow, amountCents: number): Promise<SettleResult> {
  if (charge.planId == null) {
    // Nothing was opened, so there is nothing to close. Not a failure: a charge can be refunded
    // before it ever became a plan.
    return { ok: true };
  }

  const address = getContractAddress(chainId(), 'TermIssuer');
  if (!address) return { ok: false, reason: 'no term issuer on this chain' };
  const key = operatorKey();
  if (!key) return { ok: false, reason: 'no credit operator configured' };

  try {
    const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId()));
    const issuer = new ethers.Contract(address, TERM_ABI, new ethers.Wallet(key, provider));

    const plan = await issuer.planAt(charge.planId);
    const [, , principalOutstanding, , , , , , closed] = plan;
    // Already settled — by an earlier attempt at this same refund, or by the member paying it off.
    // Either way the member owes nothing on it, which is where this was trying to get to.
    if (closed || principalOutstanding === 0n) return { ok: true };

    const owed: bigint = principalOutstanding;
    const asked = BigInt(amountCents) * 10_000n;
    const giving = asked < owed ? asked : owed;

    // The merchant's share of what is being given back, in the same proportion as the sale. Floor
    // division, so the remainder falls to the co-op's discount.
    const payoutShare =
      charge.amountCents > 0
        ? (BigInt(charge.payoutCents) * giving) / BigInt(charge.amountCents)
        : 0n;

    const tx = await issuer.closePlanForRefund(
      charge.planId,
      giving,
      charge.merchantAddress,
      payoutShare,
    );
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt?.hash ?? tx.hash };
  } catch (error) {
    console.error('[refund] closePlanForRefund failed for charge', charge.code, error);
    return { ok: false, reason: explainRefundFailure(error) };
  }
}

/** The merchant is the reader here, so the sentence is theirs — and it names what to do. */
function explainRefundFailure(error: unknown): string {
  return explainChainError(error).replace('approve this charge', 'settle this refund');
}

/** Told on every channel the charge alert uses, because it is the same member and the same shop. */
async function notifyMember(charge: ChargeRow, amountCents: number): Promise<void> {
  if (!charge.memberWallet) return;
  const amount = (amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  await notificationStore.emit({
    wallet: charge.memberWallet,
    kind: 'received',
    title: `${charge.merchantName} refunded ${amount}`,
    body: 'It has been taken off what you owe. Nothing more is due on it.',
    data: { chargeCode: charge.code, amountCents },
    // Keyed on the charge, so a retried settlement cannot tell somebody twice.
    dedupeKey: `refund:${charge.code}`,
  });

  try {
    const contact = await memberStore.getContactByWallet(charge.memberWallet);
    // Null means they opted out of notifications, which is a decision to respect rather than a
    // lookup that failed.
    const destination = contact?.phone ?? contact?.email;
    if (!destination) return;
    await sendNotificationService.sendRefundAlert({
      recipientType: contact?.phone ? 'phone' : 'email',
      recipientContact: destination,
      merchantName: charge.merchantName,
      amount,
    });
  } catch (error) {
    // Never fatal. The refund has already happened on chain and the member has it in-app; failing
    // here would leave the merchant staring at an error for a refund that went through.
    console.error('[refund] contact alert failed', error instanceof Error ? error.message : error);
  }
}

/**
 * Close the plan, mark the charge, then tell the member. Returns false when the chain half did not
 * happen, so the caller can put the refund back rather than settle a half of it.
 */
export async function settleRefund(
  chargeCode: string,
  amountCents: number,
): Promise<SettleResult> {
  const charge = await chargeStore.get(chargeCode);
  if (!charge) return { ok: false, reason: 'no such charge' };

  const closed = await closePlan(charge, amountCents);
  if (!closed.ok) return closed;

  await chargeStore.markRefunded(chargeCode);
  await notifyMember(charge, amountCents);
  return closed;
}
