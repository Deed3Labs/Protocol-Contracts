import { getPayPool } from '../../config/postgres.js';

/*
 * The savings sweep, as an explicit state machine — spec step 7.
 *
 * A sweep is two movements on two rails that present to the member as one action: fiat leaves their
 * Lithic account for the co-op's, and the co-op's treasury sends USDC to their smart account where
 * the ESA mints CLRUSD. There is no transaction that spans a bank and a blockchain, so pretending
 * one exists is the mistake this table is built to avoid.
 *
 *   initiated → fiat_debited → usdc_sent → clrusd_minted → complete
 *
 * Every state is durable and every transition is idempotent, because the process can die between
 * any two of them and has to resume knowing exactly what already happened. A saga that loses its
 * place either double-sends money or strands it.
 *
 * READY_TO_ALLOCATE is the state that matters most. If the sweep fails after `usdc_sent`, the
 * member has USDC on their smart account that never reached the ESA. That is not an error to
 * retry silently — it is money in the wrong place, in their custody, and they need to see it and
 * be able to act on it: retry the allocation, move it to Earn, or send it back to cash.
 */

const TABLE = 'savings_sweeps';

export type SweepState =
  | 'initiated'
  | 'fiat_debited'
  | 'usdc_sent'
  | 'clrusd_minted'
  | 'complete'
  | 'ready_to_allocate'
  | 'failed';

/** States a runner should pick up. `ready_to_allocate` is deliberately absent — that one is the member's. */
export const RESUMABLE: SweepState[] = ['initiated', 'fiat_debited', 'usdc_sent', 'clrusd_minted'];

export interface Sweep {
  id: string;
  wallet: string;
  amountCents: number;
  state: SweepState;
  /** Set once the fiat leg lands, so a resume never debits twice. */
  fiatTransferToken: string | null;
  usdcTxHash: string | null;
  mintTxHash: string | null;
  /** When CLRUSD was minted — the vesting clock starts here, not at the fiat debit. */
  mintedAt: string | null;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  /** Sweeps sharing a batch key convert once at the treasury rather than fifty times. */
  batchKey: string | null;
  createdAt: string;
  updatedAt: string;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      state TEXT NOT NULL DEFAULT 'initiated',
      fiat_transfer_token TEXT,
      usdc_tx_hash TEXT,
      mint_tx_hash TEXT,
      minted_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      batch_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_state_idx ON ${TABLE} (state, next_attempt_at);
    CREATE INDEX IF NOT EXISTS ${TABLE}_wallet_idx ON ${TABLE} (wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS ${TABLE}_batch_idx ON ${TABLE} (batch_key) WHERE batch_key IS NOT NULL;
  `);
  ensured = true;
}

interface Row {
  id: string;
  wallet: string;
  amount_cents: string;
  state: SweepState;
  fiat_transfer_token: string | null;
  usdc_tx_hash: string | null;
  mint_tx_hash: string | null;
  minted_at: Date | null;
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  batch_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function toSweep(row: Row): Sweep {
  return {
    id: row.id,
    wallet: row.wallet,
    amountCents: parseInt(row.amount_cents, 10) || 0,
    state: row.state,
    fiatTransferToken: row.fiat_transfer_token,
    usdcTxHash: row.usdc_tx_hash,
    mintTxHash: row.mint_tx_hash,
    mintedAt: row.minted_at?.toISOString() ?? null,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    lastError: row.last_error,
    batchKey: row.batch_key,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Backoff between attempts: a minute, then four, then nine, capped at an hour.
 *
 * Quadratic rather than exponential because the failures this retries are usually transient and
 * short — an RPC blip, a nonce collision — and doubling to hours would strand a member's money over
 * a problem that cleared in ten minutes.
 */
export function backoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, attempts * attempts * 60 * 1000);
}

export const sweepStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  /**
   * Start a sweep. Idempotent on the caller's id, so a retried request — or a payday job that runs
   * twice — cannot debit the same member twice for the same intent.
   */
  async create(input: {
    id: string;
    wallet: string;
    amountCents: number;
    batchKey?: string | null;
  }): Promise<Sweep | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `INSERT INTO ${TABLE} (id, wallet, amount_cents, batch_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [input.id, input.wallet.toLowerCase(), Math.round(input.amountCents), input.batchKey ?? null],
    );
    return rows[0] ? toSweep(rows[0]) : null;
  },

  async get(id: string): Promise<Sweep | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
    return rows[0] ? toSweep(rows[0]) : null;
  },

  /**
   * Move a sweep forward.
   *
   * Takes the evidence of the step that just happened — the transfer token, the transaction hash —
   * so a resume can tell "already did this" from "never started". Resets the attempt counter,
   * because progress means the previous failure is no longer the situation.
   */
  async advance(
    id: string,
    state: SweepState,
    evidence: {
      fiatTransferToken?: string;
      usdcTxHash?: string;
      mintTxHash?: string;
      mintedAt?: string;
    } = {},
  ): Promise<Sweep | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `UPDATE ${TABLE}
       SET state = $2,
           fiat_transfer_token = COALESCE($3, fiat_transfer_token),
           usdc_tx_hash = COALESCE($4, usdc_tx_hash),
           mint_tx_hash = COALESCE($5, mint_tx_hash),
           minted_at = COALESCE($6::timestamptz, minted_at),
           attempts = 0,
           last_error = NULL,
           next_attempt_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        state,
        evidence.fiatTransferToken ?? null,
        evidence.usdcTxHash ?? null,
        evidence.mintTxHash ?? null,
        evidence.mintedAt ?? null,
      ],
    );
    return rows[0] ? toSweep(rows[0]) : null;
  },

  /**
   * Record a failure and schedule the retry.
   *
   * A sweep that has already sent USDC goes to `ready_to_allocate` rather than being retried
   * forever: the money is on the member's smart account and in their custody, and the honest thing
   * is to surface it rather than keep quietly trying to finish a job they can now finish themselves.
   */
  async fail(id: string, error: string, maxAttempts = 5): Promise<Sweep | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const current = await this.get(id);
    if (!current) return null;

    const attempts = current.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    const sentUsdc = current.usdcTxHash !== null;
    const nextState: SweepState = exhausted
      ? sentUsdc
        ? 'ready_to_allocate'
        : 'failed'
      : current.state;

    const { rows } = await pool.query<Row>(
      `UPDATE ${TABLE}
       SET state = $2, attempts = $3, last_error = $4,
           next_attempt_at = now() + ($5 || ' milliseconds')::interval,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, nextState, attempts, error.slice(0, 500), String(backoffMs(attempts))],
    );
    return rows[0] ? toSweep(rows[0]) : null;
  },

  /** Sweeps due for another attempt. */
  async due(limit = 25): Promise<Sweep[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE}
       WHERE state = ANY($1) AND next_attempt_at <= now()
       ORDER BY created_at ASC
       LIMIT $2`,
      [RESUMABLE, limit],
    );
    return rows.map(toSweep);
  },

  /** Everything a member needs to see, including money sitting in the recovery state. */
  async listFor(wallet: string): Promise<Sweep[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE wallet = $1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.toLowerCase()],
    );
    return rows.map(toSweep);
  },

  /**
   * Sweeps waiting on the chain leg, grouped so the treasury converts once.
   *
   * Fifty members sweeping on payday is one conversion, not fifty — the batching the spec asks for,
   * and the difference between a treasury operation and a fee-burning loop.
   */
  async batchReadyForChain(limit = 100): Promise<Map<string, Sweep[]>> {
    const pool = getPayPool();
    if (!pool) return new Map();
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE}
       WHERE state = 'fiat_debited' AND next_attempt_at <= now()
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );

    const batches = new Map<string, Sweep[]>();
    for (const row of rows) {
      const sweep = toSweep(row);
      const key = sweep.batchKey ?? 'unbatched';
      const existing = batches.get(key);
      if (existing) existing.push(sweep);
      else batches.set(key, [sweep]);
    }
    return batches;
  },
};
