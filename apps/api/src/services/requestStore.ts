import crypto from 'crypto';
import { getPostgresPool } from '../config/postgres.js';

/*
 * Money requests ("ask a contact to pay you"). A request from A → B is persisted here and surfaces to
 * B as a notification (see routes/requests.ts). Settling on pay is a later step; for now this records
 * the ask and drives the "someone requested money" notification.
 */
const TABLE = 'payment_requests';
let ensured = false;

async function ensureTables(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      from_wallet TEXT NOT NULL,
      from_name TEXT,
      to_wallet TEXT NOT NULL,
      amount_usd NUMERIC(20,2) NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payment_requests_to_idx ON ${TABLE} (to_wallet, created_at DESC);
  `);
  ensured = true;
}

export interface PaymentRequestInput {
  fromWallet: string;
  fromName?: string | null;
  toWallet: string;
  amountUsd: number;
  note?: string | null;
}

export const requestStore = {
  isConfigured: () => !!getPostgresPool(),

  async create(input: PaymentRequestInput): Promise<{ id: string } | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO ${TABLE} (id, from_wallet, from_name, to_wallet, amount_usd, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.fromWallet.toLowerCase(), input.fromName ?? null, input.toWallet.toLowerCase(), input.amountUsd, input.note ?? null],
    );
    return { id };
  },
};
