import { getPostgresPool } from '../config/postgres.js';

/*
 * Onramper transaction status, written by the webhook (reconciliation) + read by the app for
 * order-status / notifications. One row per Onramper transaction id, upserted as status events
 * arrive (created → pending → completed/failed). Keyed by the buyer's wallet for per-user lookups.
 */
const TABLE = 'onramp_transactions';
let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      wallet TEXT,
      status TEXT NOT NULL,
      provider TEXT,
      fiat_amount NUMERIC,
      crypto_amount NUMERIC,
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS onramp_tx_wallet_idx ON ${TABLE} (wallet);
  `);
  ensured = true;
}

export interface OnrampTx {
  id: string;
  wallet: string | null;
  status: string;
  provider: string | null;
  fiatAmount: number | null;
  cryptoAmount: number | null;
}

export const onramperStore = {
  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  },

  async upsert(tx: OnrampTx & { raw?: unknown }): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (id, wallet, status, provider, fiat_amount, crypto_amount, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         wallet = COALESCE(EXCLUDED.wallet, ${TABLE}.wallet),
         provider = COALESCE(EXCLUDED.provider, ${TABLE}.provider),
         fiat_amount = COALESCE(EXCLUDED.fiat_amount, ${TABLE}.fiat_amount),
         crypto_amount = COALESCE(EXCLUDED.crypto_amount, ${TABLE}.crypto_amount),
         raw = EXCLUDED.raw,
         updated_at = now()`,
      [tx.id, tx.wallet, tx.status, tx.provider, tx.fiatAmount, tx.cryptoAmount, JSON.stringify(tx.raw ?? null)],
    );
  },

  async listByWallet(wallet: string, limit = 20): Promise<OnrampTx[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTable();
    const r = await pool.query(
      `SELECT id, wallet, status, provider, fiat_amount, crypto_amount FROM ${TABLE}
       WHERE wallet = $1 ORDER BY updated_at DESC LIMIT $2`,
      [wallet.toLowerCase(), limit],
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      wallet: row.wallet ? String(row.wallet) : null,
      status: String(row.status),
      provider: row.provider ? String(row.provider) : null,
      fiatAmount: row.fiat_amount == null ? null : Number(row.fiat_amount),
      cryptoAmount: row.crypto_amount == null ? null : Number(row.crypto_amount),
    }));
  },
};
