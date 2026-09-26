import { merchantDb } from '../config/merchantDb.js';
import type { ChargeRow } from './chargeStore.js';

/**
 * What a member sees about a charge beyond its amount: who raised it, and what it is for.
 *
 * "Raised by Jen · 2:14pm" and "What's included · 9 items, tax included" on the pay screen. The
 * items are the order's lines when the charge came from a sale at the counter, and nothing when it
 * was a plain amount. Only the first name of whoever raised it: that is all a customer is told at
 * the counter too.
 *
 * Best effort. A charge the member can answer is never withheld because these could not be read.
 */
export interface ChargeContents {
  raisedBy: string | null;
  items: { name: string; quantity: number; cents: number }[] | null;
  taxCents: number | null;
  discountCents: number | null;
  /** The order's whole total, when this charge is only part of it (the rest paid another way). */
  orderTotalCents: number | null;
}

const EMPTY: ChargeContents = { raisedBy: null, items: null, taxCents: null, discountCents: null, orderTotalCents: null };

export async function chargeContents(charge: ChargeRow): Promise<ChargeContents> {
  const db = await merchantDb().catch(() => null);
  if (!db) return EMPTY;
  try {
    const [staff, orders] = await Promise.all([
      charge.raisedBy
        ? db.query<{ name: string }>('SELECT name FROM merchant.staff WHERE id = $1', [charge.raisedBy])
        : Promise.resolve({ rows: [] as { name: string }[] }),
      db.query<{ id: string; tax_cents: string; discount_cents: string; total_cents: string }>(
        `SELECT o.id, o.tax_cents, o.discount_cents, o.total_cents FROM payments.tenders t
           JOIN commerce.orders o ON o.id = t.order_id
          WHERE t.clear_charge_code = $1
          LIMIT 1`,
        [charge.code],
      ),
    ]);
    const first = staff.rows[0]?.name.trim().split(/\s+/)[0] || null;
    const order = orders.rows[0];
    if (!order) return { ...EMPTY, raisedBy: first };
    const { rows: lines } = await db.query<{ name: string; quantity: number; line_cents: string }>(
      `SELECT name, quantity, line_cents FROM commerce.order_lines
        WHERE order_id = $1 AND removed_at IS NULL
        ORDER BY position, id`,
      [order.id],
    );
    const total = Number(order.total_cents);
    return {
      raisedBy: first,
      items: lines.map((l) => ({ name: l.name, quantity: Number(l.quantity), cents: Number(l.line_cents) })),
      taxCents: Number(order.tax_cents),
      discountCents: Number(order.discount_cents),
      orderTotalCents: total !== charge.amountCents ? total : null,
    };
  } catch (error) {
    console.error('[charge] contents read failed for', charge.code, error instanceof Error ? error.message : error);
    return EMPTY;
  }
}
