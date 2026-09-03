import { getPayPool } from '../../config/postgres.js';

/*
 * Money pulled from an outside bank that has not yet earned the right to be collateral.
 *
 * This table exists for one rule: a debit can be returned. Until its window closes, the amount is
 * held out of the savings-backed limit — so a member cannot borrow against money that is still
 * capable of vanishing, and the co-op cannot lend against it either.
 *
 * Rows are never deleted. A settled pull stays as history, a returned one stays as evidence, and
 * the reconciler needs both to explain why a limit moved.
 */

const TABLE = 'lithic_pulled_funds';

export type PulledFundsStatus = 'pending' | 'cleared' | 'returned';

export interface PulledFunds {
  wallet: string;
  idempotencyToken: string;
  paymentToken: string | null;
  amountCents: number;
  secCode: string;
  status: PulledFundsStatus;
  collateralEligibleAt: string;
  returnReasonCode: string | null;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      idempotency_token TEXT PRIMARY KEY,
      payment_token TEXT,
      wallet TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      sec_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      collateral_eligible_at TIMESTAMPTZ NOT NULL,
      return_reason_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_wallet_idx ON ${TABLE} (wallet, status);
    CREATE INDEX IF NOT EXISTS ${TABLE}_payment_idx ON ${TABLE} (payment_token);
  `);
  ensured = true;
}

interface Row {
  wallet: string;
  idempotency_token: string;
  payment_token: string | null;
  amount_cents: string;
  sec_code: string;
  status: PulledFundsStatus;
  collateral_eligible_at: Date;
  return_reason_code: string | null;
}

function toRecord(row: Row): PulledFunds {
  return {
    wallet: row.wallet,
    idempotencyToken: row.idempotency_token,
    paymentToken: row.payment_token,
    amountCents: parseInt(row.amount_cents, 10) || 0,
    secCode: row.sec_code,
    status: row.status,
    collateralEligibleAt: row.collateral_eligible_at.toISOString(),
    returnReasonCode: row.return_reason_code,
  };
}

export const pulledFundsStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  /** Written before the debit is created, so a pull can never land unrecorded. */
  async record(input: {
    wallet: string;
    idempotencyToken: string;
    amountCents: number;
    secCode: string;
    collateralEligibleAt: string;
  }): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (idempotency_token, wallet, amount_cents, sec_code, collateral_eligible_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_token) DO NOTHING`,
      [
        input.idempotencyToken,
        input.wallet.toLowerCase(),
        Math.round(input.amountCents),
        input.secCode,
        input.collateralEligibleAt,
      ],
    );
  },

  async attachPaymentToken(idempotencyToken: string, paymentToken: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(
      `UPDATE ${TABLE} SET payment_token = $2, updated_at = now() WHERE idempotency_token = $1`,
      [idempotencyToken, paymentToken],
    );
  },

  /**
   * How much of this member's money is still capable of being clawed back.
   *
   * The figure the snapshot subtracts before computing the savings-backed limit. Counts only rows
   * still pending and still inside their window — a cleared pull is ordinary money.
   */
  async pendingCollateralCents(wallet: string): Promise<number> {
    const pool = getPayPool();
    if (!pool) return 0;
    await ensureTable();
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM ${TABLE}
       WHERE wallet = $1 AND status = 'pending' AND collateral_eligible_at > now()`,
      [wallet.toLowerCase()],
    );
    return parseInt(rows[0]?.total ?? '0', 10) || 0;
  },

  /**
   * Release everything whose window has closed.
   *
   * Returns the wallets it touched so their snapshots can be rewritten — a limit that rises without
   * the snapshot noticing is a member being declined for money they now have.
   */
  async clearElapsed(): Promise<string[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<{ wallet: string }>(
      `UPDATE ${TABLE}
       SET status = 'cleared', updated_at = now()
       WHERE status = 'pending' AND collateral_eligible_at <= now()
       RETURNING DISTINCT wallet`,
    );
    return rows.map((r) => r.wallet);
  },

  /** A return arrived. The money is going back; it must never become collateral. */
  async markReturned(paymentToken: string, returnReasonCode: string): Promise<PulledFunds | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `UPDATE ${TABLE}
       SET status = 'returned', return_reason_code = $2, updated_at = now()
       WHERE payment_token = $1
       RETURNING *`,
      [paymentToken, returnReasonCode],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async listFor(wallet: string): Promise<PulledFunds[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE wallet = $1 ORDER BY created_at DESC`,
      [wallet.toLowerCase()],
    );
    return rows.map(toRecord);
  },
};
