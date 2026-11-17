import type { Queryable } from '../../db/db.js';
import { addDays, advancesOutstanding, interchangeShare, monthFee, monthOf, monthStart, nextMonth, previousMonth, usd, type FeeBasis } from './feeMath.js';
import type { PoolReading } from './chain.js';
import type { FundingProposal, SafeBatch } from './proposals.js';

/*
 * The Assurance fee payer's records (migration 0077): the pool's daily readings, what Clear Lending
 * owes and pays (the fee, Spread Repayments, recoveries) and the treasury's interchange proposals.
 *
 * Every change of an item's state is one UPDATE guarded by the state it leaves, so two runs (or a run
 * and a person) can never both move it: the one that finds it in the state it expects wins, the
 * other changes nothing. An item is paid once: its deposit hash is unique, and nothing sends from a
 * state other than funding_proposed or funded.
 */

export type ItemKind = 'fee' | 'spread_repayment' | 'recovery';
export type ItemStatus = 'nothing_due' | 'due' | 'funding_proposed' | 'funded' | 'sending' | 'paid' | 'failed';

export interface Item {
  id: string;
  chainId: number;
  kind: ItemKind;
  month: string;
  sourceTag: number;
  amount: bigint;
  basis: FeeBasis | null;
  note: string;
  evidence: string;
  status: ItemStatus;
  funding: FundingProposal | null;
  fundingProposedAt: Date | null;
  fundedAt: Date | null;
  attempt: number;
  sendStartedAt: Date | null;
  sendBlock: number | null;
  payer: string | null;
  approveTx: string | null;
  depositTx: string | null;
  paidAt: Date | null;
  error: string | null;
  createdAt: Date;
}

export class AssuranceRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const day = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const date = (v: unknown) => (v == null ? null : new Date(v as string));

function toItem(r: any): Item {
  return {
    id: r.id,
    chainId: Number(r.chain_id),
    kind: r.kind,
    month: monthOf(day(r.month)),
    sourceTag: Number(r.source_tag),
    amount: BigInt(r.amount),
    basis: r.basis ?? null,
    note: r.note ?? '',
    evidence: r.evidence ?? '',
    status: r.status,
    funding: r.funding ?? null,
    fundingProposedAt: date(r.funding_proposed_at),
    fundedAt: date(r.funded_at),
    attempt: Number(r.attempt ?? 0),
    sendStartedAt: date(r.send_started_at),
    sendBlock: r.send_block == null ? null : Number(r.send_block),
    payer: r.payer ?? null,
    approveTx: r.approve_tx ?? null,
    depositTx: r.deposit_tx ?? null,
    paidAt: date(r.paid_at),
    error: r.error ?? null,
    createdAt: new Date(r.created_at),
  };
}

// ── the daily readings ──────────────────────────────────────────────────────

/**
 * Today's reading, once a day. A day missed since the last reading is written now with today's
 * figures and marked filled. Before the first reading nothing is written back: those days count as
 * zero. Running it twice in a day writes nothing the second time. Returns the days written.
 */
export async function recordSnapshot(db: Queryable, input: { chainId: number; pool: string; today: string; reading: PoolReading }): Promise<string[]> {
  const { rows } = await db.query<{ last: string | Date | null }>('SELECT max(day) AS last FROM command.assurance_snapshots WHERE chain_id = $1', [input.chainId]);
  const last = rows[0]?.last ? day(rows[0].last) : null;
  if (last && last >= input.today) return [];
  const days: Array<{ d: string; filled: boolean }> = [];
  if (last) for (let d = addDays(last); d < input.today; d = addDays(d)) days.push({ d, filled: true });
  days.push({ d: input.today, filled: false });
  const written: string[] = [];
  const r = input.reading;
  for (const { d, filled } of days) {
    const ins = await db.query(
      `INSERT INTO command.assurance_snapshots (chain_id, day, pool, available_coverage, backstop_balance, backstop_floor, coverage_cap, filled, block_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (chain_id, day) DO NOTHING RETURNING day`,
      [input.chainId, d, input.pool.toLowerCase(), r.availableCoverage.toString(), r.backstopBalance.toString(), r.backstopFloor.toString(), r.coverageCap.toString(), filled, r.block],
    );
    if (ins.rows.length) written.push(d);
  }
  return written;
}

/** A month's readings, day → coverage. */
export async function monthReadings(db: Queryable, chainId: number, month: string): Promise<Map<string, { coverage: bigint; filled: boolean }>> {
  const { rows } = await db.query<{ day: string | Date; available_coverage: string; filled: boolean }>(
    `SELECT day, available_coverage, filled FROM command.assurance_snapshots WHERE chain_id = $1 AND day >= $2 AND day < $3`,
    [chainId, monthStart(month), monthStart(nextMonth(month))],
  );
  return new Map(rows.map((r) => [day(r.day), { coverage: BigInt(r.available_coverage), filled: !!r.filled }]));
}

// ── the monthly fee ─────────────────────────────────────────────────────────

/**
 * The fee for every month that has ended since the pool was first read and has none yet: one per
 * month (a unique index), due, with its basis. A month whose fee rounds to nothing is recorded as
 * nothing_due. Returns the months accrued.
 */
export async function accrueFees(db: Queryable, input: { chainId: number; today: string; bps: bigint }): Promise<Array<{ month: string; fee: bigint }>> {
  const { rows } = await db.query<{ first: string | Date | null }>('SELECT min(day) AS first FROM command.assurance_snapshots WHERE chain_id = $1', [input.chainId]);
  if (!rows[0]?.first) return [];
  const thisMonth = monthOf(input.today);
  const out: Array<{ month: string; fee: bigint }> = [];
  for (let m = monthOf(day(rows[0].first)); m < thisMonth; m = nextMonth(m)) {
    const basis = monthFee(m, await monthReadings(db, input.chainId, m), input.bps);
    const fee = BigInt(basis.fee);
    const ins = await db.query(
      `INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount, basis, status)
       VALUES ($1, 'fee', $2, 0, $3, $4, $5)
       ON CONFLICT (chain_id, month) WHERE kind = 'fee' DO NOTHING RETURNING id`,
      [input.chainId, monthStart(m), fee.toString(), JSON.stringify(basis), fee > 0n ? 'due' : 'nothing_due'],
    );
    if (ins.rows.length) out.push({ month: m, fee });
  }
  return out;
}

/** This month so far: the readings to today, and the fee on them. */
export async function feeSoFar(db: Queryable, chainId: number, today: string, bps: bigint): Promise<FeeBasis> {
  const month = monthOf(today);
  const readings = await monthReadings(db, chainId, month);
  for (const d of [...readings.keys()]) if (d > today) readings.delete(d);
  return monthFee(month, readings, bps);
}

// ── items and their states ──────────────────────────────────────────────────

export async function itemById(db: Queryable, id: string): Promise<Item | null> {
  const { rows } = await db.query('SELECT * FROM command.assurance_items WHERE id = $1', [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Everything not yet paid, oldest first (by month, then when it was entered). */
export async function unpaid(db: Queryable, chainId: number): Promise<Item[]> {
  const { rows } = await db.query(
    `SELECT * FROM command.assurance_items WHERE chain_id = $1 AND status NOT IN ('paid', 'nothing_due') ORDER BY month, created_at, id`,
    [chainId],
  );
  return rows.map(toItem);
}

export async function allItems(db: Queryable, chainId: number, limit = 24): Promise<Item[]> {
  const { rows } = await db.query(`SELECT * FROM command.assurance_items WHERE chain_id = $1 ORDER BY month DESC, created_at DESC LIMIT $2`, [chainId, limit]);
  return rows.map(toItem);
}

/** One guarded move: only from the states listed. Returns the item as it now is, or null if it wasn't in one. */
async function move(db: Queryable, id: string, from: ItemStatus[], set: string, params: unknown[]): Promise<Item | null> {
  const { rows } = await db.query(`UPDATE command.assurance_items SET ${set} WHERE id = $1 AND status = ANY($2) RETURNING *`, [id, from, ...params]);
  return rows[0] ? toItem(rows[0]) : null;
}

/** The funding batch was built for CL Operating's signers. Building it again replaces the batch (same amount). */
export const markFundingProposed = (db: Queryable, id: string, funding: FundingProposal, by: string | null, at: Date) =>
  move(db, id, ['due', 'funding_proposed'], `status = 'funding_proposed', funding = $3, funding_proposed_by = $4, funding_proposed_at = $5`, [JSON.stringify(funding), by, at]);

/** The CL Fees wallet holds enough for it. */
export const markFunded = (db: Queryable, id: string, at: Date) => move(db, id, ['funding_proposed'], `status = 'funded', funded_at = $3`, [at]);

/**
 * Claims an item to send: the one way into sending, so a second run finds nothing to claim. The
 * first claim's block is kept: it's where a lost deposit would be looked for.
 */
export const claimSend = (db: Queryable, id: string, input: { payer: string; block: number; at: Date }) =>
  move(
    db,
    id,
    ['funding_proposed', 'funded'],
    `status = 'sending', attempt = attempt + 1, payer = $3, send_block = coalesce(send_block, $4), send_started_at = $5, funded_at = coalesce(funded_at, $5)`,
    [input.payer.toLowerCase(), input.block, input.at],
  );

/** A send picked up again after a restart: a new attempt, so a new idempotency key. */
export const nextAttempt = (db: Queryable, id: string, at: Date) => move(db, id, ['sending'], `attempt = attempt + 1, send_started_at = $3, approve_tx = NULL`, [at]);

export const recordApprove = (db: Queryable, id: string, hash: string) => move(db, id, ['sending'], `approve_tx = $3`, [hash.toLowerCase()]);

/** The deposit's hash, written the moment it's known and never over another. */
export async function recordDeposit(db: Queryable, id: string, hash: string): Promise<Item | null> {
  const { rows } = await db.query(`UPDATE command.assurance_items SET deposit_tx = $2 WHERE id = $1 AND status = 'sending' AND deposit_tx IS NULL RETURNING *`, [id, hash.toLowerCase()]);
  return rows[0] ? toItem(rows[0]) : null;
}

export const markPaid = (db: Queryable, id: string, hash: string, at: Date) =>
  move(db, id, ['sending'], `status = 'paid', deposit_tx = $3, paid_at = $4, error = NULL`, [hash.toLowerCase(), at]);

export const markFailed = (db: Queryable, id: string, error: string) => move(db, id, ['funding_proposed', 'funded', 'sending'], `status = 'failed', error = $3`, [error.slice(0, 1000)]);

/**
 * After a person has looked at a failure: back to funded, the hashes cleared. The next send looks on
 * chain first for a deposit since the item's first attempt, so one that did land is recorded, not
 * paid again.
 */
export const retryFailed = (db: Queryable, id: string) => move(db, id, ['failed'], `status = 'funded', error = NULL, approve_tx = NULL, deposit_tx = NULL`, []);

/** Every deposit hash already recorded: a transfer found on chain under one of these belongs to that item. */
export async function knownDeposits(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ deposit_tx: string }>('SELECT deposit_tx FROM command.assurance_items WHERE deposit_tx IS NOT NULL');
  return new Set(rows.map((r) => r.deposit_tx.toLowerCase()));
}

// ── Spread Repayments and recoveries ────────────────────────────────────────

/** Σ Spread Repayments and recoveries: paid, and entered at all (paid or on the way). */
export async function repaid(db: Queryable, chainId: number): Promise<{ paid: bigint; entered: bigint }> {
  const { rows } = await db.query<{ paid: string | null; entered: string | null }>(
    `SELECT sum(amount) FILTER (WHERE status = 'paid') AS paid, sum(amount) AS entered
     FROM command.assurance_items WHERE chain_id = $1 AND kind IN ('spread_repayment', 'recovery')`,
    [chainId],
  );
  return { paid: BigInt(rows[0]?.paid ?? 0), entered: BigInt(rows[0]?.entered ?? 0) };
}

/**
 * A Spread Repayment or a recovery (the Credit Backstop's share), entered by an admin, due through
 * the same funding and deposit as the fee, under RECOVERY. Never more than the advances still
 * outstanding once everything already entered is counted: released draws less every repayment and
 * recovery entered, paid or not. Recoveries are held to it too: past the advances, a recovery goes
 * to Clear Lending's Loss Reserve, not the pool (IV-03 7.3).
 */
export async function recordRepayment(
  tx: Queryable,
  input: { chainId: number; kind: 'spread_repayment' | 'recovery'; month: string; amount: bigint; note: string; evidence: string; by: string | null; released: bigint },
): Promise<Item> {
  if (input.amount <= 0n) throw new AssuranceRefusal('BAD_AMOUNT', 'Enter an amount above zero');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new AssuranceRefusal('BAD_MONTH', 'Which month?');
  // run inside the caller's transaction: one entry at a time, so two can't each fit under the same room
  await tx.query('SELECT pg_advisory_xact_lock($1)', [77_077]);
  const r = await repaid(tx, input.chainId);
  const room = advancesOutstanding(input.released, r.entered);
  if (input.amount > room) {
    const what = input.kind === 'spread_repayment' ? 'A Spread Repayment' : 'A recovery';
    throw new AssuranceRefusal('OVER_ADVANCES', `${what} can’t be more than the advances outstanding: ${usd(room)} is left once what’s already entered is counted`);
  }
  const { rows } = await tx.query(
    `INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount, note, evidence, status, created_by)
     VALUES ($1, $2, $3, 1, $4, $5, $6, 'due', $7) RETURNING *`,
    [input.chainId, input.kind, monthStart(input.month), input.amount.toString(), input.note, input.evidence, input.by],
  );
  return toItem(rows[0]);
}

// ── interchange ─────────────────────────────────────────────────────────────

export interface InterchangeRow {
  month: string;
  interchange: bigint;
  bps: number;
  amount: bigint;
  note: string;
  safe: string;
  batch: SafeBatch;
  createdAt: Date;
}

const toInterchange = (r: any): InterchangeRow => ({
  month: monthOf(day(r.month)),
  interchange: BigInt(r.interchange),
  bps: Number(r.bps),
  amount: BigInt(r.amount),
  note: r.note ?? '',
  safe: r.safe,
  batch: r.batch,
  createdAt: new Date(r.created_at),
});

/** The month's interchange contribution: x = interchange × bps / 10,000. One per month. */
export async function recordInterchange(
  db: Queryable,
  input: { chainId: number; month: string; interchange: bigint; bps: bigint; safe: string; note: string; by: string | null; batch: (amount: bigint) => SafeBatch },
): Promise<InterchangeRow> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new AssuranceRefusal('BAD_MONTH', 'Which month?');
  const amount = interchangeShare(input.interchange, input.bps);
  if (amount <= 0n) throw new AssuranceRefusal('BAD_AMOUNT', 'That interchange comes to nothing to deposit');
  const { rows } = await db.query(
    `INSERT INTO command.assurance_interchange (chain_id, month, interchange, bps, amount, note, safe, batch, proposed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (chain_id, month) DO NOTHING RETURNING *`,
    [input.chainId, monthStart(input.month), input.interchange.toString(), Number(input.bps), amount.toString(), input.note, input.safe.toLowerCase(), JSON.stringify(input.batch(amount)), input.by],
  );
  if (!rows[0]) throw new AssuranceRefusal('ALREADY_PROPOSED', `${input.month}’s interchange is already proposed`);
  return toInterchange(rows[0]);
}

export async function interchangeFor(db: Queryable, chainId: number, month: string): Promise<InterchangeRow | null> {
  const { rows } = await db.query('SELECT * FROM command.assurance_interchange WHERE chain_id = $1 AND month = $2', [chainId, monthStart(month)]);
  return rows[0] ? toInterchange(rows[0]) : null;
}

export async function interchangeRows(db: Queryable, chainId: number, limit = 6): Promise<InterchangeRow[]> {
  const { rows } = await db.query('SELECT * FROM command.assurance_interchange WHERE chain_id = $1 ORDER BY month DESC LIMIT $2', [chainId, limit]);
  return rows.map(toInterchange);
}

export { previousMonth };
