import { orderStatus, type OrderStatus, type TenderState } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { type Entry, entriesFor, post, reverse } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';

/**
 * Keeps an order and the ledger in step with its tenders. Called in the same transaction as every
 * tender change: authorised, approved, declined, voided, tip changed, refunded.
 *
 * **The invariant: an order has a live sale entry exactly when it's paid** (or refunded, partly or
 * wholly: a refund is its own entry and doesn't undo the sale). Paid and no sale: post one. A sale
 * and no longer paid (a card on it was voided): reverse it, and the tip adjustments made on top of
 * it. Paid again later: a fresh sale from the tenders as they stand then.
 */

export const SALE_KINDS = ['cash_sale', 'card_sale', 'clear_sale', 'split_sale'] as const;
const KEEPS_SALE: readonly OrderStatus[] = ['paid', 'refunded', 'partly_refunded'];

interface OrderRow {
  id: string;
  merchant: string;
  status: OrderStatus;
  subtotal_cents: string | number;
  discount_cents: string | number;
  tax_cents: string | number;
  total_cents: string | number;
  voided_at: Date | string | null;
}

interface TenderRow {
  id: string;
  method: TenderState['method'];
  status: TenderState['status'];
  amount_cents: string | number;
  tip_cents: string | number;
  refunded_cents: string | number;
  tip_staff_id: string | null;
  created_by: string;
}

const n = (v: string | number) => Number(v);

/** Live (unreversed) entries that make up the order's sale: the sale itself and tip adjustments on its tenders. */
async function liveSaleEntries(tx: Queryable, merchant: string, orderId: string, tenderIds: string[]): Promise<{ sales: Entry[]; adjustments: Entry[]; attempts: number }> {
  const forOrder = await entriesFor(tx, merchant, { type: 'order', id: orderId });
  const forTenders: Entry[] = [];
  for (const id of tenderIds) forTenders.push(...(await entriesFor(tx, merchant, { type: 'tender', id })));
  const { rows } = await tx.query<{ reverses: string }>(
    `SELECT reverses FROM ledger.journal_entries WHERE merchant = $1 AND reverses = ANY($2::text[])`,
    [merchant, [...forOrder, ...forTenders].map((e) => e.id)],
  );
  const reversed = new Set(rows.map((r) => r.reverses));
  const allSales = forOrder.filter((e) => (SALE_KINDS as readonly string[]).includes(e.kind));
  return {
    sales: allSales.filter((e) => !reversed.has(e.id)),
    adjustments: forTenders.filter((e) => e.kind === 'card_tip_adjusted' && !reversed.has(e.id)),
    attempts: allSales.length,
  };
}

export async function settleOrder(tx: Queryable, input: { merchant: string; orderId: string; actor: string | null }): Promise<OrderStatus> {
  const { rows: orders } = await tx.query<OrderRow>('SELECT * FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE', [input.orderId, input.merchant]);
  const order = orders[0];
  if (!order) throw new Error(`No order ${input.orderId} for this shop`);
  const { rows: tenders } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = $1 ORDER BY created_at, id', [order.id]);

  const states: TenderState[] = tenders.map((t) => ({
    method: t.method,
    status: t.status,
    amountCents: n(t.amount_cents),
    tipCents: n(t.tip_cents),
    refundedCents: n(t.refunded_cents),
  }));
  const summary = orderStatus({ totalCents: n(order.total_cents), voided: Boolean(order.voided_at) }, states);

  const live = await liveSaleEntries(tx, input.merchant, order.id, tenders.map((t) => t.id));
  const shouldHaveSale = KEEPS_SALE.includes(summary.status);

  if (!shouldHaveSale) {
    for (const e of [...live.adjustments, ...live.sales]) await reverse(tx, { merchant: input.merchant, entryId: e.id, createdBy: input.actor });
  } else if (live.sales.length === 0) {
    const taken = tenders.filter((t) => ['authorised', 'approved', 'captured', 'partly_refunded', 'refunded'].includes(t.status));
    await post(
      tx,
      postings.sale({
        merchant: input.merchant,
        orderId: order.id,
        subtotalCents: n(order.subtotal_cents),
        discountCents: n(order.discount_cents),
        taxCents: n(order.tax_cents),
        attempt: live.attempts,
        createdBy: input.actor,
        tenders: taken.map((t) => ({
          id: t.id,
          method: t.method,
          amountCents: n(t.amount_cents),
          tipCents: n(t.tip_cents),
          tipStaffId: t.tip_staff_id ?? t.created_by,
        })),
      }),
    );
  }

  await tx.query('UPDATE commerce.orders SET status = $2, tip_cents = $3, updated_at = now() WHERE id = $1', [order.id, summary.status, summary.tipCents]);
  return summary.status;
}
