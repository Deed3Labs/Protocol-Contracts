import { getPayPool } from '../config/postgres.js';

/*
 * customer_id → wallet, so an inbound Bridge webhook can be routed to a member.
 *
 * Bridge identifies everything by its own `customer_id`; our notifications, balances and ledger are
 * all keyed by wallet. Nothing in a webhook payload carries a wallet, so unless we record the pairing
 * at the moment we resolve a customer for a signed-in session, a deposit event arrives unattributable.
 *
 * Written opportunistically (any authenticated Bridge call), read only by the webhook handler.
 */

let ensured = false;

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bridge_customers (
      customer_id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bridge_customers_wallet_idx ON bridge_customers (wallet);
  `);
  ensured = true;
}

export const bridgeCustomerStore = {
  /** Record (or refresh) which member a Bridge customer belongs to. Best-effort — never throws. */
  async link(customerId: string, wallet: string, email?: string | null): Promise<void> {
    const id = String(customerId || '').trim();
    const w = String(wallet || '').trim().toLowerCase();
    if (!id || !/^0x[a-f0-9]{40}$/.test(w)) return;
    try {
      const pool = getPayPool();
      if (!pool) return;
      await ensureTables();
      await pool.query(
        `INSERT INTO bridge_customers (customer_id, wallet, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_id) DO UPDATE
           SET wallet = EXCLUDED.wallet,
               email = COALESCE(EXCLUDED.email, bridge_customers.email),
               updated_at = now()`,
        [id, w, email ? String(email).toLowerCase() : null],
      );
    } catch (error) {
      // A missing mapping only costs a notification, so never fail the caller's request over it.
      console.warn('[bridgeCustomerStore] link failed', (error as Error)?.message);
    }
  },

  /** The member behind a Bridge customer, or null if we've never seen them. */
  async walletFor(customerId: string): Promise<string | null> {
    const id = String(customerId || '').trim();
    if (!id) return null;
    try {
      const pool = getPayPool();
      if (!pool) return null;
      await ensureTables();
      const r = await pool.query('SELECT wallet FROM bridge_customers WHERE customer_id = $1 LIMIT 1', [id]);
      return (r.rows[0]?.wallet as string | undefined) ?? null;
    } catch (error) {
      console.warn('[bridgeCustomerStore] lookup failed', (error as Error)?.message);
      return null;
    }
  },
};
