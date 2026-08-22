import { getPayPool } from '../../config/postgres.js';
import { requireLithic } from '../lithic/lithicClient.js';
import { lithicStore } from '../lithic/lithicStore.js';
import { ensureVirtualAccount } from '../bridgeCustomerService.js';

/*
 * The rail a sweep travels — Lithic fiat out to the member's own Bridge virtual account.
 *
 * This replaces the treasury. Bridge already converts USD to USDC and delivers it to the member's
 * smart wallet, so there is no reason to hold a USDC float and convert it ourselves. More to the
 * point, a float would mean holding member dollars while owing them tokens, which is a money
 * transmission posture — and when Bridge holds it, Bridge's licenses cover it.
 *
 * The money never touches a co-op balance sheet. It goes from the member's Lithic account to the
 * member's Bridge account to the member's smart wallet. Every hop is theirs.
 *
 * What this module does is the boring prerequisite: Lithic can only push to an external bank
 * account it knows about, so the member's Bridge virtual account has to be registered as one. That
 * registration is cached, because it is per-member and permanent.
 */

const TABLE = 'sweep_rail_accounts';

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      wallet TEXT PRIMARY KEY,
      external_bank_account_token TEXT NOT NULL,
      virtual_account_id TEXT,
      last_four TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  ensured = true;
}

async function cached(wallet: string): Promise<string | null> {
  const pool = getPayPool();
  if (!pool) return null;
  await ensureTable();
  const { rows } = await pool.query<{ external_bank_account_token: string }>(
    `SELECT external_bank_account_token FROM ${TABLE} WHERE wallet = $1`,
    [wallet.toLowerCase()],
  );
  return rows[0]?.external_bank_account_token ?? null;
}

/**
 * The Lithic external-account token pointing at this member's Bridge virtual account.
 *
 * Registered as `EXTERNALLY_VERIFIED`, which everywhere else in this codebase is a claim we refuse
 * to make by default. It is honest here and nowhere else: these numbers came from Bridge's API for
 * a virtual account Bridge opened for this member, not from a member typing digits into a form.
 * There is no ownership left to prove — the account exists because we asked for it, on their behalf.
 */
export async function ensureRailAccount(input: {
  wallet: string;
  customerId: string;
  walletAddress: string;
}): Promise<{ token: string } | { error: string }> {
  const existing = await cached(input.wallet);
  if (existing) return { token: existing };

  const va = await ensureVirtualAccount({
    customerId: input.customerId,
    walletAddress: input.walletAddress,
  });
  if ('error' in va) return { error: va.error };

  const { accountNumber, routingNumber } = va.account;
  if (!accountNumber || !routingNumber) {
    return { error: 'Bridge returned an account without deposit instructions' };
  }

  const record = await lithicStore.get(input.wallet);
  if (!record?.cashFinancialAccountToken) {
    return { error: 'Member has no Lithic cash account' };
  }

  const lithic = requireLithic();
  const created = (await lithic.externalBankAccounts.create({
    financial_account_token: record.cashFinancialAccountToken,
    account_number: accountNumber,
    routing_number: routingNumber,
    type: 'CHECKING',
    owner: va.account.beneficiary || 'Clear member',
    owner_type: 'INDIVIDUAL',
    country: 'USA',
    currency: 'USD',
    verification_method: 'EXTERNALLY_VERIFIED',
    name: 'Clear savings rail',
  } as Parameters<typeof lithic.externalBankAccounts.create>[0])) as { token?: string };

  const token = String(created.token ?? '');
  if (!token) return { error: 'Lithic did not return an external account token' };

  const pool = getPayPool();
  if (pool) {
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (wallet, external_bank_account_token, virtual_account_id, last_four)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet) DO UPDATE SET
         external_bank_account_token = EXCLUDED.external_bank_account_token,
         virtual_account_id = EXCLUDED.virtual_account_id,
         last_four = EXCLUDED.last_four`,
      [
        input.wallet.toLowerCase(),
        token,
        va.account.id,
        accountNumber.slice(-4),
      ],
    );
  }

  return { token };
}

/**
 * Push fiat out of the member's Lithic account toward Bridge.
 *
 * `PAYMENT` is the outbound direction — the mirror of the `COLLECTION` used to pull from a linked
 * bank in step 5. Getting these the wrong way round moves money the wrong way, which is why the
 * type is spelled out here rather than parameterised.
 *
 * The sweep id is the idempotency token, so a retry after a timeout — the case where we genuinely
 * cannot tell whether the debit landed — resolves to the same payment instead of a second one.
 */
export async function pushToBridge(input: {
  wallet: string;
  externalBankAccountToken: string;
  amountCents: number;
  idempotencyToken: string;
  memo?: string;
}): Promise<{ paymentToken: string; status: string }> {
  const lithic = requireLithic();
  const record = await lithicStore.get(input.wallet);
  if (!record?.cashFinancialAccountToken) {
    throw new Error('Member has no Lithic cash account — cannot push from it');
  }

  const payment = (await lithic.payments.create({
    type: 'PAYMENT',
    financial_account_token: record.cashFinancialAccountToken,
    external_bank_account_token: input.externalBankAccountToken,
    amount: Math.round(input.amountCents),
    method: 'ACH_NEXT_DAY',
    method_attributes: { sec_code: 'CCD' },
    token: input.idempotencyToken,
    ...(input.memo ? { memo: input.memo } : {}),
  } as Parameters<typeof lithic.payments.create>[0])) as { token?: string; status?: string };

  return {
    paymentToken: String(payment.token ?? input.idempotencyToken),
    status: String(payment.status ?? 'PENDING'),
  };
}
