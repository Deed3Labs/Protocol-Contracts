import type { TenderMethod } from '@clear/merchant-contracts';
import { type AccountCode, tipsPayable } from './accounts.js';
import type { EntryInput, LineInput } from './ledgerService.js';

/**
 * What each money event posts (card-processing prompt, Phase 2). Pure: each builder returns the
 * entry, and the caller posts it through the ledger service inside the same transaction as the
 * change it records. Each carries an idempotency key made from the fact itself, so posting the same
 * fact twice (a retried request, a redelivered webhook) finds the first entry.
 *
 * **When a sale is recognised.** At the moment the order is paid: every tender has taken its part.
 * A card is authorised at the tap and captured at Close the day, but the sale happened at the tap,
 * and a split order's cash half can't wait for tonight's capture. So the sale debits
 * `card_receivable` for the card part straight away, and capture itself posts nothing unless the
 * amount changed (a tip adjusted before capture posts its own entry). A void before capture
 * reverses the sale.
 *
 * Processor fees aren't known at the tap. Stripe's fee and Clear's are recorded when payout data
 * arrives (cardPayout), from Stripe's own figures, never from our fee rule.
 */

type Base = { merchant: string; occurredAt?: Date | string; createdBy?: string | null };

const RECEIVING: Record<TenderMethod, AccountCode> = {
  cash: 'drawer_cash',
  card: 'card_receivable',
  clear: 'clear_receivable',
};

/** Drops zero lines, so a sale with no tip or no discount doesn't need special-casing. */
const lines = (...ls: LineInput[]): LineInput[] => ls.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);

export interface SaleTender {
  id: string;
  method: TenderMethod;
  amountCents: number;
  tipCents: number;
  /** Who the tip belongs to. Required when there is a tip. */
  tipStaffId: string | null;
}

/**
 * An order paid in full. Debits what each tender took (cash into the drawer, card and Clear as
 * receivables) and the discount; credits sales at the undiscounted subtotal, the tax owed, and each
 * person's tips.
 */
export function sale(
  input: Base & { orderId: string; subtotalCents: number; discountCents: number; taxCents: number; tenders: SaleTender[] },
): EntryInput {
  const total = input.subtotalCents - input.discountCents + input.taxCents;
  const paid = input.tenders.reduce((s, t) => s + t.amountCents, 0);
  if (paid !== total) throw new Error(`The tenders pay ${paid}, but the order is ${total}`);

  const byAccount = new Map<AccountCode, number>();
  const add = (account: AccountCode, cents: number) => byAccount.set(account, (byAccount.get(account) ?? 0) + cents);
  const tips = new Map<AccountCode, number>();
  for (const t of input.tenders) {
    add(RECEIVING[t.method], t.amountCents + t.tipCents);
    if (t.tipCents > 0) {
      if (!t.tipStaffId) throw new Error(`Tender ${t.id} has a tip with no one to give it to`);
      const acct = tipsPayable(t.tipStaffId);
      tips.set(acct, (tips.get(acct) ?? 0) + t.tipCents);
    }
  }

  const methods = new Set(input.tenders.map((t) => t.method));
  return {
    merchant: input.merchant,
    kind: methods.size === 1 ? `${[...methods][0]}_sale` : 'split_sale',
    idempotencyKey: `sale:${input.orderId}`,
    ref: { type: 'order', id: input.orderId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: lines(
      ...[...byAccount].map(([account, debit]) => ({ account, debit })),
      { account: 'discounts', debit: input.discountCents },
      { account: 'sales', credit: input.subtotalCents },
      { account: 'tax_payable', credit: input.taxCents },
      ...[...tips].map(([account, credit]) => ({ account, credit })),
    ),
  };
}

/**
 * A card tip changed before capture. Posts only the difference; `adjustmentId` names this change,
 * so changing a tip back and forth posts each change once.
 */
export function cardTipAdjusted(
  input: Base & { tenderId: string; adjustmentId: string; staffId: string; fromCents: number; toCents: number },
): EntryInput | null {
  const delta = input.toCents - input.fromCents;
  if (delta === 0) return null;
  const tips = tipsPayable(input.staffId);
  return {
    merchant: input.merchant,
    kind: 'card_tip_adjusted',
    idempotencyKey: `tip_adjust:${input.adjustmentId}`,
    ref: { type: 'tender', id: input.tenderId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines:
      delta > 0
        ? [{ account: 'card_receivable', debit: delta }, { account: tips, credit: delta }]
        : [{ account: tips, debit: -delta }, { account: 'card_receivable', credit: -delta }],
  };
}

/** Cash tips handed to someone out of the drawer. */
export function tipPaidOut(input: Base & { payoutId: string; staffId: string; sessionId: string; cents: number }): EntryInput {
  return {
    merchant: input.merchant,
    kind: 'tip_paid_out',
    idempotencyKey: `tip_paid:${input.payoutId}`,
    ref: { type: 'drawer_session', id: input.sessionId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: [
      { account: tipsPayable(input.staffId), debit: input.cents },
      { account: 'drawer_cash', credit: input.cents },
    ],
  };
}

/**
 * The drawer counted at close against what the ledger says it should hold. Short: an expense and
 * less cash. Over: more cash and a negative expense. Even: nothing to post.
 */
export function drawerDifference(input: Base & { sessionId: string; differenceCents: number }): EntryInput | null {
  const d = input.differenceCents;
  if (d === 0) return null;
  return {
    merchant: input.merchant,
    kind: d < 0 ? 'drawer_short' : 'drawer_over',
    idempotencyKey: `drawer_difference:${input.sessionId}`,
    ref: { type: 'drawer_session', id: input.sessionId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines:
      d < 0
        ? [{ account: 'cash_over_short', debit: -d }, { account: 'drawer_cash', credit: -d }]
        : [{ account: 'drawer_cash', debit: d }, { account: 'cash_over_short', credit: d }],
  };
}

/** At close: the cash for the bank leaves the drawer. */
export function depositLeftDrawer(input: Base & { depositId: string; amountCents: number }): EntryInput {
  return {
    merchant: input.merchant,
    kind: 'deposit_left_drawer',
    idempotencyKey: `deposit_out:${input.depositId}`,
    ref: { type: 'bank_deposit', id: input.depositId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: [
      { account: 'cash_in_transit_to_bank', debit: input.amountCents },
      { account: 'drawer_cash', credit: input.amountCents },
    ],
  };
}

/** Someone marked the deposit as taken in: it's in the bank. */
export function depositMarked(input: Base & { depositId: string; amountCents: number }): EntryInput {
  return {
    merchant: input.merchant,
    kind: 'deposit_marked',
    idempotencyKey: `deposit_in:${input.depositId}`,
    ref: { type: 'bank_deposit', id: input.depositId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: [
      { account: 'bank', debit: input.amountCents },
      { account: 'cash_in_transit_to_bank', credit: input.amountCents },
    ],
  };
}

/**
 * A cash or card refund. The sale isn't edited: `refunds` (contra-revenue) takes the goods part,
 * and the tax and any tip handed back come off what the shop owes. Cash leaves the drawer; a card
 * refund comes out of the processor balance, so off the receivable.
 *
 * A Clear refund is not posted here: it goes through the Clear refund flow (the seam).
 */
export function refund(
  input: Base & {
    refundId: string;
    method: Exclude<TenderMethod, 'clear'>;
    amountCents: number;
    taxCents?: number;
    tip?: { staffId: string; cents: number } | null;
  },
): EntryInput {
  const tax = input.taxCents ?? 0;
  const tip = input.tip?.cents ?? 0;
  const goods = input.amountCents - tax - tip;
  if (goods < 0) throw new Error('The tax and tip refunded are more than the refund');
  return {
    merchant: input.merchant,
    kind: `${input.method}_refund`,
    idempotencyKey: `refund:${input.refundId}`,
    ref: { type: 'refund', id: input.refundId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    lines: lines(
      { account: 'refunds', debit: goods },
      { account: 'tax_payable', debit: tax },
      ...(input.tip && tip > 0 ? [{ account: tipsPayable(input.tip.staffId), debit: tip }] : []),
      { account: RECEIVING[input.method], credit: input.amountCents },
    ),
  };
}

/**
 * A card payout, from Stripe's figures: the gross it settles comes off the receivable, the net
 * lands in the bank, and the difference is card processing, with Stripe's fee and Clear's
 * application fee as separate lines so the deposit can show both.
 */
export function cardPayout(
  input: Base & { payoutId: string; grossCents: number; stripeFeeCents: number; clearFeeCents: number },
): EntryInput {
  const net = input.grossCents - input.stripeFeeCents - input.clearFeeCents;
  if (net < 0) throw new Error('Fees are more than the payout');
  return {
    merchant: input.merchant,
    kind: 'card_payout',
    idempotencyKey: `payout:${input.payoutId}`,
    ref: { type: 'payout', id: input.payoutId },
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    memo: 'Card processing: Stripe fee, then Clear fee',
    lines: lines(
      { account: 'bank', debit: net },
      { account: 'card_processing_expense', debit: input.stripeFeeCents },
      { account: 'card_processing_expense', debit: input.clearFeeCents },
      { account: 'card_receivable', credit: input.grossCents },
    ),
  };
}
