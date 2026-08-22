import { getPayPool } from '../../config/postgres.js';

/*
 * Which Lithic banking identity belongs to which member.
 *
 * Wallet-keyed and lowercased, matching bridge_customers and clear_cards — one member has one
 * banking identity, and a UNIQUE wallet is what makes a retried provision impossible to duplicate
 * at the database level rather than only at the API's.
 *
 * The tokens themselves are identifiers, not credentials: they authorise nothing without the
 * program API key, so they sit in plain columns rather than going through envelope encryption the
 * way Plaid access tokens do. The account NUMBER is different — it is bank detail, so it is not
 * stored here at all. We read it from Lithic when the member asks to see it.
 */

const TABLE = 'lithic_accounts';

export interface LithicAccountRecord {
  wallet: string;
  accountHolderToken: string;
  accountToken: string;
  /** Where card spending draws from. Null until the program has Financial Accounts. */
  issuingFinancialAccountToken: string | null;
  /** The routable one — where direct deposit lands. Null until the program supports it. */
  cashFinancialAccountToken: string | null;
  /** Lithic's KYC verdict: ACCEPTED | PENDING_REVIEW | PENDING_DOCUMENT | PENDING_RESUBMIT | REJECTED */
  status: string;
  statusReasons: string[];
  createdAt: string;
  updatedAt: string;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      wallet TEXT PRIMARY KEY,
      account_holder_token TEXT NOT NULL,
      account_token TEXT NOT NULL,
      issuing_financial_account_token TEXT,
      cash_financial_account_token TEXT,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      status_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE}_account_token_idx ON ${TABLE} (account_token);
    CREATE INDEX IF NOT EXISTS ${TABLE}_cash_fa_idx ON ${TABLE} (cash_financial_account_token);
  `);
  ensured = true;
}

function normaliseWallet(wallet: string): string {
  return String(wallet || '').trim().toLowerCase();
}

interface Row {
  wallet: string;
  account_holder_token: string;
  account_token: string;
  issuing_financial_account_token: string | null;
  cash_financial_account_token: string | null;
  status: string;
  status_reasons: string[] | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: Row): LithicAccountRecord {
  return {
    wallet: row.wallet,
    accountHolderToken: row.account_holder_token,
    accountToken: row.account_token,
    issuingFinancialAccountToken: row.issuing_financial_account_token,
    cashFinancialAccountToken: row.cash_financial_account_token,
    status: row.status,
    statusReasons: row.status_reasons ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const lithicStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async get(wallet: string): Promise<LithicAccountRecord | null> {
    const pool = getPayPool();
    const w = normaliseWallet(wallet);
    if (!pool || !w) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE wallet = $1`, [w]);
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /**
   * Record the identity Lithic just created, or refresh what we know about it.
   *
   * ON CONFLICT updates rather than ignores: the financial account tokens arrive later than the
   * account tokens do — a member provisioned before the program had Financial Accounts gets them
   * filled in on the next read, without a second banking identity.
   */
  async upsert(
    wallet: string,
    input: {
      accountHolderToken: string;
      accountToken: string;
      issuingFinancialAccountToken?: string | null;
      cashFinancialAccountToken?: string | null;
      status: string;
      statusReasons?: string[];
    },
  ): Promise<LithicAccountRecord | null> {
    const pool = getPayPool();
    const w = normaliseWallet(wallet);
    if (!pool || !w) return null;
    await ensureTable();

    const { rows } = await pool.query<Row>(
      `
      INSERT INTO ${TABLE} (
        wallet, account_holder_token, account_token,
        issuing_financial_account_token, cash_financial_account_token,
        status, status_reasons
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (wallet) DO UPDATE SET
        account_holder_token = EXCLUDED.account_holder_token,
        account_token = EXCLUDED.account_token,
        issuing_financial_account_token =
          COALESCE(EXCLUDED.issuing_financial_account_token, ${TABLE}.issuing_financial_account_token),
        cash_financial_account_token =
          COALESCE(EXCLUDED.cash_financial_account_token, ${TABLE}.cash_financial_account_token),
        status = EXCLUDED.status,
        status_reasons = EXCLUDED.status_reasons,
        updated_at = now()
      RETURNING *
      `,
      [
        w,
        input.accountHolderToken,
        input.accountToken,
        input.issuingFinancialAccountToken ?? null,
        input.cashFinancialAccountToken ?? null,
        input.status,
        JSON.stringify(input.statusReasons ?? []),
      ],
    );

    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** Reverse lookup from the cash account — how an inbound ACH finds its member. */
  async findByCashFinancialAccount(token: string): Promise<LithicAccountRecord | null> {
    const pool = getPayPool();
    const t = String(token || '').trim();
    if (!pool || !t) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE cash_financial_account_token = $1`,
      [t],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** Reverse lookup for webhooks and the auth stream, which arrive knowing only Lithic's tokens. */
  async findByAccountToken(accountToken: string): Promise<LithicAccountRecord | null> {
    const pool = getPayPool();
    const token = String(accountToken || '').trim();
    if (!pool || !token) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE account_token = $1`, [
      token,
    ]);
    return rows[0] ? toRecord(rows[0]) : null;
  },
};
