import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../../db/db.js';

/**
 * What a succeeded refund does to the books and the shelf, the same for card and cash
 * (card-processing prompt, Phase 6):
 *
 *   tax    the tax on the lines that came back, rather than a flat share of the order's
 *   tip    the part of the refund beyond what the tender paid for goods is tip given back
 *   stock  lines marked "back in stock" go back on the shelf, as a return tied to their line
 *   next   `refund.succeeded` in the outbox, for reversing the tax recorded at Stripe
 */

export interface RefundItem {
  orderLineId: string;
  quantity: number;
  backInStock: boolean;
}

export function itemsOf(raw: unknown): RefundItem[] {
  const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(items) ? (items as RefundItem[]) : [];
}

/**
 * How a refund of `amountCents` splits into goods, tax and tip, for a tender that has already had
 * `alreadyRefundedCents` back.
 */
export async function refundSplit(
  tx: Queryable,
  input: { orderId: string; amountCents: number; tenderAmountCents: number; alreadyRefundedCents: number; items: RefundItem[] },
): Promise<{ taxCents: number; tipCents: number }> {
  const goodsAndTax = Math.min(input.amountCents, input.tenderAmountCents - Math.min(input.alreadyRefundedCents, input.tenderAmountCents));
  const tipCents = input.amountCents - goodsAndTax;
  let taxCents: number;
  if (input.items.length > 0) {
    const { rows } = await tx.query<{ id: string; quantity: number; tax_cents: string | number }>(
      'SELECT id, quantity, tax_cents FROM commerce.order_lines WHERE order_id = $1 AND id = ANY($2::text[])',
      [input.orderId, input.items.map((i) => i.orderLineId)],
    );
    taxCents = input.items.reduce((sum, i) => {
      const line = rows.find((r) => r.id === i.orderLineId);
      return sum + (line ? Math.round((Number(line.tax_cents) * i.quantity) / line.quantity) : 0);
    }, 0);
  } else {
    const { rows } = await tx.query<{ tax_cents: string | number; total_cents: string | number }>('SELECT tax_cents, total_cents FROM commerce.orders WHERE id = $1', [input.orderId]);
    const o = rows[0]!;
    taxCents = Number(o.total_cents) > 0 ? Math.floor((goodsAndTax * Number(o.tax_cents)) / Number(o.total_cents)) : 0;
  }
  return { taxCents: Math.min(taxCents, goodsAndTax), tipCents };
}

/** Lines marked "back in stock" go back on the shelf. Anything else stays off it (damaged, used up). */
export async function restock(tx: Queryable, input: { merchant: string; refundId: string; items: RefundItem[]; actor: string | null }): Promise<void> {
  for (const i of input.items.filter((x) => x.backInStock)) {
    const { rows } = await tx.query<{ item_id: string | null; stock_tracked: boolean | null }>(
      'SELECT l.item_id, c.stock_tracked FROM commerce.order_lines l LEFT JOIN commerce.catalog_items c ON c.id = l.item_id WHERE l.id = $1',
      [i.orderLineId],
    );
    const line = rows[0];
    if (!line?.item_id || !line.stock_tracked) continue;
    await tx.query('SELECT 1 FROM commerce.catalog_items WHERE id = $1 FOR UPDATE', [line.item_id]);
    await tx.query(
      `INSERT INTO commerce.stock_movements (id, merchant, item_id, kind, quantity, reason, order_line_id, actor) VALUES ($1,$2,$3,'return',$4,$5,$6,$7)`,
      [`mov_${randomUUID()}`, input.merchant, line.item_id, i.quantity, `refund ${input.refundId}`, i.orderLineId, input.actor],
    );
  }
}

export async function announceRefund(tx: Queryable, input: { merchant: string; refundId: string; orderId: string }): Promise<void> {
  await tx.query(
    `INSERT INTO payments.outbox (merchant, topic, dedupe_key, payload) VALUES ($1, 'refund.succeeded', $2, $3) ON CONFLICT (dedupe_key) DO NOTHING`,
    [input.merchant, `refund.succeeded:${input.refundId}`, JSON.stringify({ refundId: input.refundId, orderId: input.orderId })],
  );
}
