import type { OrderStatus, TenderMethod, TenderStatus } from './orders';

/**
 * The order and tender state machines, as pure functions. The API moves tenders through
 * `tenderTransition` and derives the order's status with `orderStatus`; the app uses the same
 * functions to show the same states.
 *
 * - A card is authorised at the tap and captured at Close the day. Until then it can be voided
 *   (cancelled, no fee) or have its tip adjusted.
 * - Cash and Clear are approved outright: cash when it's handed over, Clear when the member
 *   approves on their phone.
 * - Split payments: a tender that fails doesn't undo the ones that succeeded. The order keeps a
 *   remaining balance.
 */

export interface TenderState {
  method: TenderMethod;
  status: TenderStatus;
  amountCents: number;
  tipCents: number;
  refundedCents: number;
}

export type TenderEvent =
  | { type: 'authorise' }
  | { type: 'approve' }
  | { type: 'decline' }
  | { type: 'cancel' }
  | { type: 'adjust_tip'; tipCents: number }
  | { type: 'capture' }
  | { type: 'refund'; cents: number };

export type TransitionResult<S> = { ok: true; state: S } | { ok: false; reason: string };

const refusal = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Where a tender's money counts toward the order: taken, even if later refunded. */
export const TAKEN: readonly TenderStatus[] = ['authorised', 'approved', 'captured', 'partly_refunded', 'refunded'];

export function tenderTransition(t: TenderState, e: TenderEvent): TransitionResult<TenderState> {
  const to = (status: TenderStatus, patch: Partial<TenderState> = {}) => ({ ok: true as const, state: { ...t, ...patch, status } });
  switch (e.type) {
    case 'authorise':
      if (t.method !== 'card') return refusal('Only a card is authorised; cash and Clear are approved.');
      return t.status === 'pending' ? to('authorised') : refusal(`A ${t.status} tender can't be authorised.`);
    case 'approve':
      if (t.method === 'card') return refusal('A card is authorised, then captured.');
      return t.status === 'pending' ? to('approved') : refusal(`A ${t.status} tender can't be approved.`);
    case 'decline':
      if (t.method === 'cash') return refusal('Cash is not declined.');
      return t.status === 'pending' ? to('declined') : refusal(`A ${t.status} tender can't be declined.`);
    case 'cancel':
      // A void: before the tap, or an authorised card before capture. Cash handed over, a captured
      // card and an approved Clear charge are refunded instead.
      if (t.status === 'pending' || (t.method === 'card' && t.status === 'authorised')) return to('cancelled');
      return refusal(`A ${t.status} ${t.method} tender is refunded, not cancelled.`);
    case 'adjust_tip':
      if (!Number.isInteger(e.tipCents) || e.tipCents < 0) return refusal('A tip is a whole number of cents.');
      if (t.method === 'card' && t.status === 'authorised') return to('authorised', { tipCents: e.tipCents });
      return refusal('A tip changes only on an authorised card, before Close the day captures it.');
    case 'capture':
      if (t.method !== 'card') return refusal('Only a card is captured.');
      return t.status === 'authorised' ? to('captured') : refusal(`A ${t.status} tender can't be captured.`);
    case 'refund': {
      // SEAM: refunding a Clear tender unwinds a member's plan through the protocol, which is an
      // open question and deliberately not implemented here (card-processing prompt, scope).
      if (t.method === 'clear') return refusal('A Clear refund goes through the Clear refund flow.');
      if (!Number.isInteger(e.cents) || e.cents <= 0) return refusal('A refund is a positive number of cents.');
      const refundable = t.method === 'card' ? ['captured', 'partly_refunded'] : ['approved', 'partly_refunded'];
      if (!refundable.includes(t.status)) {
        return refusal(t.status === 'authorised' ? 'An uncaptured card is voided, not refunded.' : `A ${t.status} tender can't be refunded.`);
      }
      const taken = t.amountCents + t.tipCents;
      const refunded = t.refundedCents + e.cents;
      if (refunded > taken) return refusal('That is more than was paid.');
      return to(refunded === taken ? 'refunded' : 'partly_refunded', { refundedCents: refunded });
    }
  }
}

export interface OrderState {
  totalCents: number;
  voided: boolean;
}

export interface OrderSummary {
  status: OrderStatus;
  /** Toward the total, by tenders that took money. Tips aside. */
  paidCents: number;
  remainingCents: number;
  refundedCents: number;
  tipCents: number;
}

/**
 * An order's status, from its tenders. A declined or cancelled tender takes nothing, so a split
 * whose card part is declined keeps its cash part and shows what's left.
 */
export function orderStatus(order: OrderState, tenders: readonly TenderState[]): OrderSummary {
  const took = tenders.filter((t) => TAKEN.includes(t.status));
  const paidCents = took.reduce((s, t) => s + t.amountCents, 0);
  const tipCents = took.reduce((s, t) => s + t.tipCents, 0);
  const refundedCents = took.reduce((s, t) => s + t.refundedCents, 0);
  const remainingCents = Math.max(0, order.totalCents - paidCents);
  const summary = { paidCents, remainingCents, refundedCents, tipCents };
  if (order.voided) return { status: 'voided', ...summary };
  if (paidCents < order.totalCents || order.totalCents === 0) {
    return { status: paidCents === 0 && !tenders.some((t) => t.status === 'pending') ? 'open' : 'paying', ...summary };
  }
  const takenWithTips = paidCents + tipCents;
  if (refundedCents === 0) return { status: 'paid', ...summary };
  return { status: refundedCents >= takenWithTips ? 'refunded' : 'partly_refunded', ...summary };
}

/**
 * Voiding an order: a same-day undo, before anything is captured. Authorised cards are cancelled
 * (no fee), and any cash goes back out of the drawer. After a capture only a refund remains.
 */
export function canVoidOrder(order: OrderState, tenders: readonly TenderState[]): { ok: true } | { ok: false; reason: string } {
  if (order.voided) return refusal('It is already voided.');
  const settled = tenders.find((t) => t.status === 'captured' || t.status === 'partly_refunded' || t.status === 'refunded');
  if (settled) return refusal('A card on it has been captured, so it can only be refunded.');
  if (tenders.some((t) => t.method === 'clear' && t.status === 'approved')) {
    return refusal('A Clear payment on it is approved, so it goes through the Clear refund flow.');
  }
  return { ok: true };
}
