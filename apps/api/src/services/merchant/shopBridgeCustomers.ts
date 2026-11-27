import { merchantDb } from '../../config/merchantDb.js';
import type { Queryable } from '../../db/db.js';

/**
 * Which of these Bridge customers are shops' businesses (Settings › Advanced) rather than members.
 *
 * An owner often verifies the business under the same email they use as a member, and Bridge finds
 * customers by email. Without this, the member app could take the shop's business customer for the
 * owner's own: show the shop's account number as theirs, and run a deposit into the shop's wallet
 * through the owner's member deposits. Both lookups skip what this returns.
 *
 * A lookup that fails returns none, so the member app works as it did before shops had customers.
 */
export async function shopBridgeCustomers(ids: string[], db?: Queryable | null): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Set();
  try {
    const q = db === undefined ? await merchantDb() : db;
    if (!q) return new Set();
    const { rows } = await q.query<{ id: string }>('SELECT bridge_customer_id AS id FROM merchant.profiles WHERE bridge_customer_id = ANY($1::text[])', [wanted]);
    return new Set(rows.map((r) => r.id));
  } catch (error) {
    console.warn('[bridge] couldn’t check for shop customers', (error as Error)?.message);
    return new Set();
  }
}
