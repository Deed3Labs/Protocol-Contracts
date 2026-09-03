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
      role          TEXT NOT NULL CHECK (role IN ('counter','manager','owner')),
      -- scrypt, as "scrypt$N$r$p$salt$hash". Never the PIN itself.
      --
      -- A PIN is ATTRIBUTION, not authentication: four digits on a counter tablet will be watched
      -- and shared, and the real boundary is the enrolled device. It is still hashed, because a
      -- readable PIN column is a readable PIN column — but nothing here is load-bearing security.
      secret        TEXT NOT NULL,
      email         TEXT,
      -- Owners sign in through Privy, so an owner row carries their Privy user id rather than a
      -- password. Clear stores no owner credential at all.
      privy_user_id TEXT,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS staff_merchant_idx ON ${MERCHANT_SCHEMA}.staff (merchant, active);
    -- A PIN is only four digits, so it is unique per shop rather than globally: two shops may both
    -- have a 4821 and neither is wrong. Sign-in is always scoped to one merchant.
    CREATE UNIQUE INDEX IF NOT EXISTS staff_merchant_email_idx
      ON ${MERCHANT_SCHEMA}.staff (merchant, lower(email)) WHERE email IS NOT NULL;
    -- Widen the role check for existing databases: a CHECK created before 'manager' existed will
    -- reject every manager insert, and the table is created only once.
    ALTER TABLE ${MERCHANT_SCHEMA}.staff DROP CONSTRAINT IF EXISTS staff_role_check;
    ALTER TABLE ${MERCHANT_SCHEMA}.staff
      ADD CONSTRAINT staff_role_check CHECK (role IN ('counter','manager','owner'));

    CREATE UNIQUE INDEX IF NOT EXISTS staff_privy_idx
      ON ${MERCHANT_SCHEMA}.staff (privy_user_id) WHERE privy_user_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.devices (
      id              TEXT PRIMARY KEY,
      merchant        TEXT NOT NULL,
      -- "Counter tablet". Named so an owner recognises it in a list months later.
      label           TEXT NOT NULL,
      -- SHA-256 of the device's SESSION token against Clear. Not a key, and not signing material
      -- of any kind: a stolen tablet carries nothing that can sign. Clear's backend holds one
      -- P-256 authorization key per merchant org and does the signing; the device only asks.
      -- Revoking a device is therefore a row update here — instant, and effective immediately.
      token_hash      TEXT NOT NULL UNIQUE,
      -- No per-device cap. The approval cap is the merchant's, enforced in MerchantRegistry and
      -- backstopped by the wallet policy, which is why the enrollment screen shows it as "Fixed"
      -- and says "enforced by policy, not by this app".
      idle_lock_seconds  INTEGER NOT NULL DEFAULT 300,
      -- The staff row of the owner who enrolled it. A device is authority the owner delegated, so
      -- the record keeps who delegated it — and the staff row, not the Privy id, because that is
      -- what every other attribution in this schema points at and what renders as a name.
      enrolled_by     TEXT NOT NULL,
      enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Removable any time, from any device. This is what makes a lost tablet survivable.
      revoked_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS devices_merchant_idx ON ${MERCHANT_SCHEMA}.devices (merchant, revoked_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MERCHANT_SCHEMA}.sessions (
      -- The token itself is never stored; this is its SHA-256. A leaked table is not a set of
      -- working sessions.
      token_hash    TEXT PRIMARY KEY,
      -- Who is on the counter. Attribution: it is why a charge row can say "raised by Jen".
      staff_id      TEXT NOT NULL REFERENCES ${MERCHANT_SCHEMA}.staff(id) ON DELETE CASCADE,
      -- The device the shift is running on. THIS is the security boundary: a shift is only ever
      -- as authorised as the device carrying it, and revoking the device ends every shift on it.
      device_id     TEXT REFERENCES ${MERCHANT_SCHEMA}.devices(id) ON DELETE CASCADE,
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
      -- The Privy organization this shop is, and the smart wallet that organization owns.
      -- The merchant address the registry knows IS this wallet's address: a charge raised at the
      -- counter is the shop acting, not the writer acting.
      privy_org_id      TEXT,
      privy_wallet_id   TEXT,
      key_quorum_id     TEXT,
      -- Clear's own signer on this shop's wallet: a key quorum wrapping one P-256 authorization
      -- key, plus the coarse policy ceiling attached to it. Provisioned at onboarding step six,
      -- once the owner has been shown what it can do.
      clear_signer_quorum_id TEXT,
      clear_policy_id        TEXT,
      -- How much a counter writer can clear with the owner's code, set by the OWNER and not by
      -- Clear. It is their money and their staffing: a shop with one trusted manager wants it
      -- high, a shop with weekend cover wants it at zero. NULL means never set; 0 means "Off",
      -- which is a first-class choice rather than a degenerate number — every refund waits for
      -- the owner's phone.
      --
      -- Its ceiling is the shop's approval cap, so one number governs both directions: an owner
      -- cannot authorise more by code than the shop can charge in one transaction.
      owner_code_limit_cents BIGINT,
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
      decided_at      TIMESTAMPTZ,
      -- HOW it was approved, not just by whom. "Owner code at the counter" proves someone knew
      -- four digits; "approved from Mike's phone" proves possession of the owner's device. Both
      -- are acceptable and they are not equal evidence, so the record keeps which.
      decided_via     TEXT CHECK (decided_via IN ('owner_code','owner_device'))
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
      -- 'requested' is an early withdrawal a merchant asked for and Clear has not settled yet.
      -- It is a real state, not a synonym for paid: the money has not moved, and the screen that
      -- reports it must not say it has.
      status          TEXT NOT NULL CHECK (status IN ('scheduled','available','requested','paid')),
      -- Who asked, and when. An early withdrawal is a decision somebody made; a payout that simply
      -- came due is not, and the difference matters when reconciling.
      requested_by    TEXT,
      requested_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE ${MERCHANT_SCHEMA}.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
    ALTER TABLE ${MERCHANT_SCHEMA}.payouts
      ADD CONSTRAINT payouts_status_check
      CHECK (status IN ('scheduled','available','requested','paid'));
    ALTER TABLE ${MERCHANT_SCHEMA}.payouts ADD COLUMN IF NOT EXISTS requested_by TEXT;
    ALTER TABLE ${MERCHANT_SCHEMA}.payouts ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS payouts_merchant_idx ON ${MERCHANT_SCHEMA}.payouts (merchant, scheduled_for DESC);
  `);

  schemaReady = true;
}
