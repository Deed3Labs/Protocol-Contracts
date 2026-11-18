import type { Queryable } from '../../db/db.js';
import { centsToUnits } from './desk.js';
import { dueCutoffFor, type Coverage, type CutoffSchedule } from './schedule.js';

/*
 * The credit portions of card spend, from the Pay database (decision 54).
 *
 * Where they live. Every authorization the Auth Stream decides is a row in `lithic_auth_decisions`
 * (services/lithic/authStore.ts), keyed by Lithic's transaction token. `credit_cents` is the part
 * drawn from credit tiers (everything but the member's own cash), and the card_transaction webhook
 * (cardTransactionEvents.ts -> authStore.reconcile) keeps it equal to what the transaction holds now,
 * and sets `status` to Lithic's (PENDING, SETTLED, VOIDED, ...). `settled_at` is when it was first
 * reported SETTLED; older rows fall back to `reconciled_at`. A SETTLED row is the moment
 * `cardSettlementService` makes the member's debt on chain, and the bank debits its cash at the
 * cut-off the schedule gives.
 *
 *   authorized, not settled  result APPROVED, status PENDING (or never reported), in the last 30 days
 *   due at a cut-off         result APPROVED, status SETTLED, whose clearing falls to that cut-off
 *
 * Disputed purchases are still settled by the network, so they are counted. Declines hold nothing.
 */

const TABLE = 'lithic_auth_decisions';

/** The Pay database (getPayPool), or anything that queries like it. */
export type PayDb = Pick<Queryable, 'query'>;
/** Authorizations older than this have expired at the network whatever their status says. */
const PENDING_DAYS = 30;

export interface CardCredit {
  /** Settled credit due at the covered cut-offs, USDC base units. */
  dueSettled: bigint;
  /** Per covered cut-off (unix seconds -> units). */
  byCutoff: Record<number, bigint>;
  /** Authorized and not settled. */
  pendingCredit: bigint;
  /** Settled over the velocity window. */
  recentSettled: bigint;
}

async function hasTable(db: PayDb): Promise<boolean> {
  const { rows } = await db.query<{ t: string | null }>(`SELECT to_regclass('${TABLE}')::text AS t`);
  return !!rows[0]?.t;
}

/** Adds settled_at if this database predates it (authStore adds it too, on its first use). */
async function ensureSettledAt(db: PayDb): Promise<void> {
  await db.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`);
}

const settledExpr = 'COALESCE(settled_at, reconciled_at, decided_at)';

export async function readCardCredit(db: PayDb | null, input: { now: number; coverage: Coverage; schedule: CutoffSchedule; velocityDays: number }): Promise<CardCredit> {
  const empty: CardCredit = { dueSettled: 0n, byCutoff: Object.fromEntries(input.coverage.cutoffs.map((c) => [c, 0n])), pendingCredit: 0n, recentSettled: 0n };
  if (!db || !(await hasTable(db))) return empty;
  await ensureSettledAt(db);
  const now = new Date(input.now * 1000);
  // Far enough back for the lag (business days, plus weekends and holidays) to put a clearing at
  // the next cut-off.
  const lookbackDays = 10 + input.schedule.lagDays * 3;
  const since = new Date(Math.min(input.coverage.previous * 1000 - lookbackDays * 86_400_000, now.getTime() - input.velocityDays * 86_400_000));

  const { rows } = await db.query<{ credit: string; at: Date | string }>(
    `SELECT credit_cents::text AS credit, ${settledExpr} AS at FROM ${TABLE}
      WHERE result = 'APPROVED' AND upper(COALESCE(status, '')) = 'SETTLED' AND credit_cents > 0 AND ${settledExpr} > $1`,
    [since.toISOString()],
  );
  const byCutoff: Record<number, bigint> = { ...empty.byCutoff };
  let recentSettled = 0n;
  const velocityFrom = now.getTime() - input.velocityDays * 86_400_000;
  for (const r of rows) {
    const at = (r.at instanceof Date ? r.at : new Date(r.at)).getTime();
    const units = centsToUnits(BigInt(r.credit));
    if (at >= velocityFrom && at <= now.getTime()) recentSettled += units;
    const due = dueCutoffFor(Math.floor(at / 1000), input.schedule);
    if (due in byCutoff) byCutoff[due] += units;
  }
  const pending = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(credit_cents), 0)::text AS total FROM ${TABLE}
      WHERE result = 'APPROVED' AND credit_cents > 0 AND (status IS NULL OR upper(status) = 'PENDING') AND decided_at > $1`,
    [new Date(now.getTime() - PENDING_DAYS * 86_400_000).toISOString()],
  );
  return {
    dueSettled: Object.values(byCutoff).reduce((a, b) => a + b, 0n),
    byCutoff,
    pendingCredit: centsToUnits(BigInt(pending.rows[0]?.total ?? '0')),
    recentSettled,
  };
}

/** One day's authorized and settled credit, for the daily reconciliation. */
export async function cardCreditBetween(db: PayDb | null, from: Date, to: Date): Promise<{ authorized: bigint; settled: bigint }> {
  if (!db || !(await hasTable(db))) return { authorized: 0n, settled: 0n };
  await ensureSettledAt(db);
  const { rows } = await db.query<{ authorized: string; settled: string }>(
    `SELECT COALESCE(SUM(credit_cents) FILTER (WHERE decided_at >= $1 AND decided_at < $2), 0)::text AS authorized,
            COALESCE(SUM(credit_cents) FILTER (WHERE upper(COALESCE(status, '')) = 'SETTLED' AND ${settledExpr} >= $1 AND ${settledExpr} < $2), 0)::text AS settled
       FROM ${TABLE} WHERE result = 'APPROVED' AND credit_cents > 0`,
    [from.toISOString(), to.toISOString()],
  );
  return { authorized: centsToUnits(BigInt(rows[0]?.authorized ?? '0')), settled: centsToUnits(BigInt(rows[0]?.settled ?? '0')) };
}
