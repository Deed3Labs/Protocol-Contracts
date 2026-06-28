import crypto from 'crypto';
import { getPayPool } from '../config/postgres.js';

/*
 * Clear Pay rent/bill → equity-credit ledger (off-chain, Railway Postgres). Append-only credit rows
 * keyed by payment (idempotent), with a 30-day vesting window before they're mintable. Designed so a
 * future minter reads `vested & un-minted` rows, mints matching StableCredit on-chain, and stamps
 * them `minted` + `mint_tx` — at which point the chain becomes the source of truth and this DB stays
 * as the fast read-layer + backup. Keyed by wallet (lowercased), matching the other wallet-scoped
 * services. See [[clear-product-model]] for the credit semantics.
 */

export type BillerType = 'rent' | 'utility' | 'card' | 'phone' | 'other';
export type CreditStatus = 'pending' | 'vested' | 'minted' | 'void';
export type EarnSource = 'in_app' | 'detected';

const GRACE_DAYS = 3; // paid within N days of due_date still counts as on-time
const VEST_DAYS = 30; // pending → vested clawback/settlement window
const IN_APP_BONUS = 1.1; // paying through the app earns a 10% bonus

let ensured = false;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** +5% per on-time month, capped at 12 (1.0×–1.6×). Mirrors the frontend streakMultiplier. */
function streakMultiplier(streak: number): number {
  return 1 + Math.min(Math.max(streak, 0), 12) * 0.05;
}

/** Equity credits for an on-time payment: base by type × streak × in-app bonus, rounded to 5. */
function creditAmount(type: BillerType, streak: number, source: EarnSource): number {
  const base = type === 'rent' ? 300 : 50;
  const bonus = source === 'in_app' ? IN_APP_BONUS : 1;
  return Math.round((base * streakMultiplier(streak) * bonus) / 5) * 5;
}

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_billers (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      name TEXT NOT NULL,
      payee TEXT,
      type TEXT NOT NULL,
      default_amount NUMERIC,
      due_day INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      plaid_stream_id TEXT,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_billers_wallet_idx ON pay_billers (wallet);
    CREATE UNIQUE INDEX IF NOT EXISTS pay_billers_stream_uidx
      ON pay_billers (wallet, plaid_stream_id) WHERE plaid_stream_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pay_payments (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      biller_id TEXT,
      name TEXT,
      type TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      due_date DATE,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      on_time BOOLEAN NOT NULL DEFAULT true,
      source TEXT NOT NULL DEFAULT 'in_app',
      period TEXT NOT NULL,
      tx_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_payments_wallet_idx ON pay_payments (wallet);
    CREATE UNIQUE INDEX IF NOT EXISTS pay_payments_period_uidx
      ON pay_payments (wallet, biller_id, period) WHERE biller_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pay_credits (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      amount NUMERIC NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'in_app',
      streak_at_award INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      vest_until TIMESTAMPTZ NOT NULL,
      mint_tx TEXT,
      minted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_credits_wallet_idx ON pay_credits (wallet);
    CREATE INDEX IF NOT EXISTS pay_credits_status_idx ON pay_credits (status);
  `);
  ensured = true;
}

export interface Biller {
  id: string;
  name: string;
  payee: string | null;
  type: BillerType;
  defaultAmount: number;
  dueDay: number | null;
  source: 'manual' | 'plaid';
  plaidStreamId: string | null;
}

export interface PaySummary {
  dueThisMonth: number;
  paid30: number;
  totalEquity: number; // pending + vested + minted
  vestedEquity: number; // vested + minted (settled)
  pendingEquity: number; // still vesting
  equityThisMonth: number;
  streak: number;
  series: { label: string; rent: number; equity: number }[]; // last 12 months: rent paid + cumulative equity
}

function rowToBiller(r: Record<string, unknown>): Biller {
  return {
    id: String(r.id),
    name: String(r.name),
    payee: r.payee ? String(r.payee) : null,
    type: String(r.type) as BillerType,
    defaultAmount: num(r.default_amount),
    dueDay: r.due_day == null ? null : Number(r.due_day),
    source: String(r.source) === 'plaid' ? 'plaid' : 'manual',
    plaidStreamId: r.plaid_stream_id ? String(r.plaid_stream_id) : null,
  };
}

/** Consecutive months (ending at the most recent) with an on-time rent payment. */
async function computeStreak(wallet: string): Promise<number> {
  const pool = getPayPool();
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT DISTINCT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS m
       FROM pay_payments
      WHERE wallet = $1 AND type = 'rent' AND on_time = true
      ORDER BY m DESC`,
    [wallet],
  );
  const months: string[] = r.rows.map((x) => String(x.m));
  if (months.length === 0) return 0;
  let streak = 0;
  const cursor = new Date(`${months[0]}-01T00:00:00Z`);
  for (const m of months) {
    const want = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m === want) {
      streak += 1;
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    } else break;
  }
  return streak;
}

export const payLedgerStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async listBillers(wallet: string): Promise<Biller[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query(
      `SELECT * FROM pay_billers WHERE wallet = $1 AND archived_at IS NULL ORDER BY type = 'rent' DESC, due_day NULLS LAST`,
      [wallet],
    );
    return r.rows.map(rowToBiller);
  },

  async addBiller(wallet: string, b: Omit<Biller, 'id' | 'source' | 'plaidStreamId'>): Promise<Biller> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const id = crypto.randomUUID();
    const r = await pool.query(
      `INSERT INTO pay_billers (id, wallet, name, payee, type, default_amount, due_day, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING *`,
      [id, wallet, b.name, b.payee, b.type, b.defaultAmount, b.dueDay],
    );
    return rowToBiller(r.rows[0]);
  },

  async archiveBiller(wallet: string, id: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE pay_billers SET archived_at = now() WHERE wallet = $1 AND id = $2`, [wallet, id]);
  },

  /** Upsert Plaid-detected billers (recurring outflow streams) by stream id. */
  async upsertPlaidBillers(
    wallet: string,
    streams: { streamId: string; name: string; amount: number; dueDay: number; type: BillerType }[],
  ): Promise<void> {
    const pool = getPayPool();
    if (!pool || streams.length === 0) return;
    await ensureTables();
    for (const s of streams) {
      await pool.query(
        `INSERT INTO pay_billers (id, wallet, name, payee, type, default_amount, due_day, source, plaid_stream_id)
         VALUES ($1,$2,$3,$3,$4,$5,$6,'plaid',$7)
         ON CONFLICT (wallet, plaid_stream_id) WHERE plaid_stream_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, default_amount = EXCLUDED.default_amount, due_day = EXCLUDED.due_day, type = EXCLUDED.type`,
        [crypto.randomUUID(), wallet, s.name, s.type, s.amount, s.dueDay, s.streamId],
      );
    }
  },

  /**
   * Record a payment and (if on-time) award an equity credit. Idempotent per (wallet, biller, period):
   * a payment already recorded for that biller+period earns nothing further, so in-app and detected
   * paths can't double-credit. Returns the credit amount awarded (0 if none/duplicate).
   */
  async recordPayment(input: {
    wallet: string;
    billerId: string | null;
    name: string;
    type: BillerType;
    amount: number;
    dueDate: string | null; // ISO date
    period: string; // e.g. "2026-06" — billing period for idempotency
    source: EarnSource;
    txRef?: string | null;
    paidAt?: Date; // actual payment date (detected payments use the bank date); defaults to now
  }): Promise<{ creditAwarded: number; onTime: boolean; duplicate: boolean }> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();

    const paidAt = input.paidAt ?? new Date();
    let onTime = true;
    if (input.dueDate) {
      const due = new Date(input.dueDate);
      due.setDate(due.getDate() + GRACE_DAYS);
      onTime = paidAt <= due;
    }

    const paymentId = crypto.randomUUID();
    const ins = await pool.query(
      `INSERT INTO pay_payments (id, wallet, biller_id, name, type, amount, due_date, paid_at, on_time, source, period, tx_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (wallet, biller_id, period) WHERE biller_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [paymentId, input.wallet, input.billerId, input.name, input.type, input.amount, input.dueDate, paidAt, onTime, input.source, input.period, input.txRef ?? null],
    );
    if (ins.rowCount === 0) {
      return { creditAwarded: 0, onTime, duplicate: true }; // already paid this period
    }

    if (!onTime) return { creditAwarded: 0, onTime, duplicate: false };

    const streak = await computeStreak(input.wallet);
    const amount = creditAmount(input.type, streak, input.source);
    const vestUntil = new Date(paidAt);
    vestUntil.setDate(vestUntil.getDate() + VEST_DAYS);
    await pool.query(
      `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, streak_at_award, status, vest_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) ON CONFLICT (payment_id) DO NOTHING`,
      [crypto.randomUUID(), input.wallet, paymentId, amount, input.type === 'rent' ? 'rent_on_time' : 'bill_on_time', input.source, streak, vestUntil],
    );
    return { creditAwarded: amount, onTime, duplicate: false };
  },

  async getSummary(wallet: string): Promise<PaySummary> {
    const pool = getPayPool();
    if (!pool) {
      return { dueThisMonth: 0, paid30: 0, totalEquity: 0, vestedEquity: 0, pendingEquity: 0, equityThisMonth: 0, streak: 0, series: [] };
    }
    await ensureTables();
    // Lazily vest matured credits (pending → vested).
    await pool.query(`UPDATE pay_credits SET status = 'vested' WHERE wallet = $1 AND status = 'pending' AND vest_until <= now()`, [wallet]);

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const [due, paid, credits, monthly] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(default_amount),0) AS s FROM pay_billers b
          WHERE b.wallet = $1 AND b.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM pay_payments p WHERE p.wallet = b.wallet AND p.biller_id = b.id AND p.period = $2)`,
        [wallet, period],
      ),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS s FROM pay_payments WHERE wallet = $1 AND paid_at >= now() - interval '30 days'`, [wallet]),
      pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','vested','minted')),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE status IN ('vested','minted')),0) AS vested,
           COALESCE(SUM(amount) FILTER (WHERE status = 'pending'),0) AS pending,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS this_month
         FROM pay_credits WHERE wallet = $1`,
        [wallet],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', m), 'Mon') AS label,
                COALESCE(rent.s,0) AS rent, COALESCE(cred.s,0) AS equity
           FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m
           LEFT JOIN LATERAL (SELECT SUM(amount) s FROM pay_payments p WHERE p.wallet = $1 AND p.type = 'rent' AND date_trunc('month', p.paid_at) = m) rent ON true
           LEFT JOIN LATERAL (SELECT SUM(amount) s FROM pay_credits c WHERE c.wallet = $1 AND c.created_at <= m + interval '1 month' - interval '1 second' AND c.status <> 'void') cred ON true
           ORDER BY m`,
        [wallet],
      ),
    ]);

    return {
      dueThisMonth: num(due.rows[0]?.s),
      paid30: num(paid.rows[0]?.s),
      totalEquity: num(credits.rows[0]?.total),
      vestedEquity: num(credits.rows[0]?.vested),
      pendingEquity: num(credits.rows[0]?.pending),
      equityThisMonth: num(credits.rows[0]?.this_month),
      streak: await computeStreak(wallet),
      series: monthly.rows.map((r) => ({ label: String(r.label), rent: num(r.rent), equity: num(r.equity) })),
    };
  },
};
