import type { Queryable } from '../../db/db.js';
import type { TopUpTrigger } from './topUp.js';

/*
 * The automatic top-ups' records (migration 0078): one row per top-up, and the latest check per pool.
 * Addresses are stored lower-case. Amounts are USDC base units, as NUMERIC, read back as bigint.
 */

export type TopUpStatus = 'planned' | 'pulling' | 'pulled' | 'approving' | 'approved' | 'funding' | 'funded' | 'failed';
export const IN_FLIGHT: TopUpStatus[] = ['planned', 'pulling', 'pulled', 'approving', 'approved', 'funding'];

export interface TopUpRow {
  id: number;
  chainId: number;
  payoutPool: string;
  trigger: TopUpTrigger | 'wallet-balance';
  lowShort: bigint;
  targetShort: bigint;
  need: bigint;
  amount: bigint;
  remainder: bigint;
  safeBatch: unknown | null;
  nonceBefore: number | null;
  pullTx: string | null;
  approveTx: string | null;
  fundTx: string | null;
  status: TopUpStatus;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  clearedAt: Date | null;
  clearedBy: string | null;
}

interface Raw {
  id: string | number;
  chain_id: number;
  payout_pool: string;
  trigger: TopUpRow['trigger'];
  low_short: string;
  target_short: string;
  need: string;
  amount: string;
  remainder: string;
  safe_batch: unknown | null;
  nonce_before: number | null;
  pull_tx: string | null;
  approve_tx: string | null;
  fund_tx: string | null;
  status: TopUpStatus;
  error: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
  cleared_at: Date | string | null;
  cleared_by: string | null;
}

const date = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

function row(r: Raw): TopUpRow {
  return {
    id: Number(r.id),
    chainId: Number(r.chain_id),
    payoutPool: r.payout_pool,
    trigger: r.trigger,
    lowShort: BigInt(r.low_short),
    targetShort: BigInt(r.target_short),
    need: BigInt(r.need),
    amount: BigInt(r.amount),
    remainder: BigInt(r.remainder),
    safeBatch: r.safe_batch,
    nonceBefore: r.nonce_before == null ? null : Number(r.nonce_before),
    pullTx: r.pull_tx,
    approveTx: r.approve_tx,
    fundTx: r.fund_tx,
    status: r.status,
    error: r.error,
    createdAt: date(r.created_at)!,
    finishedAt: date(r.finished_at),
    clearedAt: date(r.cleared_at),
    clearedBy: r.cleared_by,
  };
}

export interface NewTopUp {
  trigger: TopUpRow['trigger'];
  lowShort: bigint;
  targetShort: bigint;
  need: bigint;
  amount: bigint;
  remainder: bigint;
  safeBatch: unknown | null;
  nonceBefore: number | null;
  /** 'planned' before a pull; 'pulled' when the money is already in the wallet. */
  status: 'planned' | 'pulled';
}

export type TopUpPatch = Partial<Pick<TopUpRow, 'status' | 'pullTx' | 'approveTx' | 'fundTx' | 'error'>>;

export interface TopUpStore {
  /** The pool's top-up in flight, if any. */
  inFlight(): Promise<TopUpRow | null>;
  /** The newest failed top-up nobody has cleared: while there is one, the job moves nothing. */
  halted(): Promise<TopUpRow | null>;
  /** Records a top-up before its first transaction. Throws if one is already in flight (the unique index). */
  create(t: NewTopUp): Promise<TopUpRow>;
  update(id: number, patch: TopUpPatch): Promise<TopUpRow>;
  recent(limit: number): Promise<TopUpRow[]>;
  saveCheck(checkedAt: Date, snapshot: unknown): Promise<void>;
  lastCheck(): Promise<{ checkedAt: Date; snapshot: unknown } | null>;
}

/** The store for one pool on one chain. */
export function topUpStore(db: Queryable, chainId: number, payoutPool: string): TopUpStore {
  const pool = payoutPool.toLowerCase();
  const where = 'chain_id = $1 AND lower(payout_pool) = $2';
  return {
    async inFlight() {
      const { rows } = await db.query<Raw>(
        `SELECT * FROM ops.payout_topups WHERE ${where} AND status <> ALL($3::text[]) ORDER BY id DESC LIMIT 1`,
        [chainId, pool, ['funded', 'failed']],
      );
      return rows[0] ? row(rows[0]) : null;
    },
    async halted() {
      const { rows } = await db.query<Raw>(
        `SELECT * FROM ops.payout_topups WHERE ${where} AND status = 'failed' AND cleared_at IS NULL ORDER BY id DESC LIMIT 1`,
        [chainId, pool],
      );
      return rows[0] ? row(rows[0]) : null;
    },
    async create(t) {
      const { rows } = await db.query<Raw>(
        `INSERT INTO ops.payout_topups (chain_id, payout_pool, trigger, low_short, target_short, need, amount, remainder, safe_batch, nonce_before, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          chainId, pool, t.trigger, t.lowShort.toString(), t.targetShort.toString(), t.need.toString(), t.amount.toString(),
          t.remainder.toString(), t.safeBatch == null ? null : JSON.stringify(t.safeBatch), t.nonceBefore, t.status,
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
        if (patch.status === 'funded' || patch.status === 'failed') sets.push('finished_at = now()');
      }
      if (patch.pullTx !== undefined) put('pull_tx', patch.pullTx);
      if (patch.approveTx !== undefined) put('approve_tx', patch.approveTx);
      if (patch.fundTx !== undefined) put('fund_tx', patch.fundTx);
      if (patch.error !== undefined) put('error', patch.error);
      const { rows } = await db.query<Raw>(`UPDATE ops.payout_topups SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
      return row(rows[0]);
    },
    async recent(limit) {
      const { rows } = await db.query<Raw>(`SELECT * FROM ops.payout_topups WHERE ${where} ORDER BY id DESC LIMIT $3`, [chainId, pool, limit]);
      return rows.map(row);
    },
    async saveCheck(checkedAt, snapshot) {
      await db.query(
        `INSERT INTO ops.payout_topup_checks (chain_id, payout_pool, checked_at, snapshot) VALUES ($1, $2, $3, $4)
         ON CONFLICT (chain_id, payout_pool) DO UPDATE SET checked_at = EXCLUDED.checked_at, snapshot = EXCLUDED.snapshot`,
        [chainId, pool, checkedAt.toISOString(), JSON.stringify(snapshot)],
      );
    },
    async lastCheck() {
      const { rows } = await db.query<{ checked_at: Date | string; snapshot: unknown }>(
        'SELECT checked_at, snapshot FROM ops.payout_topup_checks WHERE chain_id = $1 AND payout_pool = $2',
        [chainId, pool],
      );
      return rows[0] ? { checkedAt: date(rows[0].checked_at)!, snapshot: typeof rows[0].snapshot === 'string' ? JSON.parse(rows[0].snapshot) : rows[0].snapshot } : null;
    },
  };
}

/** Clears a failed top-up so the job moves money again: a person has looked at it. */
export async function clearTopUpHalt(db: Queryable, id: number, by: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ops.payout_topups SET cleared_at = now(), cleared_by = $2, updated_at = now() WHERE id = $1 AND status = 'failed' AND cleared_at IS NULL RETURNING id`,
    [id, by],
  );
  return rows.length > 0;
}

/** Every pool's latest check and recent top-ups, for the Command Center (no chain read). */
export async function topUpOverview(db: Queryable, limit = 5): Promise<Array<{ chainId: number; payoutPool: string; checkedAt: Date; snapshot: unknown; recent: TopUpRow[]; halted: TopUpRow | null }>> {
  const { rows } = await db.query<{ chain_id: number; payout_pool: string; checked_at: Date | string; snapshot: unknown }>(
    'SELECT * FROM ops.payout_topup_checks ORDER BY checked_at DESC',
  );
  return Promise.all(
    rows.map(async (r) => {
      const s = topUpStore(db, Number(r.chain_id), r.payout_pool);
      return {
        chainId: Number(r.chain_id),
        payoutPool: r.payout_pool,
        checkedAt: date(r.checked_at)!,
        snapshot: typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot,
        recent: await s.recent(limit),
        halted: await s.halted(),
      };
    }),
  );
}
