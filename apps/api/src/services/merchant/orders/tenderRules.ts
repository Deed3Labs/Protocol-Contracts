import type { Order, Tender } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { getSettings } from '../shop/shopService.js';

/**
 * What any new tender must fit, whichever way it's paid (card-processing prompt, Phase 6). Shared by
 * card, cash and Clear so the split and method settings mean the same thing for all three.
 */

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'order_closed'
      | 'over_remaining'
      | 'method_off'
      | 'split_off'
      | 'short'
      | 'invalid'
      | 'key_reused'
      | 'clear_refused'
      | 'not_voidable'
      | 'not_same_day'
      | 'approver_invalid'
      | 'drawer_closed',
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface TenderOrderRow {
  id: string;
  status: Order['status'];
  voided_at: unknown;
  total_cents: string | number;
  business_date: Date | string;
  raised_by: string;
}

/**
 * Checks, under the order's lock, that a new tender of `amountCents` by `method` fits: the order is
 * taking payments, the method is on, a second tender is allowed if splitting is off, and it's no
 * more than what's left (counting tenders still in flight).
 */
export async function checkNewTender(tx: Queryable, input: { merchant: string; orderId: string; method: Tender['method']; amountCents: number }): Promise<TenderOrderRow> {
  const { rows } = await tx.query<TenderOrderRow>('SELECT id, status, voided_at, total_cents, business_date, raised_by FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE', [
    input.orderId,
    input.merchant,
  ]);
  const order = rows[0];
  if (!order) throw new PaymentError('No such order', 'not_found');
  if (order.voided_at || !['open', 'paying'].includes(order.status)) throw new PaymentError('That order is not taking payments', 'order_closed');
  const settings = await getSettings(tx, input.merchant);
  const on = { card: settings.paymentMethods.card, cash: settings.paymentMethods.cash, clear: true }[input.method];
  if (!on) throw new PaymentError(`This shop has ${input.method} payments turned off in Settings`, 'method_off');
  const { rows: covered } = await tx.query<{ n: string | number; cents: string | number }>(
    `SELECT count(*) AS n, COALESCE(sum(amount_cents), 0) AS cents FROM payments.tenders
      WHERE order_id = $1 AND status IN ('pending','authorised','approved','captured','partly_refunded','refunded')`,
    [order.id],
  );
  const remaining = Number(order.total_cents) - Number(covered[0]!.cents);
  if (!settings.paymentMethods.split && (Number(covered[0]!.n) > 0 || input.amountCents !== remaining)) {
    throw new PaymentError('This shop takes one payment per order: splitting is off in Settings', 'split_off');
  }
  if (input.amountCents > remaining) throw new PaymentError(`Only ${remaining} cents are still owed on this order`, 'over_remaining');
  return order;
}

