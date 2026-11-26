import crypto from 'crypto';
import { getPayPool } from '../config/postgres.js';
import { encryptSendContact, decryptSendContact } from '../utils/sendEncryption.js';
import { notificationStore } from './notificationStore.js';
import { memberStore } from './memberStore.js';

/*
 * Clear Pay rent/bill → equity-credit ledger (off-chain, Railway Postgres). Append-only credit rows
 * keyed by payment (idempotent), with a 30-day vesting window before they're mintable. Designed so a
 * future minter reads `vested & un-minted` rows, mints matching StableCredit on-chain, and stamps
 * them `minted` + `mint_tx` — at which point the chain becomes the source of truth and this DB stays
 * as the fast read-layer + backup. Keyed by wallet (lowercased), matching the other wallet-scoped
 * services. See [[clear-product-model]] for the credit semantics.
 */

export type BillerType = 'rent' | 'utility' | 'subscription' | 'card' | 'phone' | 'other';
export type CreditStatus = 'pending' | 'vested' | 'minted' | 'void';
/**
 * Where a payment was made. Only `clear_rails` earns: a bill paid through Clear Pay, the Clear Visa
 * card or the Clear card. A payment the member marks paid (`manual`) or that a linked bank shows
 * (`detected`) is recorded for the bill list and the streak, and earns nothing. `in_app` is the old
 * name some stored rows still carry; nothing records it any more.
 */
export type EarnSource = 'clear_rails' | 'manual' | 'detected' | 'in_app';

const GRACE_DAYS = 3; // paid within N days of due_date still counts as on-time
const VEST_DAYS = 30; // pending → vested clawback/settlement window
const BILL_CREDIT_RATE = 0.02; // rent and other bills earn 2% of the payment as BASE credits
const BILL_CREDIT_CAP = 50; // max BASE credits from one bill (before the multiplier)
const MAX_MULTIPLIER = 1.5; // top on-time streaks
const DEPOSIT_MATCH_PER_USD = 1; // saving credits per whole $1 put into savings
const DEPOSIT_MATCH_MONTHLY_CAP = 1500; // max saving credits per calendar month
const SAVING_LIFETIME_CAP = 54_000; // max saving credits ever, per network
const MATCH_PERIOD_MONTHS = 36; // saving credits are earned only in the member's first 36 months

/**
 * Whether `at` falls inside the member's Match Period: their first 36 months of membership. The
 * period also ends at their first ELPA, which closes it on chain (the Points Issuer then refuses
 * saving mints); this side only knows the join date. A wallet with no member record is not held back
 * here: the Points Issuer refuses a saving mint outside an opened period anyway.
 */
export function inMatchPeriod(joinedAt: Date | null, at: Date = new Date()): boolean {
  if (!joinedAt) return true;
  const end = new Date(joinedAt);
  end.setUTCMonth(end.getUTCMonth() + MATCH_PERIOD_MONTHS);
  return at < end;
}

export type CreditNetwork = 'mainnet' | 'testnet';
const MAINNET_CHAIN_IDS = new Set([1, 8453, 10, 42161, 137, 100]);
/** Map a chain id to the credit environment — mainnet credits count, testnet (demo) are separate. */
export function networkFromChainId(chainId: number): CreditNetwork {
  return MAINNET_CHAIN_IDS.has(chainId) ? 'mainnet' : 'testnet';
}

let ensured = false;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Deposit-credit rows that still stand (pending, vested or minted) for a wallet on a network. */
async function depositCreditsEarned(pool: NonNullable<ReturnType<typeof getPayPool>>, wallet: string, network: CreditNetwork): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS s FROM pay_credits
      WHERE wallet = $1 AND reason = 'deposit_match' AND status <> 'void' AND network = $2`,
    [wallet, network],
  );
  return num(r.rows[0]?.s);
}

/**
 * Records a deposit or redemption in whole dollars. A wallet's first recorded flow is preceded by a
 * `seed` equal to the deposit credits it already holds, so savings from before this ledger count as
 * still in. Idempotent per transaction: returns false when this transaction was already recorded.
 */
async function recordFlow(
  pool: NonNullable<ReturnType<typeof getPayPool>>,
  input: { wallet: string; network: CreditNetwork; kind: 'deposit' | 'redeem'; usd: number; txRef?: string },
): Promise<boolean> {
  const any = await pool.query(`SELECT 1 FROM pay_esa_flows WHERE wallet = $1 AND network = $2 LIMIT 1`, [input.wallet, input.network]);
  if (any.rows.length === 0) {
    const earned = await depositCreditsEarned(pool, input.wallet, input.network);
    await pool.query(
      `INSERT INTO pay_esa_flows (id, wallet, network, kind, usd, tx_ref) VALUES ($1,$2,$3,'seed',$4,NULL)`,
      [crypto.randomUUID(), input.wallet, input.network, earned / DEPOSIT_MATCH_PER_USD],
    );
  }
  const ins = await pool.query(
    `INSERT INTO pay_esa_flows (id, wallet, network, kind, usd, tx_ref) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING RETURNING id`,
    [crypto.randomUUID(), input.wallet, input.network, input.kind, input.usd, input.txRef ?? null],
  );
  return (ins.rowCount ?? 0) > 0;
}

/** Whole dollars in savings by this ledger's count: seed and deposits, less redemptions, never below zero. */
async function netSavingsUsd(pool: NonNullable<ReturnType<typeof getPayPool>>, wallet: string, network: CreditNetwork): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'redeem' THEN -usd ELSE usd END),0) AS s
       FROM pay_esa_flows WHERE wallet = $1 AND network = $2`,
    [wallet, network],
  );
  return Math.max(0, num(r.rows[0]?.s));
}

/**
 * Reward multiplier on the base credits: 1×, plus 0.25× for every 6 on-time months in a row, up to
 * 1.5×. A membership plan never changes it.
 */
export function rewardMultiplier(streak: number): number {
  return Math.min(1 + Math.floor(Math.max(streak, 0) / 6) * 0.25, MAX_MULTIPLIER);
}

/**
 * Credits for an on-time rent or bill payment made on Clear Rails, rounded to the nearest credit:
 * 2% of the payment, at most 50 for one bill, times the streak multiplier.
 */
export function creditAmount(streak: number, paidAmount: number): number {
  const base = Math.min(Math.max(paidAmount, 0) * BILL_CREDIT_RATE, BILL_CREDIT_CAP);
  return Math.round(base * rewardMultiplier(streak));
}

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_billers (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      name TEXT NOT NULL,
      payee TEXT,
      type TEXT NOT NULL,
      default_amount NUMERIC,
      due_day INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      plaid_stream_id TEXT,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_billers_wallet_idx ON pay_billers (wallet);
    CREATE UNIQUE INDEX IF NOT EXISTS pay_billers_stream_uidx
      ON pay_billers (wallet, plaid_stream_id) WHERE plaid_stream_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pay_payments (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      biller_id TEXT,
      name TEXT,
      type TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      due_date DATE,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      on_time BOOLEAN NOT NULL DEFAULT true,
      source TEXT NOT NULL DEFAULT 'in_app',
      period TEXT NOT NULL,
      tx_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_payments_wallet_idx ON pay_payments (wallet);
    CREATE UNIQUE INDEX IF NOT EXISTS pay_payments_period_uidx
      ON pay_payments (wallet, biller_id, period) WHERE biller_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pay_credits (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      amount NUMERIC NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'in_app',
      streak_at_award INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      vest_until TIMESTAMPTZ NOT NULL,
      mint_tx TEXT,
      minted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_credits_wallet_idx ON pay_credits (wallet);
    CREATE INDEX IF NOT EXISTS pay_credits_status_idx ON pay_credits (status);
  `);
  // Biller payout destination (for ACH bill pay). Account number is encrypted at rest; routing +
  // bank name + last4 are kept clear for display/Bridge. bridge_external_account_id caches the
  // Bridge external account created from these details.
  await pool.query(`
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS payout_account_enc TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS payout_account_last4 TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS payout_routing TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS payout_bank_name TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS bridge_external_account_id TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS portal_url TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE pay_billers ADD COLUMN IF NOT EXISTS reminders BOOLEAN NOT NULL DEFAULT true;
  `);
  // Tag each credit with the environment it was earned in ('mainnet' = live/real, 'testnet' = demo).
  // The demo's deposit-match credits (Base Sepolia) stay separate from mainnet credits that count.
  await pool.query(`ALTER TABLE pay_credits ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'mainnet';`);
  // The minting job's bookkeeping: why the Points Issuer refused a row (it is then void), and how many
  // times a send failed for some other reason (retried next run).
  await pool.query(`
    ALTER TABLE pay_credits ADD COLUMN IF NOT EXISTS mint_error TEXT;
    ALTER TABLE pay_credits ADD COLUMN IF NOT EXISTS mint_attempts INTEGER NOT NULL DEFAULT 0;
  `);
  // Savings moved in and out, in whole dollars, so a dollar earns a deposit credit only once (ESA Terms
  // 6.2: Contributed Capital nets out redemptions). One row per deposit or redemption transaction.
  // `seed` stands in for what a wallet held before this table existed: the dollars its credits were
  // earned on, assumed still in savings.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_esa_flows (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      network TEXT NOT NULL,
      kind TEXT NOT NULL,
      usd NUMERIC NOT NULL,
      tx_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pay_esa_flows_tx_uidx ON pay_esa_flows (kind, tx_ref) WHERE tx_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS pay_esa_flows_wallet_idx ON pay_esa_flows (wallet, network);
  `);
  // Per-merchant metadata (portal link + address), keyed by a normalized merchant name so it's shared
  // across a merchant's transactions AND its matching biller. The bill/transaction detail view reads +
  // inline-edits this. One source of truth for merchant info.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_merchant_meta (
      wallet TEXT NOT NULL,
      name_key TEXT NOT NULL,
      portal_url TEXT,
      address TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet, name_key)
    );
  `);
  // A merchant's spend group, when the member has moved it out of the one Clear picked. Same table,
  // because it is the same fact: what this merchant is, kept once per member rather than per payment.
  await pool.query(`ALTER TABLE pay_merchant_meta ADD COLUMN IF NOT EXISTS spend_group TEXT;`);
  // Whether spending is grouped at all. A member preference, not a merchant one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_spend_prefs (
      wallet TEXT PRIMARY KEY,
      grouping BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  ensured = true;
}

/** Normalized key for merchant metadata (matches billPortals.matchPortal normalization). */
export function merchantKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9&]+/g, '');
}

export interface Biller {
  id: string;
  name: string;
  payee: string | null;
  type: BillerType;
  defaultAmount: number;
  dueDay: number | null;
  source: 'manual' | 'plaid';
  plaidStreamId: string | null;
  /** Whether this biller has ACH payout details on file (account number never exposed). */
  payable: boolean;
  payoutLast4: string | null;
  payoutBank: string | null;
  bridgeExternalAccountId: string | null;
  portalUrl: string | null;
  address: string | null;
  reminders: boolean;
}

/** Every credit on a network, by state, for Command. Whole credits. */
export interface CreditsTotals {
  minted: { saving: number; rent: number; bill: number };
  pending: number;
  vested: number;
  voided: number;
  byDay: { day: string; minted: number }[];
}

/** A vested credit row the minting job may send to the Points Issuer. */
export interface MintableCredit {
  id: string;
  wallet: string;
  amount: number; // whole credits
  reason: string; // deposit_match | rent_on_time | bill_on_time
  createdAt: Date;
}

export interface PaySummary {
  dueThisMonth: number;
  paid30: number;
  totalEquity: number; // pending + vested + minted
  vestedEquity: number; // vested + minted (settled)
  pendingEquity: number; // still vesting
  equityThisMonth: number;
  streak: number;
  /** Non-void credits split by how they were earned (powers the Clear Deed "how you earned it"). */
  sources: { match: number; rent: number; bills: number };
  series: { label: string; rent: number; equity: number }[]; // last 12 months: rent paid + cumulative equity
}

function rowToBiller(r: Record<string, unknown>): Biller {
  return {
    id: String(r.id),
    name: String(r.name),
    payee: r.payee ? String(r.payee) : null,
    type: String(r.type) as BillerType,
    defaultAmount: num(r.default_amount),
    dueDay: r.due_day == null ? null : Number(r.due_day),
    source: String(r.source) === 'plaid' ? 'plaid' : 'manual',
    plaidStreamId: r.plaid_stream_id ? String(r.plaid_stream_id) : null,
    payable: !!r.payout_account_enc,
    payoutLast4: r.payout_account_last4 ? String(r.payout_account_last4) : null,
    payoutBank: r.payout_bank_name ? String(r.payout_bank_name) : null,
    bridgeExternalAccountId: r.bridge_external_account_id ? String(r.bridge_external_account_id) : null,
    portalUrl: r.portal_url ? String(r.portal_url) : null,
    address: r.address ? String(r.address) : null,
    reminders: r.reminders !== false,
  };
}

/** Consecutive months (ending at the most recent) with an on-time payment of any kind (drives the reward
 *  multiplier ramp). */
async function computeStreak(wallet: string): Promise<number> {
  const pool = getPayPool();
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT DISTINCT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS m
       FROM pay_payments
      WHERE wallet = $1 AND on_time = true
      ORDER BY m DESC`,
    [wallet],
  );
  const months: string[] = r.rows.map((x) => String(x.m));
  if (months.length === 0) return 0;
  let streak = 0;
  const cursor = new Date(`${months[0]}-01T00:00:00Z`);
  for (const m of months) {
    const want = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m === want) {
      streak += 1;
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    } else break;
  }
  return streak;
}

export const payLedgerStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async listBillers(wallet: string): Promise<Biller[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query(
      `SELECT * FROM pay_billers WHERE wallet = $1 AND archived_at IS NULL ORDER BY type = 'rent' DESC, due_day NULLS LAST`,
      [wallet],
    );
    return r.rows.map(rowToBiller);
  },

  /** A biller's payment history (for the bill detail view). Newest first. */
  async listBillerPayments(
    wallet: string,
    billerId: string,
  ): Promise<Array<{ id: string; name: string | null; type: string; amount: number; paidAt: string; onTime: boolean; source: string; period: string }>> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query(
      `SELECT id, name, type, amount, paid_at, on_time, source, period
         FROM pay_payments WHERE wallet = $1 AND biller_id = $2 ORDER BY paid_at DESC LIMIT 60`,
      [wallet, billerId],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      name: x.name ? String(x.name) : null,
      type: String(x.type),
      amount: num(x.amount),
      paidAt: (x.paid_at instanceof Date ? x.paid_at : new Date(String(x.paid_at))).toISOString(),
      onTime: x.on_time !== false,
      source: String(x.source),
      period: String(x.period),
    }));
  },

  /**
   * Every merchant the member has moved, and whether they want grouping at all.
   *
   * Keyed by the normalized merchant name, so a rule set from one payment covers every payment by
   * that merchant — which is what makes a move retroactive.
   */
  async getSpendGroups(wallet: string): Promise<{ groups: Record<string, string>; grouping: boolean }> {
    const pool = getPayPool();
    if (!pool) return { groups: {}, grouping: true };
    await ensureTables();
    const [rules, prefs] = await Promise.all([
      pool.query(`SELECT name_key, spend_group FROM pay_merchant_meta WHERE wallet = $1 AND spend_group IS NOT NULL`, [wallet]),
      pool.query(`SELECT grouping FROM pay_spend_prefs WHERE wallet = $1`, [wallet]),
    ]);
    const groups: Record<string, string> = {};
    for (const row of rules.rows) groups[String(row.name_key)] = String(row.spend_group);
    return { groups, grouping: prefs.rows[0] ? prefs.rows[0].grouping !== false : true };
  },

  /** Move a merchant into a group, or clear the rule and let Clear group it again. */
  async setSpendGroup(wallet: string, name: string, group: string | null): Promise<void> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    await pool.query(
      `INSERT INTO pay_merchant_meta (wallet, name_key, spend_group, updated_at)
         VALUES ($1,$2,$3, now())
       ON CONFLICT (wallet, name_key) DO UPDATE SET spend_group = $3, updated_at = now()`,
      [wallet, merchantKey(name), group],
    );
  },

  /** Turn grouping on or off for this member. */
  async setSpendGrouping(wallet: string, grouping: boolean): Promise<void> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    await pool.query(
      `INSERT INTO pay_spend_prefs (wallet, grouping, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (wallet) DO UPDATE SET grouping = $2, updated_at = now()`,
      [wallet, grouping],
    );
  },

  /** Read a merchant's shared metadata (portal + address) by name. */
  async getMerchantMeta(wallet: string, name: string): Promise<{ portalUrl: string | null; address: string | null } | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query(`SELECT portal_url, address FROM pay_merchant_meta WHERE wallet = $1 AND name_key = $2`, [wallet, merchantKey(name)]);
    if (!r.rows[0]) return null;
    return { portalUrl: r.rows[0].portal_url ?? null, address: r.rows[0].address ?? null };
  },

  /** Set a merchant's shared metadata. Only the fields passed (not undefined) are changed. */
  async upsertMerchantMeta(
    wallet: string,
    name: string,
    p: { portalUrl?: string | null; address?: string | null },
  ): Promise<{ portalUrl: string | null; address: string | null }> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const key = merchantKey(name);
    const cur = (await this.getMerchantMeta(wallet, name)) ?? { portalUrl: null, address: null };
    const next = {
      portalUrl: p.portalUrl !== undefined ? p.portalUrl : cur.portalUrl,
      address: p.address !== undefined ? p.address : cur.address,
    };
    await pool.query(
      `INSERT INTO pay_merchant_meta (wallet, name_key, portal_url, address, updated_at)
         VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (wallet, name_key) DO UPDATE SET portal_url = $3, address = $4, updated_at = now()`,
      [wallet, key, next.portalUrl, next.address],
    );
    return next;
  },

  async addBiller(
    wallet: string,
    b: Pick<Biller, 'name' | 'payee' | 'type' | 'defaultAmount' | 'dueDay'> & { portalUrl?: string | null; address?: string | null },
  ): Promise<Biller> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const id = crypto.randomUUID();
    const r = await pool.query(
      `INSERT INTO pay_billers (id, wallet, name, payee, type, default_amount, due_day, source, portal_url, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9) RETURNING *`,
      [id, wallet, b.name, b.payee, b.type, b.defaultAmount, b.dueDay, b.portalUrl ?? null, b.address ?? null],
    );
    return rowToBiller(r.rows[0]);
  },

  /** Update a MANUALLY-added biller (Plaid-detected billers are read-only). Returns null if not found
   *  or not manual. */
  async updateBiller(
    wallet: string,
    id: string,
    b: { name: string; payee: string | null; type: BillerType; defaultAmount: number; dueDay: number | null; portalUrl?: string | null; address?: string | null },
  ): Promise<Biller | null> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const r = await pool.query(
      `UPDATE pay_billers SET name = $3, payee = $4, type = $5, default_amount = $6, due_day = $7,
         portal_url = $8, address = $9
        WHERE wallet = $1 AND id = $2 AND source = 'manual' AND archived_at IS NULL
        RETURNING *`,
      [wallet, id, b.name, b.payee, b.type, b.defaultAmount, b.dueDay, b.portalUrl ?? null, b.address ?? null],
    );
    return r.rows[0] ? rowToBiller(r.rows[0]) : null;
  },

  /** Toggle reminders for any biller (manual or detected). */
  async setBillerReminders(wallet: string, id: string, enabled: boolean): Promise<Biller | null> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const r = await pool.query(
      `UPDATE pay_billers SET reminders = $3 WHERE wallet = $1 AND id = $2 AND archived_at IS NULL RETURNING *`,
      [wallet, id, enabled],
    );
    return r.rows[0] ? rowToBiller(r.rows[0]) : null;
  },

  /** Set/replace a biller's ACH payout destination (account number encrypted at rest). Works for any
   *  biller (manual or detected — detected billers become payable once details are added). */
  async setBillerPayout(
    wallet: string,
    id: string,
    p: { accountNumber: string; routingNumber: string; bankName: string | null },
  ): Promise<Biller | null> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const enc = encryptSendContact(p.accountNumber, `${wallet}:${id}`);
    const last4 = p.accountNumber.replace(/\s/g, '').slice(-4);
    const r = await pool.query(
      `UPDATE pay_billers SET payout_account_enc = $3, payout_account_last4 = $4, payout_routing = $5,
         payout_bank_name = $6, bridge_external_account_id = NULL
        WHERE wallet = $1 AND id = $2 AND archived_at IS NULL RETURNING *`,
      [wallet, id, enc, last4, p.routingNumber, p.bankName],
    );
    return r.rows[0] ? rowToBiller(r.rows[0]) : null;
  },

  /** Decrypted payout destination for a biller — server-internal only (for creating the Bridge
   *  external account). Never return this over the API. */
  async getBillerPayoutSecret(
    wallet: string,
    id: string,
  ): Promise<{ accountNumber: string; routingNumber: string; bankName: string | null; bridgeExternalAccountId: string | null } | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query(
      `SELECT payout_account_enc, payout_routing, payout_bank_name, bridge_external_account_id
         FROM pay_billers WHERE wallet = $1 AND id = $2 AND archived_at IS NULL`,
      [wallet, id],
    );
    const row = r.rows[0];
    if (!row?.payout_account_enc) return null;
    return {
      accountNumber: decryptSendContact(String(row.payout_account_enc), `${wallet}:${id}`),
      routingNumber: String(row.payout_routing ?? ''),
      bankName: row.payout_bank_name ? String(row.payout_bank_name) : null,
      bridgeExternalAccountId: row.bridge_external_account_id ? String(row.bridge_external_account_id) : null,
    };
  },

  /** Cache the Bridge external account id created for a biller's payout destination. */
  async setBillerBridgeExternalAccount(wallet: string, id: string, externalAccountId: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE pay_billers SET bridge_external_account_id = $3 WHERE wallet = $1 AND id = $2`, [
      wallet,
      id,
      externalAccountId,
    ]);
  },

  async archiveBiller(wallet: string, id: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE pay_billers SET archived_at = now() WHERE wallet = $1 AND id = $2`, [wallet, id]);
  },

  /** Upsert Plaid-detected billers (recurring outflow streams) by stream id. */
  async upsertPlaidBillers(
    wallet: string,
    streams: { streamId: string; name: string; amount: number; dueDay: number; type: BillerType }[],
  ): Promise<void> {
    const pool = getPayPool();
    if (!pool || streams.length === 0) return;
    await ensureTables();
    for (const s of streams) {
      await pool.query(
        `INSERT INTO pay_billers (id, wallet, name, payee, type, default_amount, due_day, source, plaid_stream_id)
         VALUES ($1,$2,$3,$3,$4,$5,$6,'plaid',$7)
         ON CONFLICT (wallet, plaid_stream_id) WHERE plaid_stream_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, default_amount = EXCLUDED.default_amount, due_day = EXCLUDED.due_day, type = EXCLUDED.type`,
        [crypto.randomUUID(), wallet, s.name, s.type, s.amount, s.dueDay, s.streamId],
      );
    }
  },

  /**
   * Record a payment and, if it was made on Clear Rails and on time, award its credits. Idempotent per
   * (wallet, biller, period): a payment already recorded for that biller+period earns nothing further,
   * so the Clear Pay, manual and detected paths can't double-credit. Returns the credit amount awarded
   * (0 if none/duplicate).
   */
  async recordPayment(input: {
    wallet: string;
    billerId: string | null;
    name: string;
    type: BillerType;
    amount: number;
    dueDate: string | null; // ISO date
    period: string; // e.g. "2026-06" — billing period for idempotency
    source: EarnSource;
    txRef?: string | null;
    paidAt?: Date; // actual payment date (detected payments use the bank date); defaults to now
    network?: CreditNetwork; // environment the payment was made in; defaults to mainnet
  }): Promise<{ creditAwarded: number; onTime: boolean; duplicate: boolean }> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();

    const paidAt = input.paidAt ?? new Date();
    let onTime = true;
    if (input.dueDate) {
      const due = new Date(input.dueDate);
      due.setDate(due.getDate() + GRACE_DAYS);
      onTime = paidAt <= due;
    }

    const paymentId = crypto.randomUUID();
    const ins = await pool.query(
      `INSERT INTO pay_payments (id, wallet, biller_id, name, type, amount, due_date, paid_at, on_time, source, period, tx_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (wallet, biller_id, period) WHERE biller_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [paymentId, input.wallet, input.billerId, input.name, input.type, input.amount, input.dueDate, paidAt, onTime, input.source, input.period, input.txRef ?? null],
    );
    if (ins.rowCount === 0) {
      return { creditAwarded: 0, onTime, duplicate: true }; // already paid this period
    }

    if (!onTime || input.source !== 'clear_rails') return { creditAwarded: 0, onTime, duplicate: false };

    const streak = await computeStreak(input.wallet);
    const amount = creditAmount(streak, input.amount);
    const vestUntil = new Date(paidAt);
    vestUntil.setDate(vestUntil.getDate() + VEST_DAYS);
    await pool.query(
      `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, streak_at_award, status, vest_until, network)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) ON CONFLICT (payment_id) DO NOTHING`,
      [crypto.randomUUID(), input.wallet, paymentId, amount, input.type === 'rent' ? 'rent_on_time' : 'bill_on_time', input.source, streak, vestUntil, input.network ?? 'mainnet'],
    );
    if (amount > 0) {
      void notificationStore.emit({
        wallet: input.wallet,
        kind: 'credit',
        title: 'Credits earned',
        body: `+${amount} credits for on-time ${input.type === 'rent' ? 'rent' : input.name}`,
        data: { amount, reason: input.type, href: '/' },
        dedupeKey: `credit:${paymentId}`,
      }).catch(() => {});
    }
    return { creditAwarded: amount, onTime, duplicate: false };
  },

  /**
   * A payment that was reversed, returned or refunded earns nothing: its credits are voided while they
   * are still off chain (pending or vested). Credits already minted are left alone; taking those back is
   * the Points Issuer's two-reviewer reversal. Matched by the payment's provider reference. Returns the
   * credits voided.
   */
  async voidPaymentCredits(input: { wallet: string; txRef: string }): Promise<number> {
    const pool = getPayPool();
    if (!pool || !input.txRef) return 0;
    await ensureTables();
    const r = await pool.query(
      `UPDATE pay_credits c SET status = 'void'
         FROM pay_payments p
        WHERE c.payment_id = p.id AND p.wallet = $1 AND p.tx_ref = $2 AND c.status IN ('pending','vested')
        RETURNING c.amount`,
      [input.wallet, input.txRef],
    );
    return r.rows.reduce((t, row) => t + num(row.amount), 0);
  },

  /**
   * Award saving credits for a savings deposit (USDC → ESA vault): 1 credit per $1, capped at
   * DEPOSIT_MATCH_MONTHLY_CAP credits per calendar month and SAVING_LIFETIME_CAP in all, and only inside
   * the member's Match Period. Pending for 30 days and clawed back (voided)
   * if the user redeems within that window — so only deposits that stay in ≥30 days vest. Idempotent
   * per deposit txRef.
   *
   * A dollar earns a credit only once (ESA Terms 6.2). Only dollars in savings that have not already
   * earned a credit can earn one: the net savings after this deposit, less the deposit credits that
   * still stand. A dollar withdrawn after it earned its credit and added back earns nothing new.
   */
  async recordDepositMatch(input: {
    wallet: string;
    amountMicros: string | bigint; // USDC (6-decimals) deposited
    txRef: string; // deposit tx hash
    network: CreditNetwork; // from the deposit chain (mainnet vs testnet)
  }): Promise<{ creditAwarded: number; duplicate: boolean }> {
    const pool = getPayPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();

    const dollars = Math.floor(Number(BigInt(input.amountMicros)) / 1_000_000);
    const usd = dollars * DEPOSIT_MATCH_PER_USD;
    if (usd <= 0) return { creditAwarded: 0, duplicate: false };

    const fresh = await recordFlow(pool, { wallet: input.wallet, network: input.network, kind: 'deposit', usd: dollars, txRef: input.txRef });
    if (!fresh) {
      const seen = await pool.query(`SELECT 1 FROM pay_credits WHERE payment_id = $1`, [`deposit:${input.txRef}`]);
      return { creditAwarded: 0, duplicate: seen.rows.length > 0 };
    }
    // Credits, so the dollars not yet credited are scaled by the match rate.
    const uncredited = Math.max(0, (await netSavingsUsd(pool, input.wallet, input.network)) * DEPOSIT_MATCH_PER_USD - (await depositCreditsEarned(pool, input.wallet, input.network)));

    // Month-to-date deposit-match credits already awarded for THIS network (excludes voided).
    const mtd = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM pay_credits
        WHERE wallet = $1 AND reason = 'deposit_match' AND status <> 'void' AND network = $2
          AND created_at >= date_trunc('month', now())`,
      [input.wallet, input.network],
    );
    const remaining = Math.max(0, DEPOSIT_MATCH_MONTHLY_CAP - num(mtd.rows[0]?.s));
    const lifetimeLeft = Math.max(0, SAVING_LIFETIME_CAP - (await depositCreditsEarned(pool, input.wallet, input.network)));
    const joinedAt = await memberStore.getJoinedAtByWallet(input.wallet).catch(() => null);
    if (!inMatchPeriod(joinedAt)) return { creditAwarded: 0, duplicate: false };
    const award = Math.min(usd, remaining, uncredited, lifetimeLeft);
    if (award <= 0) return { creditAwarded: 0, duplicate: false };

    const vestUntil = new Date();
    vestUntil.setDate(vestUntil.getDate() + VEST_DAYS);
    const ins = await pool.query(
      `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, streak_at_award, status, vest_until, network)
       VALUES ($1,$2,$3,$4,'deposit_match','in_app',0,'pending',$5,$6) ON CONFLICT (payment_id) DO NOTHING RETURNING id`,
      [crypto.randomUUID(), input.wallet, `deposit:${input.txRef}`, award, vestUntil, input.network],
    );
    if (ins.rowCount === 0) return { creditAwarded: 0, duplicate: true };
    void notificationStore.emit({
      wallet: input.wallet,
      kind: 'credit',
      title: 'Credits earned',
      body: `+${award} credits for your savings deposit`,
      data: { amount: award, reason: 'deposit_match', href: '/' },
      dedupeKey: `credit:deposit:${input.txRef}`,
    }).catch(() => {});
    return { creditAwarded: award, duplicate: false };
  },

  /**
   * Claw back pending deposit-match credits when the user redeems within the 30-day window. Voids the
   * most-recent PENDING deposit credits up to the redeemed USD amount (already-vested credits are
   * safe); a partial redeem splits the boundary row so the remainder keeps vesting.
   */
  async clawbackDepositMatch(input: { wallet: string; amountMicros: string | bigint; network: CreditNetwork; txRef?: string }): Promise<number> {
    const pool = getPayPool();
    if (!pool) return 0;
    await ensureTables();
    const redeemedUsd = Math.floor(Number(BigInt(input.amountMicros)) / 1_000_000);
    if (redeemedUsd > 0) {
      const fresh = await recordFlow(pool, { wallet: input.wallet, network: input.network, kind: 'redeem', usd: redeemedUsd, txRef: input.txRef });
      // The same redemption reported twice is clawed back once.
      if (!fresh) return 0;
    }
    // Vest matured credits first so we never claw back credits that already cleared the 30-day window.
    await pool.query(
      `UPDATE pay_credits SET status = 'vested' WHERE wallet = $1 AND status = 'pending' AND vest_until <= now()`,
      [input.wallet],
    );

    let toVoid = Math.floor(Number(BigInt(input.amountMicros)) / 1_000_000);
    if (toVoid <= 0) return 0;

    const rows = await pool.query(
      `SELECT id, amount FROM pay_credits
        WHERE wallet = $1 AND reason = 'deposit_match' AND status = 'pending' AND network = $2
        ORDER BY created_at DESC`,
      [input.wallet, input.network],
    );

    let voided = 0;
    for (const r of rows.rows) {
      if (toVoid <= 0) break;
      const amt = num(r.amount);
      await pool.query(`UPDATE pay_credits SET status = 'void' WHERE id = $1`, [r.id]);
      if (amt <= toVoid) {
        voided += amt;
        toVoid -= amt;
      } else {
        // Partial: keep the un-redeemed remainder vesting under a fresh row (same vest window).
        await pool.query(
          `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, streak_at_award, status, vest_until, network, created_at)
           SELECT $1, wallet, $2, $3, reason, source, streak_at_award, 'pending', vest_until, network, created_at
             FROM pay_credits WHERE id = $4`,
          [crypto.randomUUID(), `rem:${crypto.randomUUID()}`, amt - toVoid, r.id],
        );
        voided += toVoid;
        toVoid = 0;
      }
    }
    return voided;
  },

  /**
   * Rows ready to mint on chain: vested, not yet minted, on this network, oldest first. Vests matured
   * rows first. `maxAttempts` leaves out rows whose sends keep failing, so one bad row cannot hold up
   * the rest.
   */
  async mintableCredits(network: CreditNetwork, limit: number, maxAttempts = 5): Promise<MintableCredit[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTables();
    await pool.query(`UPDATE pay_credits SET status = 'vested' WHERE status = 'pending' AND vest_until <= now() AND network = $1`, [network]);
    const r = await pool.query(
      `SELECT id, wallet, amount, reason, created_at FROM pay_credits
        WHERE status = 'vested' AND mint_tx IS NULL AND network = $1 AND mint_attempts < $2
        ORDER BY created_at ASC LIMIT $3`,
      [network, maxAttempts, limit],
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      wallet: String(row.wallet),
      amount: num(row.amount),
      reason: String(row.reason),
      createdAt: new Date(row.created_at),
    }));
  },

  /**
   * Every credit on a network, for Command: minted by why it was earned, what is still in its 30 days
   * or vested and waiting for the minting job, what was voided, and what was minted each of the last
   * `days` days (UTC).
   */
  async creditsTotals(network: CreditNetwork, days = 14): Promise<CreditsTotals> {
    const pool = getPayPool();
    if (!pool) return { minted: { saving: 0, rent: 0, bill: 0 }, pending: 0, vested: 0, voided: 0, byDay: [] };
    await ensureTables();
    const [t, d] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'minted' AND reason = 'deposit_match'),0) AS saving,
           COALESCE(SUM(amount) FILTER (WHERE status = 'minted' AND reason = 'rent_on_time'),0) AS rent,
           COALESCE(SUM(amount) FILTER (WHERE status = 'minted' AND reason = 'bill_on_time'),0) AS bill,
           COALESCE(SUM(amount) FILTER (WHERE status = 'pending'),0) AS pending,
           COALESCE(SUM(amount) FILTER (WHERE status = 'vested'),0) AS vested,
           COALESCE(SUM(amount) FILTER (WHERE status = 'void'),0) AS voided
         FROM pay_credits WHERE network = $1`,
        [network],
      ),
      pool.query(
        `SELECT to_char(g.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(c.amount),0) AS minted
           FROM generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $2::int - 1), date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS g(day)
           LEFT JOIN pay_credits c
             ON c.network = $1 AND c.status = 'minted' AND date_trunc('day', c.minted_at AT TIME ZONE 'UTC') = g.day
          GROUP BY g.day ORDER BY g.day`,
        [network, days],
      ),
    ]);
    const r = t.rows[0] ?? {};
    return {
      minted: { saving: num(r.saving), rent: num(r.rent), bill: num(r.bill) },
      pending: num(r.pending),
      vested: num(r.vested),
      voided: num(r.voided),
      byDay: d.rows.map((row) => ({ day: String(row.day), minted: num(row.minted) })),
    };
  },

  /** The Points Issuer minted this row (or had already, under its ref). */
  async markCreditMinted(id: string, tx: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await pool.query(
      `UPDATE pay_credits SET status = 'minted', mint_tx = $2, minted_at = now(), mint_error = NULL WHERE id = $1 AND status = 'vested'`,
      [id, tx],
    );
  },

  /** The Points Issuer refused this row by one of its rules (outside the Match Period, a cap): void. */
  async markCreditRefused(id: string, reason: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await pool.query(`UPDATE pay_credits SET status = 'void', mint_error = $2 WHERE id = $1 AND status = 'vested'`, [id, reason.slice(0, 300)]);
  },

  /** A send failed for some other reason: counted, and retried next run. */
  async markCreditMintFailed(id: string, reason: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await pool.query(`UPDATE pay_credits SET mint_attempts = mint_attempts + 1, mint_error = $2 WHERE id = $1`, [id, reason.slice(0, 300)]);
  },

  async getSummary(wallet: string, network: CreditNetwork = 'mainnet'): Promise<PaySummary> {
    const pool = getPayPool();
    if (!pool) {
      return { dueThisMonth: 0, paid30: 0, totalEquity: 0, vestedEquity: 0, pendingEquity: 0, equityThisMonth: 0, streak: 0, sources: { match: 0, rent: 0, bills: 0 }, series: [] };
    }
    await ensureTables();
    // Lazily vest matured credits (pending → vested).
    await pool.query(`UPDATE pay_credits SET status = 'vested' WHERE wallet = $1 AND status = 'pending' AND vest_until <= now()`, [wallet]);

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const [due, paid, credits, monthly] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(default_amount),0) AS s FROM pay_billers b
          WHERE b.wallet = $1 AND b.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM pay_payments p WHERE p.wallet = b.wallet AND p.biller_id = b.id AND p.period = $2)`,
        [wallet, period],
      ),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS s FROM pay_payments WHERE wallet = $1 AND paid_at >= now() - interval '30 days'`, [wallet]),
      pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status IN ('pending','vested','minted')),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE status IN ('vested','minted')),0) AS vested,
           COALESCE(SUM(amount) FILTER (WHERE status = 'pending'),0) AS pending,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now()) AND status <> 'void'),0) AS this_month,
           COALESCE(SUM(amount) FILTER (WHERE reason = 'deposit_match' AND status <> 'void'),0) AS match_credits,
           COALESCE(SUM(amount) FILTER (WHERE reason = 'rent_on_time' AND status <> 'void'),0) AS rent_credits,
           COALESCE(SUM(amount) FILTER (WHERE reason = 'bill_on_time' AND status <> 'void'),0) AS bill_credits
         FROM pay_credits WHERE wallet = $1 AND network = $2`,
        [wallet, network],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', m), 'Mon') AS label,
                COALESCE(rent.s,0) AS rent, COALESCE(cred.s,0) AS equity
           FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m
           LEFT JOIN LATERAL (SELECT SUM(amount) s FROM pay_payments p WHERE p.wallet = $1 AND p.type = 'rent' AND date_trunc('month', p.paid_at) = m) rent ON true
           LEFT JOIN LATERAL (SELECT SUM(amount) s FROM pay_credits c WHERE c.wallet = $1 AND c.network = $2 AND c.created_at <= m + interval '1 month' - interval '1 second' AND c.status <> 'void') cred ON true
           ORDER BY m`,
        [wallet, network],
      ),
    ]);

    return {
      dueThisMonth: num(due.rows[0]?.s),
      paid30: num(paid.rows[0]?.s),
      totalEquity: num(credits.rows[0]?.total),
      vestedEquity: num(credits.rows[0]?.vested),
      pendingEquity: num(credits.rows[0]?.pending),
      equityThisMonth: num(credits.rows[0]?.this_month),
      streak: await computeStreak(wallet),
      sources: {
        match: num(credits.rows[0]?.match_credits),
        rent: num(credits.rows[0]?.rent_credits),
        bills: num(credits.rows[0]?.bill_credits),
      },
      series: monthly.rows.map((r) => ({ label: String(r.label), rent: num(r.rent), equity: num(r.equity) })),
    };
  },
};
