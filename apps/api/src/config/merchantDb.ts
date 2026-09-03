import { Pool } from 'pg';
import { getPostgresPool } from './postgres.js';

/**
 * Where merchant-operator data lives.
 *
 * **A dedicated `merchant` schema, not a dedicated database — deliberately.**
 *
 * The obvious instinct is to give the merchant app its own database so its data is not mixed in
 * with the consumer app's. For staff, PINs and sessions that instinct is right, and this schema is
 * how it is honoured: separately namespaced, separately grantable, and nothing member-facing
 * touches it.
 *
 * But charges, refunds and payouts must NOT move. Three reasons, in increasing order of weight:
 *
 * 1. A charge is inherently shared. One row carries `merchant_address` and `member_wallet`, and
 *    the table already indexes both directions — it is the same state machine both apps read.
 * 2. A refund closes a member's plan and claws back a merchant payout. That is one transaction,
 *    and there is no such thing as one transaction across two databases.
 * 3. The charges list says "raised by Jen". That is a foreign key from a charge to a staff row.
 *    Put staff in another database and it becomes a dangling id with nothing enforcing it.
 *
 * The isolation argument for a separate database is also weaker than it looks: both connection
 * strings would live in this same process, so compromising it yields both. What a separate schema
 * gives up is little; what it keeps is referential integrity.
 *
 * If a genuine split is wanted later — a separate merchant service, say — `MERCHANT_DATABASE_URL`
 * is the seam. Set it and this pool points elsewhere; leave it unset and it shares the main one.
 * Everything below already goes through this accessor, so that is a config change rather than a
 * rewrite. The cross-schema foreign keys are what would have to be re-thought, and this comment is
 * the warning that they exist.
 */

export const MERCHANT_SCHEMA = 'merchant';

let separatePool: Pool | null = null;
let schemaReady = false;

/**
 * The pool merchant tables use.
 *
 * Shares the main pool unless `MERCHANT_DATABASE_URL` is set. Sharing matters: the main pool is
 * capped at five connections for a documented reason — an idle connection is not free on either
 * side — and a second pool against the same Railway instance would double that for no gain.
 */
export function getMerchantPool(): Pool | null {
  const separateUrl = (process.env.MERCHANT_DATABASE_URL || '').trim();
  if (!separateUrl) return getPostgresPool();

  if (!separatePool) {
    separatePool = new Pool({
      connectionString: separateUrl,
      ssl:
        process.env.NODE_ENV === 'production' || separateUrl.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : undefined,
      max: parseInt(process.env.MERCHANT_POOL_MAX || '5', 10),
      idleTimeoutMillis: 30_000,
    });
  }
  return separatePool;
}

/** True when a merchant database is configured at all. Routes answer 503 rather than throwing. */
export function merchantDbConfigured(): boolean {
  return getMerchantPool() !== null;
}

/**
 * Create the schema and its tables, once per process.
 *
 * Same lazy `CREATE ... IF NOT EXISTS` pattern the other stores use — this codebase has no
 * migration runner, and introducing one alongside a live database is a separate decision from
 * shipping the merchant app.
 */
export async function ensureMerchantSchema(): Promise<void> {
  const pool = getMerchantPool();
  if (!pool || schemaReady) return;

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${MERCHANT_SCHEMA}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.staff (
      id            TEXT PRIMARY KEY,
      merchant      TEXT NOT NULL,
      name          TEXT NOT NULL,
      -- 'counter' or 'owner'. Two roles, not a permission matrix; a CHECK rather than an enum
      -- because adding "manager" later should not need a type migration.
      role          TEXT NOT NULL CHECK (role IN ('counter','owner')),
      -- scrypt, as "scrypt$N$r$p$salt$hash". Never the PIN or password itself.
      secret        TEXT NOT NULL,
      email         TEXT,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS staff_merchant_idx ON ${MERCHANT_SCHEMA}.staff (merchant, active);
    -- A PIN is only four digits, so it is unique per shop rather than globally: two shops may both
    -- have a 4821 and neither is wrong. Sign-in is always scoped to one merchant.
    CREATE UNIQUE INDEX IF NOT EXISTS staff_merchant_email_idx
      ON ${MERCHANT_SCHEMA}.staff (merchant, lower(email)) WHERE email IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.sessions (
      -- The token itself is never stored; this is its SHA-256. A leaked table is not a set of
      -- working sessions.
      token_hash    TEXT PRIMARY KEY,
      staff_id      TEXT NOT NULL REFERENCES ${MERCHANT_SCHEMA}.staff(id) ON DELETE CASCADE,
      merchant      TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at    TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_staff_idx ON ${MERCHANT_SCHEMA}.sessions (staff_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON ${MERCHANT_SCHEMA}.sessions (expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.profiles (
      merchant          TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      category          TEXT,
      town              TEXT,
      payout_account    TEXT,
      -- Terms the co-op set. The rate and cap are ALSO on-chain in MerchantRegistry, which is the
      -- authority; these are a display copy so Settings can render without an RPC call on load.
      payout_terms      TEXT NOT NULL DEFAULT 'Net-30',
      partner_since     DATE,
      founding          BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.refunds (
      id              TEXT PRIMARY KEY,
      -- The charge this unwinds. Not a foreign key: the charges table lives in the public schema
      -- and may one day live in another database entirely (see the note at the top of this file).
      charge_code     TEXT NOT NULL,
      merchant        TEXT NOT NULL,
      amount_cents    BIGINT NOT NULL,
      -- What the member gets back, and the carry the co-op keeps. Stored rather than recomputed:
      -- a refund settled last month must still show the figures it settled at.
      member_cents    BIGINT NOT NULL,
      carry_kept_cents BIGINT NOT NULL,
      clawback_cents  BIGINT NOT NULL,
      state           TEXT NOT NULL CHECK (state IN ('requested','approved','declined','settled')),
      -- Both names are kept: an owner reviewing the month needs who asked as well as who approved.
      requested_by    TEXT NOT NULL REFERENCES ${MERCHANT_SCHEMA}.staff(id),
      requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_by      TEXT REFERENCES ${MERCHANT_SCHEMA}.staff(id),
      decided_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS refunds_charge_idx ON ${MERCHANT_SCHEMA}.refunds (charge_code);
    CREATE INDEX IF NOT EXISTS refunds_merchant_idx ON ${MERCHANT_SCHEMA}.refunds (merchant, requested_at DESC);
    -- One live request per charge. Without this, two writers on two devices can each raise a
    -- refund for the same charge and an owner approves both.
    CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_open_per_charge
      ON ${MERCHANT_SCHEMA}.refunds (charge_code) WHERE state IN ('requested','approved');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.payouts (
      id              TEXT PRIMARY KEY,
      merchant        TEXT NOT NULL,
      amount_cents    BIGINT NOT NULL,
      charge_count    INTEGER NOT NULL DEFAULT 0,
      scheduled_for   DATE NOT NULL,
      paid_at         TIMESTAMPTZ,
      status          TEXT NOT NULL CHECK (status IN ('scheduled','available','paid')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payouts_merchant_idx ON ${MERCHANT_SCHEMA}.payouts (merchant, scheduled_for DESC);
  `);

  schemaReady = true;
}
