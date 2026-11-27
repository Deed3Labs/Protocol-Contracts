import type { Queryable } from '../../db/db.js';

/*
 * The settlement funding desk's records (migration 0079): its moves, every check, and the daily
 * reconciliation. Addresses are stored lower-case; amounts are USDC base units, NUMERIC, read back
 * as bigint.
 */

export type MoveKind = 'book' | 'deploy' | 'return-margin' | 'return-pool' | 'margin-advance' | 'stop';
export type MoveStatus =
  | 'planned'
  | 'booking'
  | 'booked'
  | 'deploying'
  | 'deployed'
  | 'forwarding'
  | 'forwarded'
  | 'sending'
  | 'sent'
  | 'approving'
  | 'approved'
  | 'returning'
  | 'done'
  | 'failed';

/** Sending, or about to: at most one per pool (the unique index). */
export const ACTING: MoveStatus[] = ['planned', 'booking', 'deploying', 'deployed', 'forwarding', 'sending', 'approving', 'approved', 'returning'];
/** Waiting on the bank or the off-ramp; they do not block a new move. */
export const WAITING: MoveStatus[] = ['booked', 'forwarded', 'sent'];

export interface MoveRow {
  id: number;
  chainId: number;
  pool: string;
  kind: MoveKind;
  cutoffAt: Date | null;
  ref: string | null;
  due: bigint;
  need: bigint;
  amount: bigint;
  capShort: bigint;
  poolShort: bigint;
  safeBatch: unknown | null;
  nonceBefore: number | null;
  fromBlock: number | null;
  bankToken: string | null;
  deployTx: string | null;
  forwardTx: string | null;
  approveTx: string | null;
  returnTx: string | null;
  forwardedAt: Date | null;
  offrampRef: string | null;
  arrivedAt: Date | null;
  status: MoveStatus;
  error: string | null;
  recordedBy: string | null;
  note: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  clearedAt: Date | null;
  clearedBy: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const date = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v : new Date(v));
const big = (v: unknown) => BigInt(String(v ?? 0));
const num = (v: unknown) => (v == null ? null : Number(v));

function row(r: any): MoveRow {
  return {
    id: Number(r.id),
    chainId: Number(r.chain_id),
    pool: r.pool,
    kind: r.kind,
    cutoffAt: date(r.cutoff_at),
    ref: r.ref,
    due: big(r.due),
    need: big(r.need),
    amount: big(r.amount),
    capShort: big(r.cap_short),
    poolShort: big(r.pool_short),
    safeBatch: typeof r.safe_batch === 'string' ? JSON.parse(r.safe_batch) : r.safe_batch,
    nonceBefore: num(r.nonce_before),
    fromBlock: num(r.from_block),
    bankToken: r.bank_token,
    deployTx: r.deploy_tx,
    forwardTx: r.forward_tx,
    approveTx: r.approve_tx,
    returnTx: r.return_tx,
    forwardedAt: date(r.forwarded_at),
    offrampRef: r.offramp_ref,
    arrivedAt: date(r.arrived_at),
    status: r.status,
    error: r.error,
    recordedBy: r.recorded_by,
    note: r.note,
    createdAt: date(r.created_at)!,
    finishedAt: date(r.finished_at),
    clearedAt: date(r.cleared_at),
    clearedBy: r.cleared_by,
  };
}

export interface NewMove {
  kind: MoveKind;
  cutoffAt: Date | null;
  ref: string | null;
  due: bigint;
  need: bigint;
  amount: bigint;
  capShort?: bigint;
  poolShort?: bigint;
  safeBatch?: unknown | null;
  nonceBefore?: number | null;
  fromBlock?: number | null;
  bankToken?: string | null;
  status: MoveStatus;
  recordedBy?: string | null;
  note?: string | null;
}

export type MovePatch = Partial<
  Pick<MoveRow, 'status' | 'deployTx' | 'forwardTx' | 'approveTx' | 'returnTx' | 'error' | 'bankToken' | 'offrampRef' | 'arrivedAt' | 'forwardedAt' | 'nonceBefore' | 'fromBlock'>
>;

export interface CheckRecord {
  checkedAt: Date;
  cutoffAt: Date | null;
  need: bigint;
  surplus: bigint;
  csa: bigint | null;
  outcome: string;
  snapshot: unknown;
}

export interface DayRecord {
  day: string;
  authorized: bigint;
  settled: bigint;
  fundedBook: bigint;
  fundedPool: bigint;
  returnedMargin: bigint;
  returnedPool: bigint;
  marginAdvanced: bigint;
  csaClose: bigint | null;
  snapshot: unknown;
}

export interface DeskStore {
  acting(): Promise<MoveRow | null>;
  waiting(): Promise<MoveRow[]>;
  halted(): Promise<MoveRow | null>;
  /** Records a move before its first transaction. Throws if one is already acting (the unique index). */
  create(m: NewMove): Promise<MoveRow>;
  update(id: number, patch: MovePatch): Promise<MoveRow>;
  recent(limit: number): Promise<MoveRow[]>;
  /** Money on its way to the CSA: book transfers not landed, Deployments not arrived. */
  inFlight(): Promise<{ book: bigint; offRamp: bigint }>;
  /** Margin advanced and not yet restored. */
  marginOutstanding(): Promise<bigint>;
  /** The longest off-ramp latency among the last arrivals, minutes; null with none. */
  measuredLatencyMinutes(last?: number): Promise<number | null>;
  saveCheck(c: CheckRecord): Promise<void>;
  lastCheck(): Promise<(CheckRecord & { id: number }) | null>;
  /** The lowest surplus over the checks since `since`; null unless a check at or before `since` exists. */
  idleSurplus(since: Date): Promise<bigint | null>;
  /** Done moves of each kind finished within [from, to). */
  doneBetween(from: Date, to: Date): Promise<Record<MoveKind, bigint>>;
  saveDay(d: DayRecord): Promise<boolean>;
  days(limit: number): Promise<DayRecord[]>;
}

export function deskStore(db: Queryable, chainId: number, pool: string): DeskStore {
  const p = pool.toLowerCase();
  const where = 'chain_id = $1 AND lower(pool) = $2';
  const one = async (sql: string, params: unknown[]) => {
    const { rows } = await db.query<any>(sql, params);
    return rows[0] ? row(rows[0]) : null;
  };
  return {
    acting: () => one(`SELECT * FROM ops.settlement_funding_moves WHERE ${where} AND status = ANY($3::text[]) ORDER BY id DESC LIMIT 1`, [chainId, p, ACTING]),
    async waiting() {
      const { rows } = await db.query<any>(`SELECT * FROM ops.settlement_funding_moves WHERE ${where} AND status = ANY($3::text[]) ORDER BY id`, [chainId, p, WAITING]);
      return rows.map(row);
    },
    halted: () => one(`SELECT * FROM ops.settlement_funding_moves WHERE ${where} AND status = 'failed' AND cleared_at IS NULL ORDER BY id DESC LIMIT 1`, [chainId, p]),
    async create(m) {
      const { rows } = await db.query<any>(
        `INSERT INTO ops.settlement_funding_moves
           (chain_id, pool, kind, cutoff_at, ref, due, need, amount, cap_short, pool_short, safe_batch, nonce_before, from_block, bank_token, status, recorded_by, note, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CASE WHEN $15 = 'done' THEN now() END) RETURNING *`,
        [
          chainId, p, m.kind, m.cutoffAt ? m.cutoffAt.toISOString() : null, m.ref, m.due.toString(), m.need.toString(), m.amount.toString(),
          (m.capShort ?? 0n).toString(), (m.poolShort ?? 0n).toString(), m.safeBatch == null ? null : JSON.stringify(m.safeBatch),
          m.nonceBefore ?? null, m.fromBlock ?? null, m.bankToken ?? null, m.status, m.recordedBy ?? null, m.note ?? null,
        ],
      );
      return row(rows[0]);
    },
    async update(id, patch) {
      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id];
      const put = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (patch.status !== undefined) {
        put('status', patch.status);
        if (patch.status === 'done' || patch.status === 'failed') sets.push('finished_at = now()');
      }
      const cols: Array<[keyof MovePatch, string]> = [
        ['deployTx', 'deploy_tx'], ['forwardTx', 'forward_tx'], ['approveTx', 'approve_tx'], ['returnTx', 'return_tx'], ['error', 'error'],
        ['bankToken', 'bank_token'], ['offrampRef', 'offramp_ref'], ['nonceBefore', 'nonce_before'], ['fromBlock', 'from_block'],
      ];
      for (const [k, c] of cols) if (patch[k] !== undefined) put(c, patch[k]);
      if (patch.arrivedAt !== undefined) put('arrived_at', patch.arrivedAt ? patch.arrivedAt.toISOString() : null);
      if (patch.forwardedAt !== undefined) put('forwarded_at', patch.forwardedAt ? patch.forwardedAt.toISOString() : null);
      const { rows } = await db.query<any>(`UPDATE ops.settlement_funding_moves SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
      return row(rows[0]);
    },
    async recent(limit) {
      const { rows } = await db.query<any>(`SELECT * FROM ops.settlement_funding_moves WHERE ${where} ORDER BY id DESC LIMIT $3`, [chainId, p, limit]);
      return rows.map(row);
    },
    async inFlight() {
      const { rows } = await db.query<{ kind: string; total: string }>(
        `SELECT kind, COALESCE(SUM(amount), 0)::text AS total FROM ops.settlement_funding_moves
          WHERE ${where} AND kind IN ('book', 'deploy') AND status NOT IN ('done', 'failed') GROUP BY kind`,
        [chainId, p],
      );
      const by = Object.fromEntries(rows.map((r) => [r.kind, BigInt(r.total)]));
      return { book: by.book ?? 0n, offRamp: by.deploy ?? 0n };
    },
    async marginOutstanding() {
      const { rows } = await db.query<{ advanced: string; restored: string }>(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'margin-advance'), 0)::text AS advanced,
                COALESCE(SUM(amount) FILTER (WHERE kind = 'return-margin'), 0)::text AS restored
           FROM ops.settlement_funding_moves WHERE ${where} AND status = 'done'`,
        [chainId, p],
      );
      const v = BigInt(rows[0]?.advanced ?? '0') - BigInt(rows[0]?.restored ?? '0');
      return v > 0n ? v : 0n;
    },
    async measuredLatencyMinutes(last = 10) {
      const { rows } = await db.query<{ forwarded_at: Date | string; arrived_at: Date | string }>(
        `SELECT forwarded_at, arrived_at FROM ops.settlement_funding_moves
          WHERE ${where} AND kind = 'deploy' AND forwarded_at IS NOT NULL AND arrived_at IS NOT NULL ORDER BY id DESC LIMIT $3`,
        [chainId, p, last],
      );
      if (!rows.length) return null;
      return Math.max(...rows.map((r) => Math.ceil((date(r.arrived_at)!.getTime() - date(r.forwarded_at)!.getTime()) / 60_000)));
    },
    async saveCheck(c) {
      await db.query(
        `INSERT INTO ops.settlement_funding_checks (chain_id, pool, checked_at, cutoff_at, need, surplus, csa, outcome, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [chainId, p, c.checkedAt.toISOString(), c.cutoffAt ? c.cutoffAt.toISOString() : null, c.need.toString(), c.surplus.toString(), c.csa === null ? null : c.csa.toString(), c.outcome, JSON.stringify(c.snapshot)],
      );
      // Keep a month of checks: the return window needs a day or two, the Command Center the latest.
      await db.query(`DELETE FROM ops.settlement_funding_checks WHERE ${where} AND checked_at < $3`, [chainId, p, new Date(c.checkedAt.getTime() - 31 * 86_400_000).toISOString()]);
    },
    async lastCheck() {
      const { rows } = await db.query<any>(`SELECT * FROM ops.settlement_funding_checks WHERE ${where} ORDER BY checked_at DESC, id DESC LIMIT 1`, [chainId, p]);
      const r = rows[0];
      if (!r) return null;
      return {
        id: Number(r.id),
        checkedAt: date(r.checked_at)!,
        cutoffAt: date(r.cutoff_at),
        need: big(r.need),
        surplus: big(r.surplus),
        csa: r.csa == null ? null : big(r.csa),
        outcome: r.outcome,
        snapshot: typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot,
      };
    },
    async idleSurplus(since) {
      // From the last check at or before `since` (the state when the window opened) to now.
      const { rows } = await db.query<{ low: string | null }>(
        `SELECT MIN(surplus)::text AS low FROM ops.settlement_funding_checks
          WHERE ${where} AND checked_at >= (SELECT MAX(checked_at) FROM ops.settlement_funding_checks WHERE ${where} AND checked_at <= $3)`,
        [chainId, p, since.toISOString()],
      );
      return rows[0]?.low == null ? null : BigInt(rows[0].low);
    },
    async doneBetween(from, to) {
      const { rows } = await db.query<{ kind: MoveKind; total: string }>(
        `SELECT kind, COALESCE(SUM(amount), 0)::text AS total FROM ops.settlement_funding_moves
          WHERE ${where} AND status = 'done' AND finished_at >= $3 AND finished_at < $4 GROUP BY kind`,
        [chainId, p, from.toISOString(), to.toISOString()],
      );
      const out: Record<MoveKind, bigint> = { book: 0n, deploy: 0n, 'return-margin': 0n, 'return-pool': 0n, 'margin-advance': 0n, stop: 0n };
      for (const r of rows) out[r.kind] = BigInt(r.total);
      return out;
    },
    async saveDay(d) {
      const { rows } = await db.query<{ day: string }>(
        `INSERT INTO ops.settlement_funding_days
           (chain_id, pool, day, authorized, settled, funded_book, funded_pool, returned_margin, returned_pool, margin_advanced, csa_close, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (chain_id, pool, day) DO NOTHING RETURNING day`,
        [
          chainId, p, d.day, d.authorized.toString(), d.settled.toString(), d.fundedBook.toString(), d.fundedPool.toString(),
          d.returnedMargin.toString(), d.returnedPool.toString(), d.marginAdvanced.toString(), d.csaClose === null ? null : d.csaClose.toString(), JSON.stringify(d.snapshot),
        ],
      );
      return rows.length > 0;
    },
    async days(limit) {
      const { rows } = await db.query<any>(`SELECT * FROM ops.settlement_funding_days WHERE ${where} ORDER BY day DESC LIMIT $3`, [chainId, p, limit]);
      return rows.map((r) => ({
        day: typeof r.day === 'string' ? r.day.slice(0, 10) : date(r.day)!.toISOString().slice(0, 10),
        authorized: big(r.authorized),
        settled: big(r.settled),
        fundedBook: big(r.funded_book),
        fundedPool: big(r.funded_pool),
        returnedMargin: big(r.returned_margin),
        returnedPool: big(r.returned_pool),
        marginAdvanced: big(r.margin_advanced),
        csaClose: r.csa_close == null ? null : big(r.csa_close),
        snapshot: typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot,
      }));
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Clears a failed move so the desk moves money again: a person has looked at it. */
export async function clearDeskHalt(db: Queryable, id: number, by: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ops.settlement_funding_moves SET cleared_at = now(), cleared_by = $2, updated_at = now() WHERE id = $1 AND status = 'failed' AND cleared_at IS NULL RETURNING id`,
    [id, by],
  );
  return rows.length > 0;
}

/** Records that the Savings-Backed Margin covered part of a settlement at the bank (nothing is sent). */
export async function recordMarginAdvance(db: Queryable, chainId: number, pool: string, amount: bigint, by: string, note: string): Promise<MoveRow> {
  if (amount <= 0n) throw new Error('A Margin advance is a positive amount.');
  return deskStore(db, chainId, pool).create({ kind: 'margin-advance', cutoffAt: null, ref: null, due: 0n, need: 0n, amount, status: 'done', recordedBy: by, note });
}

/**
 * A person stops the desk (Command's "Stop the desk"): a 'stop' move, failed at once, so the desk halts on it as it does on
 * any failed move and moves nothing until two people restart it (which clears it). It moves no money.
 */
export async function stopDesk(db: Queryable, chainId: number, pool: string, by: string, why: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ops.settlement_funding_moves (chain_id, pool, kind, amount, status, error, recorded_by, note, finished_at)
     VALUES ($1, $2, 'stop', 0, 'failed', $3, $4, $5, now()) RETURNING id`,
    [chainId, pool, `Stopped by ${by}: ${why}`, by, why],
  );
  return Number(rows[0].id);
}

/** Every pool's latest check, recent moves, halt and days, for the Command Center (no chain read). */
export async function deskOverview(db: Queryable, limit = 10) {
  const { rows } = await db.query<{ chain_id: number; pool: string }>(
    `SELECT DISTINCT ON (chain_id, lower(pool)) chain_id, lower(pool) AS pool FROM ops.settlement_funding_checks ORDER BY chain_id, lower(pool), checked_at DESC`,
  );
  return Promise.all(
    rows.map(async (r) => {
      const s = deskStore(db, Number(r.chain_id), r.pool);
      return {
        chainId: Number(r.chain_id),
        pool: r.pool,
        lastCheck: await s.lastCheck(),
        recent: await s.recent(limit),
        halted: await s.halted(),
        marginOutstanding: await s.marginOutstanding(),
        days: await s.days(7),
      };
    }),
  );
}
