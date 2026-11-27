import type { Queryable } from '../../../db/db.js';
import { TerminalError } from './errors.js';

const PAID = ['paid', 'refunded', 'partly_refunded'];

/**
 * A new order for a table becomes its tab (called from raising the order, inside its transaction).
 * The table is seated from now if it wasn't; a hold clears once the tab has its first item.
 */
export async function attachTab(tx: Queryable, input: { merchant: string; tableId: string; orderId: string; now: Date }): Promise<void> {
  const { rows } = await tx.query<{ id: string; number: number; tab_order_id: string | null }>(
    'SELECT id, number, tab_order_id FROM merchant.tables WHERE id = $1 AND merchant = $2 AND removed_at IS NULL FOR UPDATE',
    [input.tableId, input.merchant],
  );
  const t = rows[0];
  if (!t) throw new TerminalError('No such table', 'not_found');
  if (t.tab_order_id) {
    const { rows: tab } = await tx.query<{ status: string }>('SELECT status FROM commerce.orders WHERE id = $1', [t.tab_order_id]);
    const s = tab[0]?.status;
    if (s && !PAID.includes(s) && s !== 'voided') throw new TerminalError(`Table ${t.number} has a tab open; add to it instead`, 'conflict');
  }
  await tx.query(
    `UPDATE merchant.tables SET tab_order_id = $2, seated_at = COALESCE(seated_at, hold_seated_at, $3),
            hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL WHERE id = $1`,
    [t.id, input.orderId, input.now],
  );
}
