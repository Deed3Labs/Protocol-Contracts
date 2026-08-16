import { getPayPool } from '../../config/postgres.js';

/*
 * Which cards belong to which member — spec step 8.
 *
 * Lithic knows a card belongs to an account holder. It does not know our wallet addresses, and the
 * authorization path needs to go from a card token to a member in one indexed read inside a
 * three-second budget. That mapping is this table.
 *
 * It deliberately stores no card data beyond the last four and a memo. PANs, CVVs and expiries live
 * at Lithic and are shown to the member through Lithic's embedded UI, which their browser calls
 * directly — so full card data never reaches this server, and there is nothing here for a database
 * leak to expose.
 */

const TABLE = 'lithic_cards';

export interface CardRecord {
  cardToken: string;
  wallet: string;
  accountToken: string | null;
  type: string;
  state: string;
  lastFour: string | null;
  memo: string | null;
  spendLimitCents: number;
  spendLimitDuration: string | null;
  createdAt: string;
  updatedAt: string;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      card_token TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      account_token TEXT,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      last_four TEXT,
      memo TEXT,
      spend_limit_cents BIGINT NOT NULL DEFAULT 0,
      spend_limit_duration TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_wallet_idx ON ${TABLE} (wallet, created_at DESC);
  `);
  ensured = true;
}

interface Row {
  card_token: string;
  wallet: string;
  account_token: string | null;
  type: string;
  state: string;
  last_four: string | null;
  memo: string | null;
  spend_limit_cents: string;
  spend_limit_duration: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: Row): CardRecord {
  return {
    cardToken: row.card_token,
    wallet: row.wallet,
    accountToken: row.account_token,
    type: row.type,
    state: row.state,
    lastFour: row.last_four,
    memo: row.memo,
    spendLimitCents: parseInt(row.spend_limit_cents, 10) || 0,
    spendLimitDuration: row.spend_limit_duration,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const cardStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async upsert(input: {
    cardToken: string;
    wallet: string;
    accountToken?: string | null;
    type: string;
    state: string;
    lastFour?: string | null;
    memo?: string | null;
    spendLimitCents?: number;
    spendLimitDuration?: string | null;
  }): Promise<CardRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `INSERT INTO ${TABLE}
         (card_token, wallet, account_token, type, state, last_four, memo,
          spend_limit_cents, spend_limit_duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (card_token) DO UPDATE SET
         state = EXCLUDED.state,
         last_four = COALESCE(EXCLUDED.last_four, ${TABLE}.last_four),
         memo = COALESCE(EXCLUDED.memo, ${TABLE}.memo),
         spend_limit_cents = EXCLUDED.spend_limit_cents,
         spend_limit_duration = EXCLUDED.spend_limit_duration,
         updated_at = now()
       RETURNING *`,
      [
        input.cardToken,
        input.wallet.toLowerCase(),
        input.accountToken ?? null,
        input.type,
        input.state,
        input.lastFour ?? null,
        input.memo ?? null,
        Math.max(0, Math.round(input.spendLimitCents ?? 0)),
        input.spendLimitDuration ?? null,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async listFor(wallet: string): Promise<CardRecord[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE wallet = $1 ORDER BY created_at DESC`,
      [wallet.trim().toLowerCase()],
    );
    return rows.map(toRecord);
  },

  /** Ownership check. Every card mutation goes through this before it touches Lithic. */
  async get(cardToken: string): Promise<CardRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE card_token = $1`, [
      cardToken,
    ]);
    return rows[0] ? toRecord(rows[0]) : null;
  },
};
