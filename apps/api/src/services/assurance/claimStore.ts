import { randomUUID } from 'node:crypto';
import { getPayPool } from '../../config/postgres.js';

/*
 * Assurance claims — what a member asked the reserve to cover, and what came back.
 *
 * A claim is the worst day a member has with Clear, and the one place where a form that looks like
 * it worked and quietly went nowhere would be worst of all. So it is stored before anything else
 * happens to it: the member's account of what happened, in their words, with a token they can be
 * told out loud.
 *
 * The protection's NAME is copied in beside its id, deliberately denormalised. Protections get
 * renamed — four of them were renamed the day this table was written — and a claim has to keep
 * saying what the member was told they were covered by at the time, not what the row is called now.
 *
 * Nothing here decides anything. A decision is a person reading it, which is what the page promises
 * ("a member of the team reads it"), so `status` moves by hand and every move records why.
 */

const TABLE = 'assurance_claims';

/** Where a claim has got to. `open` is the only state this service can create. */
export type ClaimStatus = 'open' | 'more_needed' | 'paid' | 'declined';

export interface ClaimRecord {
  token: string;
  wallet: string;
  /** The protection claimed on, as it was identified and as it was named at the time. */
  protectionId: string;
  protectionName: string;
  /** The member's account of what happened, in their words. */
  detail: string;
  status: ClaimStatus;
  /** What we told them, and why. Null until somebody has read it. */
  decision: string | null;
  /** Paid into the member's cash account. Null unless the claim was paid. */
  paidCents: number | null;
  createdAt: string;
  decidedAt: string | null;
}

interface Row {
  token: string;
  wallet: string;
  protection_id: string;
  protection_name: string;
  detail: string;
  status: string;
  decision: string | null;
  paid_cents: string | null;
  created_at: Date;
  decided_at: Date | null;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      token TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      protection_id TEXT NOT NULL,
      protection_name TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      decision TEXT,
      paid_cents BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_wallet_idx ON ${TABLE} (wallet, created_at DESC);
  `);
  ensured = true;
}

function toRecord(row: Row): ClaimRecord {
  return {
    token: row.token,
    wallet: row.wallet,
    protectionId: row.protection_id,
    protectionName: row.protection_name,
    detail: row.detail,
    status: row.status as ClaimStatus,
    decision: row.decision,
    paidCents: row.paid_cents === null ? null : Number(row.paid_cents),
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  };
}

export const claimStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  /**
   * File a claim. Returns null when there is no database, which the route reports as unavailable
   * rather than as success — a member told their claim was sent when it was not is the whole
   * failure this service exists to avoid.
   */
  async file(input: {
    wallet: string;
    protectionId: string;
    protectionName: string;
    detail: string;
  }): Promise<ClaimRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();

    const { rows } = await pool.query<Row>(
      `INSERT INTO ${TABLE} (token, wallet, protection_id, protection_name, detail)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        randomUUID(),
        input.wallet.trim().toLowerCase(),
        input.protectionId,
        input.protectionName,
        input.detail,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** A member's own claims, newest first. */
  async listFor(wallet: string): Promise<ClaimRecord[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE wallet = $1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.trim().toLowerCase()],
    );
    return rows.map(toRecord);
  },

  /**
   * The published record — what the page states before a member claims.
   *
   * Counted across everyone, because that is what it claims to be: the co-op's own figures for the
   * year, including the declines. A reserve that never says no is not being managed, and the page
   * says so, so the decline count has to come from the same place as the paid one.
   */
  async record(year = new Date().getUTCFullYear()): Promise<{
    paidCents: number;
    paidCount: number;
    declinedCount: number;
    decidedCount: number;
  }> {
    const pool = getPayPool();
    const empty = { paidCents: 0, paidCount: 0, declinedCount: 0, decidedCount: 0 };
    if (!pool) return empty;
    await ensureTable();

    const { rows } = await pool.query<{
      paid_cents: string | null;
      paid_count: string;
      declined_count: string;
      decided_count: string;
    }>(
      `SELECT COALESCE(SUM(paid_cents) FILTER (WHERE status = 'paid'), 0) AS paid_cents,
              COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
              COUNT(*) FILTER (WHERE status = 'declined') AS declined_count,
              COUNT(*) FILTER (WHERE status IN ('paid', 'declined')) AS decided_count
         FROM ${TABLE}
        WHERE date_part('year', created_at) = $1`,
      [year],
    );
    const row = rows[0];
    if (!row) return empty;
    return {
      paidCents: Number(row.paid_cents ?? 0),
      paidCount: Number(row.paid_count),
      declinedCount: Number(row.declined_count),
      decidedCount: Number(row.decided_count),
    };
  },
};
