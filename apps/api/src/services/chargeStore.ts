import crypto from 'crypto';
import { EventEmitter } from 'node:events';
import { getPostgresPool } from '../config/postgres.js';

/**
 * A charge was answered (approved, declined) or cancelled: `chargeEvents.on('resolved', (row) => …)`.
 *
 * A nudge for whoever mirrors charges elsewhere (the merchant back office's Clear tenders), fired
 * after the row is written. Best effort: a listener that throws is logged and ignored, and the
 * listener must be able to catch up anyway, because an expiry is never written and so never fires.
 */
export const chargeEvents = new EventEmitter();
const resolved = (row: ChargeRow | null) => {
  if (!row) return;
  try {
    chargeEvents.emit('resolved', row);
  } catch (error) {
    console.error('[charge] a resolved-charge listener failed:', error instanceof Error ? error.message : error);
  }
};

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
/** Exported so nothing else has to guess it. Guessing wrong is exactly what happened. */
export const CHARGE_TABLE_NAME = 'charge_requests';
const TABLE = CHARGE_TABLE_NAME;
let ensured = false;

/**
 * `resolving` is a real, visible state, not an implementation detail.
 *
 * It exists for the seconds between claiming a charge and the chain call returning. If the process
 * dies in that window the row stays here, and that is deliberate: the alternative is releasing it
 * back to pending, where a member could approve a charge whose plan had in fact already been
 * opened. A stuck charge is visible and fixable; a duplicate term plan is somebody owing twice.
 */
export type ChargeStatus =
  | 'pending'
  | 'resolving'
  | 'approved'
  | 'declined'
  | 'expired'
  /** The shop withdrew it before the member acted. */
  | 'cancelled'
  /** A refund settled against it. The in-flight refund states live in merchant.refunds. */
  | 'refunded'
  /** The member raised a dispute, and the plan is unwound while it is open. */
  | 'disputed';

export interface ChargeRow {
  code: string;
  merchantAddress: string;
  merchantName: string;
  memberWallet: string | null;
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
  /** The staff member who raised it. Null for charges raised before staff existed. */
  raisedBy: string | null;
  /** Paid from the member's Clear cash, not a plan: no plan id, and the shop is paid at the paid-now rate. */
  paidNow: boolean;
  /** Set while the member is paying now: what the shop and Clear are owed, and when the hold lapses. */
  payNow: PayNowHold | null;
  /**
   * A paid-now refund's two transfers back to the member, as they happen: the shop's share and
   * Clear's fee. A hash once sent, `sending` while one is in flight, null before. What makes a
   * retried refund skip what already went, rather than pay it twice.
   */
  refundLegs: { shop: string | null; clear: string | null };
}

/**
 * A charge held while the member pays it from their cash.
 *
 * Quoted once, when the hold is taken, and kept: the member's transfers are checked against these
 * figures, not against a rate read again later that might have moved in between.
 */
export interface PayNowHold {
  payoutCents: number;
  feeCents: number;
  /** Where Clear's fee goes. */
  feeTo: string;
  /** When the hold was taken: a payment before it is not a payment for this charge. */
  since: string;
  until: string;
}

interface DbRow {
  code: string;
  merchant_address: string;
  merchant_name: string;
  member_wallet: string | null;
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
  raised_by: string | null;
  paid_now: boolean | null;
  pay_now_payout_cents: string | number | null;
  pay_now_fee_cents: string | number | null;
  pay_now_fee_to: string | null;
  pay_now_at: string | null;
  pay_now_until: string | null;
  refund_shop_tx: string | null;
  refund_clear_tx: string | null;
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
  // Who raised it. Added separately because the table predates the merchant app, and a shop's
  // existing charges have no writer to attribute — the column is nullable and the UI says so
  // rather than inventing a name. Soft reference to merchant.staff(id): the schemas may one day
  // live in different databases, so this is not a foreign key.
  await pool.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS raised_by TEXT`);
  /**
   * The customer is not known when the charge is raised.
   *
   * Reference section 03: entering the amount goes straight to the code, because showing a code is
   * the only path that works for every customer. A new customer installs from it and an existing
   * member approves — either way nobody has said who they are yet, and a writer at a counter has
   * no way to ask without turning a two-tap flow into an interrogation.
   *
   * So the wallet arrives when the code is opened, not when it is raised. The column was NOT NULL
   * from when a merchant had to name the member up front; dropping that is what lets the designed
   * flow exist at all.
   */
  await pool.query(`ALTER TABLE ${TABLE} ALTER COLUMN member_wallet DROP NOT NULL`);
  // Paying now, from the member's cash. `pay_now_until` is what marks a `resolving` row as a pay-now
  // hold rather than a plan being opened: the two are reconciled differently (see listStuck).
  await pool.query(`
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS paid_now BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pay_now_payout_cents BIGINT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pay_now_fee_cents BIGINT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pay_now_fee_to TEXT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pay_now_at TIMESTAMPTZ;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS pay_now_until TIMESTAMPTZ;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS refund_shop_tx TEXT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS refund_clear_tx TEXT;
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
    raisedBy: r.raised_by ?? null,
    paidNow: Boolean(r.paid_now),
    payNow:
      r.pay_now_until && r.pay_now_fee_to
        ? {
            payoutCents: Number(r.pay_now_payout_cents),
            feeCents: Number(r.pay_now_fee_cents),
            feeTo: r.pay_now_fee_to,
            since: r.pay_now_at ?? r.pay_now_until,
            until: r.pay_now_until,
          }
        : null,
    refundLegs: { shop: r.refund_shop_tx ?? null, clear: r.refund_clear_tx ?? null },
  });

const COLUMNS = `code, merchant_address, merchant_name, member_wallet, amount_cents, payout_cents,
                 status, split_into, plan_id, tx_hash, chain_id, expires_at, created_at,
                 resolved_at, opened_at, raised_by, paid_now, pay_now_payout_cents,
                 pay_now_fee_cents, pay_now_fee_to, pay_now_at, pay_now_until, refund_shop_tx,
                 refund_clear_tx`;

export const chargeStore = {
  isConfigured(): boolean {
    return !!getPostgresPool();
  },

  async create(input: {
    merchantAddress: string;
    merchantName: string;
    /** Null on the show-the-code path: the customer attaches when they open it. */
    memberWallet?: string | null;
    amountCents: number;
    payoutCents: number;
    chainId: number;
    ttlSeconds: number;
    raisedBy?: string | null;
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
            chain_id, expires_at, raised_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval, $9)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          code,
          normalizeWallet(input.merchantAddress),
          input.merchantName,
          input.memberWallet ? normalizeWallet(input.memberWallet) : null,
          input.amountCents,
          input.payoutCents,
          input.chainId,
          String(input.ttlSeconds),
          input.raisedBy ?? null,
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
  /**
   * The customer opens the code and becomes the customer.
   *
   * On the show-the-code path a charge is raised with no member, so whoever opens it first claims
   * it. `WHERE member_wallet IS NULL` makes that a race nobody can lose twice: two people scanning
   * the same screen means the second gets the row already taken and is told so, rather than
   * silently overwriting the first.
   *
   * Only while pending. A resolved charge is history and cannot change hands.
   */
  async attachMember(code: string, wallet: string): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const { rows } = await pool.query<DbRow>(
      `UPDATE ${TABLE}
          SET member_wallet = $2, opened_at = COALESCE(opened_at, now())
        WHERE code = $1 AND member_wallet IS NULL AND status = 'pending' AND expires_at > now()
        RETURNING ${COLUMNS}`,
      [code, normalizeWallet(wallet)],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

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
        WHERE code = $1 AND status = 'resolving' AND pay_now_until IS NULL
        RETURNING ${COLUMNS}`,
      [
        code.trim().toUpperCase(),
        input.status,
        input.splitInto ?? null,
        input.planId ?? null,
        input.txHash ?? null,
      ],
    );
    const row = r.rows[0] ? toRow(r.rows[0]) : null;
    resolved(row);
    return row;
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
        WHERE status = 'resolving' AND pay_now_until IS NULL
          AND created_at < now() - ($1 || ' seconds')::interval
        ORDER BY created_at ASC
        LIMIT $2`,
      [String(olderThanSeconds), limit],
    );
    return r.rows.map(toRow);
  },

  /**
   * The merchant behind each plan.
   *
   * A plan on chain knows the merchant's address and not its name, and an address is not what a
   * member recognises on their own shelf — "Mike's Tire" is. The name lives here because this is
   * where a human typed it, so the shelf reads it back out of the charge that opened the plan.
   */
  async merchantNamesByPlanId(planIds: number[]): Promise<Record<number, string>> {
    const pool = getPostgresPool();
    if (!pool || planIds.length === 0) return {};
    await ensureTables();
    const r = await pool.query<{ plan_id: string; merchant_name: string; created_at: string }>(
      `SELECT plan_id, merchant_name, created_at FROM ${TABLE}
        WHERE plan_id = ANY($1::bigint[]) AND status = 'approved'`,
      [planIds],
    );
    const out: Record<number, string> = {};
    for (const row of r.rows) out[Number(row.plan_id)] = row.merchant_name;
    return out;
  },

  /**
   * The charges a shop has raised — the merchant app's Charges list.
   *
   * `charge_merchant_idx` already exists on (merchant_address, created_at DESC), so this is the
   * read the schema was built for. Waiting rows are NOT sorted first here: the API returns time
   * order and the client decides, because "what needs an action" is a presentation question and a
   * paged API that reorders by state cannot page consistently.
   */
  async listByMerchant(
    merchant: string,
    opts: { since?: Date; limit?: number } = {},
  ): Promise<ChargeRow[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query<DbRow>(
      `SELECT ${COLUMNS} FROM ${TABLE}
        WHERE merchant_address = $1
          AND ($2::timestamptz IS NULL OR created_at >= $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [normalizeWallet(merchant), opts.since?.toISOString() ?? null, opts.limit ?? 200],
    );
    return r.rows.map(toRow);
  },

  /**
   * The shop withdraws a charge before the member has acted.
   *
   * Guarded on `status = 'pending'` in the UPDATE rather than checked first: a member pressing
   * Approve at the same moment claims the row into `resolving`, and whichever statement lands
   * first wins. Checking and then writing would let both succeed — the member opens a plan the
   * shop believes it cancelled.
   */
  async cancel(code: string, merchant: string): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      `UPDATE ${TABLE} SET status = 'cancelled', resolved_at = now()
        WHERE code = $1 AND merchant_address = $2 AND status = 'pending'
        RETURNING ${COLUMNS}`,
      [code.trim().toUpperCase(), normalizeWallet(merchant)],
    );
    const row = r.rows[0] ? toRow(r.rows[0]) : null;
    resolved(row);
    return row;
  },

  /** Attribute a charge to the writer who raised it. */
  async setRaisedBy(code: string, staffId: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET raised_by = $2 WHERE code = $1`, [
      code.trim().toUpperCase(),
      staffId,
    ]);
  },

  /**
   * A dispute was raised on an approved charge. `disputed` drops it out of every payout query --
   * they all ask for `approved` -- so the merchant is not paid for a purchase in dispute.
   */
  async markDisputed(code: string): Promise<boolean> {
    const pool = getPostgresPool();
    if (!pool) return false;
    await ensureTables();
    const r = await pool.query(`UPDATE ${TABLE} SET status = 'disputed' WHERE code = $1 AND status = 'approved'`, [
      code.trim().toUpperCase(),
    ]);
    return (r.rowCount ?? 0) > 0;
  },

  /** The dispute went against the member, or they withdrew it: the purchase stands, on a new plan. */
  async restoreAfterDispute(code: string, planId: number | null, txHash: string | null): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET status = 'approved', plan_id = COALESCE($2, plan_id), tx_hash = COALESCE($3, tx_hash)
        WHERE code = $1 AND status = 'disputed'`,
      [code.trim().toUpperCase(), planId, txHash],
    );
  },

  /** The member won the dispute: the purchase is given back, as a refund would. */
  async refundAfterDispute(code: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET status = 'refunded' WHERE code = $1 AND status = 'disputed'`, [
      code.trim().toUpperCase(),
    ]);
  },

  /**
   * One leg of a paid-now refund. `expect` is what it must still say, so two settlements racing
   * cannot both start the same transfer: only one of them moves it off null.
   */
  async setRefundLeg(code: string, leg: 'shop' | 'clear', value: string | null, expect: string | null): Promise<boolean> {
    const pool = getPostgresPool();
    if (!pool) return false;
    await ensureTables();
    const column = leg === 'shop' ? 'refund_shop_tx' : 'refund_clear_tx';
    const r = await pool.query(
      `UPDATE ${TABLE} SET ${column} = $2
        WHERE code = $1 AND paid_now AND status = 'approved' AND ${column} IS NOT DISTINCT FROM $3`,
      [code.trim().toUpperCase(), value, expect],
    );
    return (r.rowCount ?? 0) > 0;
  },

  /** Mark a charge refunded once the refund settles. */
  async markRefunded(code: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET status = 'refunded' WHERE code = $1 AND status = 'approved'`,
      [code.trim().toUpperCase()],
    );
  },

  /** Put a claimed row back when the chain call failed — it never became anything. */
  async release(code: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET status = 'pending' WHERE code = $1 AND status = 'resolving' AND pay_now_until IS NULL`,
      [code.trim().toUpperCase()],
    );
  },

  /**
   * Hold a pending charge while its member pays it from their cash.
   *
   * The same claim as `claimForResolution` (pending, unexpired, in the WHERE clause), so a member
   * cannot pay now and approve a plan for one charge, and the shop cannot cancel it mid-payment.
   * The hold lapses at `until` if the member never pays; nothing moved, so it goes back to pending.
   */
  async holdForPayNow(
    code: string,
    member: string,
    quote: { payoutCents: number; feeCents: number; feeTo: string; holdSeconds: number },
  ): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      `UPDATE ${TABLE}
          SET status = 'resolving', tx_hash = NULL, pay_now_payout_cents = $3, pay_now_fee_cents = $4,
              pay_now_fee_to = $5, pay_now_at = now(), pay_now_until = now() + ($6 || ' seconds')::interval
        WHERE code = $1 AND member_wallet = $2 AND status = 'pending' AND expires_at > now()
        RETURNING ${COLUMNS}`,
      [
        code.trim().toUpperCase(),
        normalizeWallet(member),
        quote.payoutCents,
        quote.feeCents,
        normalizeWallet(quote.feeTo),
        String(quote.holdSeconds),
      ],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  },

  /**
   * The member's transfers are on chain and checked: the charge is paid.
   *
   * The payout becomes the paid-now one, because that is what the shop was actually sent. No plan
   * and no split: nothing is owed.
   */
  async finishPaidNow(code: string, txHash: string): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      // The fee columns stay: they are what the shop paid Clear on this charge.
      `UPDATE ${TABLE}
          SET status = 'approved', paid_now = true, payout_cents = pay_now_payout_cents,
              split_into = NULL, plan_id = NULL, tx_hash = $2, resolved_at = now(), pay_now_until = NULL
        WHERE code = $1 AND status = 'resolving' AND pay_now_until IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${TABLE} o WHERE o.tx_hash = $2 AND o.code <> $1)
        RETURNING ${COLUMNS}`,
      [code.trim().toUpperCase(), txHash.toLowerCase()],
    );
    const row = r.rows[0] ? toRow(r.rows[0]) : null;
    resolved(row);
    return row;
  },

  /**
   * Give up a pay-now hold: the member went back, or it lapsed with nothing paid.
   *
   * Never once a transaction has been reported (`tx_hash`): money may have left, and the pay-now
   * reconciliation decides that one from the chain.
   */
  async releasePayNow(code: string, opts: { onlyIfLapsed?: boolean } = {}): Promise<ChargeRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query<DbRow>(
      `UPDATE ${TABLE}
          SET status = 'pending', tx_hash = NULL, pay_now_payout_cents = NULL, pay_now_fee_cents = NULL,
              pay_now_fee_to = NULL, pay_now_at = NULL, pay_now_until = NULL
        WHERE code = $1 AND status = 'resolving' AND pay_now_until IS NOT NULL
          AND tx_hash IS NULL
          AND ($2::boolean IS NOT TRUE OR pay_now_until < now())
        RETURNING ${COLUMNS}`,
      [code.trim().toUpperCase(), opts.onlyIfLapsed ?? false],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  },

  /**
   * A reported transaction that is not this charge's payment (it failed, paid something else, or
   * the node has never heard of it). Forgotten, and the hold carries on as if it was never reported:
   * the member can go back, or it lapses and the chain is searched first.
   */
  async forgetPayNowTx(code: string, txHash: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `UPDATE ${TABLE} SET tx_hash = NULL
        WHERE code = $1 AND tx_hash = $2 AND status = 'resolving' AND pay_now_until IS NOT NULL`,
      [code.trim().toUpperCase(), txHash],
    );
  },

  /**
   * Pay-now holds to look at: lapsed, or with a transaction reported and not yet confirmed (the
   * member's app closed between paying and hearing back). Racing the confirm route is harmless:
   * `finishPaidNow` only closes a row still held.
   */
  async listPayNowStuck(limit = 50): Promise<ChargeRow[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query<DbRow>(
      `SELECT ${COLUMNS} FROM ${TABLE}
        WHERE status = 'resolving' AND pay_now_until IS NOT NULL
          AND (pay_now_until < now() OR tx_hash IS NOT NULL)
        ORDER BY pay_now_until ASC
        LIMIT $1`,
      [limit],
    );
    return r.rows.map(toRow);
  },
};
