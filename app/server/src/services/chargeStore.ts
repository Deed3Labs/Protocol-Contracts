import crypto from 'crypto';
import { getPostgresPool } from '../config/postgres.js';

/*
 * Charges a merchant has raised against a member's Clear account.
 *
 * A row is a *request*, not a debt. Nothing here moves money; approving one opens a term plan on
 * chain and that is what a member owes. The distinction runs through the whole table -- the status
 * column is the only thing that says whether a charge became anything, and it is written in one
 * place after the chain call returns.
 *
 * The code is the address. It goes out by text, so it is short enough to read aloud and random
 * enough that guessing one is not a way to see what somebody is being charged: 8 chars of
 * Crockford-ish base32 over a crypto RNG is ~40 bits, and a wrong guess reveals nothing because
 * the read is member-authenticated on top.
 */
const TABLE = 'charge_requests';
let ensured = false;

/**
 * `resolving` is a real, visible state, not an implementation detail.
 *
 * It exists for the seconds between claiming a charge and the chain call returning. If the process
 * dies in that window the row stays here, and that is deliberate: the alternative is releasing it
 * back to pending, where a member could approve a charge whose plan had in fact already been
 * opened. A stuck charge is visible and fixable; a duplicate term plan is somebody owing twice.
 */
export type ChargeStatus = 'pending' | 'resolving' | 'approved' | 'declined' | 'expired';

export interface ChargeRow {
  code: string;
  merchantAddress: string;
  merchantName: string;
  memberWallet: string;
  amountCents: number;
  /** What the merchant receives, after their discount. The difference is the co-op's. */
  payoutCents: number;
  status: ChargeStatus;
  /** Only once approved. */
  splitInto: number | null;
  planId: number | null;
  txHash: string | null;
  chainId: number;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  /** Set the first time the member opens it — the merchant's "waiting" state reads this. */
  openedAt: string | null;
}

interface DbRow {
  code: string;
  merchant_address: string;
  merchant_name: string;
  member_wallet: string;
  amount_cents: string | number;
  payout_cents: string | number;
  status: ChargeStatus;
  split_into: number | null;
  plan_id: string | number | null;
  tx_hash: string | null;
  chain_id: number;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  opened_at: string | null;
}

// No I, L, O or U: read over a phone line, those are the ones that come back wrong.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateChargeCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const normalizeWallet = (w: string) => w.trim().toLowerCase();

async function ensureTables(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      code TEXT PRIMARY KEY,
      merchant_address TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      member_wallet TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      payout_cents BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      split_into INTEGER,
      plan_id BIGINT,
      tx_hash TEXT,
      chain_id INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS charge_member_idx ON ${TABLE} (member_wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS charge_merchant_idx ON ${TABLE} (merchant_address, created_at DESC);
  `);
  ensured = true;
}

/**
 * Expiry is derived on read, never swept.
 *
 * A cron that marks rows expired is a second writer racing the approve path, and the window it
 * races in is exactly the moment a member is pressing Approve on a charge about to lapse. The
 * approve path re-checks the deadline inside its own transaction, so the read here is only ever
 * telling the UI what it already knows.
 */
function withDerivedStatus(row: ChargeRow): ChargeRow {
  if (row.status !== 'pending') return row;
  if (Date.parse(row.expiresAt) <= Date.now()) return { ...row, status: 'expired' };
  return row;
}

const toRow = (r: DbRow): ChargeRow =>
  withDerivedStatus({
    code: r.code,
    merchantAddress: r.merchant_address,
    merchantName: r.merchant_name,
    memberWallet: r.member_wallet,
    amountCents: Number(r.amount_cents),
    payoutCents: Number(r.payout_cents),
    status: r.status,
    splitInto: r.split_into,
    planId: r.plan_id == null ? null : Number(r.plan_id),
    txHash: r.tx_hash,
    chainId: r.chain_id,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    openedAt: r.opened_at,
  });

const COLUMNS = `code, merchant_address, merchant_name, member_wallet, amount_cents, payout_cents,
                 status, split_into, plan_id, tx_hash, chain_id, expires_at, created_at,
                 resolved_at, opened_at`;

export const chargeStore = {
  isConfigured(): boolean {
    return !!getPostgresPool();
  },

  async create(input: {
    merchantAddress: string;
    merchantName: string;
    memberWallet: string;
    amountCents: number;
    payoutCents: number;
    chainId: number;
    ttlSeconds: number;
  }): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();

    // Retry on the vanishingly unlikely collision rather than trusting the RNG blindly. Cheap,
    // and the alternative is a merchant seeing somebody else's charge.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateChargeCode();
      const result = await pool.query<DbRow>(
        `INSERT INTO ${TABLE}
           (code, merchant_address, merchant_name, member_wallet, amount_cents, payout_cents,
            chain_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          code,
          normalizeWallet(input.merchantAddress),
          input.merchantName,
          normalizeWallet(input.memberWallet),
          input.amountCents,
          input.payoutCents,
          input.chainId,
          String(input.ttlSeconds),
        ],
      );
      if (result.rows[0]) return toRow(result.rows[0]);
    }
    return null;
  },

  async get(code: string): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(`SELECT ${COLUMNS} FROM ${TABLE} WHERE code = $1`, [
      code.trim().toUpperCase(),
    ]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  },

  /** First open only — the merchant's "waiting" state distinguishes sent from seen. */
  async markOpened(code: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET opened_at = now() WHERE code = $1 AND opened_at IS NULL`,
      [code.trim().toUpperCase()],
    );
  },

  /**
   * Claim a pending, unexpired charge for resolution.
   *
   * The guard is in the WHERE clause rather than in a read-then-write, so two taps on Approve
   * cannot both pass it. Returns null when the row was already resolved or has lapsed, and the
   * caller must treat that as "somebody else got there first" rather than as an error — the
   * expensive part is what comes after, and it must not run twice.
   */
  async claimForResolution(code: string): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      `UPDATE ${TABLE} SET status = 'resolving'
        WHERE code = $1 AND status = 'pending' AND expires_at > now()
        RETURNING ${COLUMNS}`,
      [code.trim().toUpperCase()],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  },

  async finish(
    code: string,
    input: { status: ChargeStatus; splitInto?: number; planId?: number; txHash?: string },
  ): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      // Only a row this request claimed. Without it a late retry could overwrite a charge that had
      // already been resolved some other way.
      `UPDATE ${TABLE}
          SET status = $2, split_into = $3, plan_id = $4, tx_hash = $5, resolved_at = now()
        WHERE code = $1 AND status = 'resolving'
        RETURNING ${COLUMNS}`,
      [
        code.trim().toUpperCase(),
        input.status,
        input.splitInto ?? null,
        input.planId ?? null,
        input.txHash ?? null,
      ],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  },

  /**
   * Record the transaction the moment it is submitted, before waiting for it.
   *
   * This is what makes a crash recoverable rather than a puzzle. Without the hash, a charge stuck
   * in `resolving` can only be reconciled by hunting for an event that looks about right — same
   * member, same amount, roughly the same time — and "looks about right" is not good enough to
   * decide whether somebody owes money. With it, reconciliation asks the chain one exact question.
   */
  async markSubmitted(code: string, txHash: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET tx_hash = $2 WHERE code = $1 AND status = 'resolving'`,
      [code.trim().toUpperCase(), txHash],
    );
  },

  /**
   * Charges that have been resolving longer than they should be.
   *
   * Only ever `resolving`, which is why this cannot race the approve path: that path claims rows
   * that are `pending`, and the two sets do not overlap. The separation is deliberate — a sweep
   * that touched pending rows would be a second writer arriving exactly when a member is
   * answering a charge about to lapse.
   */
  async listStuck(olderThanSeconds: number, limit = 50): Promise<ChargeRow[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query<DbRow>(
      `SELECT ${COLUMNS} FROM ${TABLE}
        WHERE status = 'resolving'
          AND created_at < now() - ($1 || ' seconds')::interval
        ORDER BY created_at ASC
        LIMIT $2`,
      [String(olderThanSeconds), limit],
    );
    return r.rows.map(toRow);
  },

  /** Put a claimed row back when the chain call failed — it never became anything. */
  async release(code: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET status = 'pending' WHERE code = $1 AND status = 'resolving'`, [
      code.trim().toUpperCase(),
    ]);
  },
};
