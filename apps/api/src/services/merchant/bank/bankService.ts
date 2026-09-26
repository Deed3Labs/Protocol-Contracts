import { randomUUID } from 'node:crypto';
import { AddBank, type BankAccount } from '@clear/merchant-contracts';
import { Configuration, CountryCode, DepositoryAccountSubtype, PlaidApi, PlaidEnvironments, Products } from 'plaid';
import type { Queryable } from '../../../db/db.js';
import { bridge } from '../../billerPayoutService.js';
import { audit } from '../security/audit.js';

/**
 * The shop's bank accounts, for withdrawing to (Payouts › Where withdrawals go).
 *
 * Linked with Clear's own Plaid (the owner signs in to the bank in Plaid Link, which verifies it's
 * real and theirs, with no typed numbers and no test deposits), then registered with the rail that
 * pays out to it. That rail is Bridge today; the `BankRail` seam is where Lithic would go if it
 * becomes the shop's fiat rail. The full account and routing numbers pass from Plaid to the rail
 * and are never stored or logged here, and the Plaid link is closed once they have: Clear keeps the
 * bank's name, the last four digits and whether it's checking or savings.
 */

export class BankError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_configured' | 'not_verified' | 'not_found' | 'upstream',
    readonly status = 422,
  ) {
    super(message);
    this.name = 'BankError';
  }
}

/** Plaid, as linking a bank uses it. */
export interface PlaidBank {
  configured(): boolean;
  linkToken(clientUserId: string): Promise<string>;
  /** The chosen account's numbers, then the link closed. */
  accountFor(publicToken: string, accountId: string): Promise<{ accountNumber: string; routingNumber: string; mask: string; subtype: 'checking' | 'savings'; name: string } | null>;
}

/** Where payouts go out from: registers a bank account with the rail that pays it. */
export interface BankRail {
  readonly name: 'bridge' | 'lithic';
  register(input: {
    customerId: string;
    ownerName: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    subtype: 'checking' | 'savings';
    address: { line1: string; line2: string | null; city: string; region: string; postalCode: string };
  }): Promise<{ externalAccountId: string } | { error: string }>;
  remove(customerId: string, externalAccountId: string): Promise<void>;
}

/** Clear's Plaid (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV), as the member app's routes use it. */
function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  const basePath = process.env.PLAID_ENV === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  return new PlaidApi(new Configuration({ basePath, baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } } }));
}

export function plaidBank(): PlaidBank {
  return {
    configured: () => getPlaidClient() !== null,
    async linkToken(clientUserId) {
      const plaid = getPlaidClient()!;
      const r = await plaid.linkTokenCreate({
        user: { client_user_id: clientUserId },
        client_name: 'Clear',
        products: [Products.Auth],
        country_codes: [CountryCode.Us],
        language: 'en',
        account_filters: { depository: { account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings] } },
      });
      return r.data.link_token;
    },
    async accountFor(publicToken, accountId) {
      const plaid = getPlaidClient()!;
      const { data: ex } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
      try {
        const { data } = await plaid.authGet({ access_token: ex.access_token, options: { account_ids: [accountId] } });
        const ach = data.numbers.ach.find((n) => n.account_id === accountId);
        const acct = data.accounts.find((a) => a.account_id === accountId);
        if (!ach || !acct) return null;
        return {
          accountNumber: ach.account,
          routingNumber: ach.routing,
          mask: acct.mask ?? ach.account.slice(-4),
          subtype: acct.subtype === 'savings' ? 'savings' : 'checking',
          name: acct.official_name ?? acct.name,
        };
      } finally {
        // The numbers are all that was needed: close the link so nothing more can be read through it.
        await plaid.itemRemove({ access_token: ex.access_token }).catch(() => undefined);
      }
    },
  };
}

export function bridgeRail(): BankRail {
  return {
    name: 'bridge',
    async register(input) {
      const r = await bridge<{ id?: string }>(`/customers/${encodeURIComponent(input.customerId)}/external_accounts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          currency: 'usd',
          account_type: 'us',
          bank_name: input.bankName,
          account_owner_name: input.ownerName,
          account_owner_type: 'business',
          business_name: input.ownerName,
          account: { account_number: input.accountNumber, routing_number: input.routingNumber, checking_or_savings: input.subtype },
          address: {
            street_line_1: input.address.line1,
            ...(input.address.line2 ? { street_line_2: input.address.line2 } : {}),
            city: input.address.city,
            state: input.address.region,
            postal_code: input.address.postalCode,
            country: 'USA',
          },
        }),
      });
      return r.ok && r.data?.id ? { externalAccountId: r.data.id } : { error: r.message || 'Bridge didn’t take the bank account.' };
    },
    async remove(customerId, externalAccountId) {
      await bridge(`/customers/${encodeURIComponent(customerId)}/external_accounts/${encodeURIComponent(externalAccountId)}`, { method: 'DELETE' });
    },
  };
}

type Row = { id: string; bank_name: string; mask: string; subtype: 'checking' | 'savings'; added_at: Date | string };
const toBank = (r: Row): BankAccount => ({ id: r.id, bankName: r.bank_name, mask: r.mask, subtype: r.subtype, addedAt: new Date(r.added_at).toISOString() });

export async function bankAccounts(q: Queryable, merchant: string): Promise<BankAccount[]> {
  const { rows } = await q.query<Row>('SELECT * FROM merchant.bank_accounts WHERE merchant = $1 AND removed_at IS NULL ORDER BY added_at', [merchant]);
  return rows.map(toBank);
}

export async function bankLinkToken(plaid: PlaidBank, merchant: string): Promise<{ linkToken: string }> {
  if (!plaid.configured()) throw new BankError('Linking a bank isn’t available yet.', 'not_configured', 503);
  return { linkToken: await plaid.linkToken(merchant) };
}

/** The account chosen in Plaid Link: its numbers from Plaid, registered with the rail, and listed. */
export async function addBank(q: Queryable, deps: { plaid: PlaidBank; rail: BankRail }, input: { merchant: string; staffId: string; body: unknown }): Promise<BankAccount> {
  const parsed = AddBank.safeParse(input.body);
  if (!parsed.success) throw new BankError('Choose an account in Plaid first', 'invalid');
  if (!deps.plaid.configured()) throw new BankError('Linking a bank isn’t available yet.', 'not_configured', 503);
  const { rows: shop } = await q.query<{ name: string; bridge_customer_id: string | null; address_line1: string | null; address_line2: string | null; address_city: string | null; address_region: string | null; address_postal_code: string | null }>(
    'SELECT name, bridge_customer_id, address_line1, address_line2, address_city, address_region, address_postal_code FROM merchant.profiles WHERE merchant = $1',
    [input.merchant],
  );
  const p = shop[0];
  if (!p?.bridge_customer_id) throw new BankError('Verify the business first (Settings › Advanced): Bridge pays out only to a verified business.', 'not_verified', 409);
  if (!p.address_line1 || !p.address_city || !p.address_region || !p.address_postal_code) throw new BankError('Add the shop’s address first (Settings › Shop): the bank account is registered at it.', 'invalid', 409);

  const acct = await deps.plaid.accountFor(parsed.data.publicToken, parsed.data.accountId).catch((e: unknown) => {
    throw new BankError(`Plaid couldn’t read that account: ${e instanceof Error ? e.message : String(e)}`, 'upstream', 502);
  });
  if (!acct) throw new BankError('That account can’t take payouts (no routing number). Choose a checking or savings account.', 'invalid');
  const bankName = parsed.data.institution || acct.name;
  const reg = await deps.rail.register({
    customerId: p.bridge_customer_id,
    ownerName: p.name,
    bankName,
    accountNumber: acct.accountNumber,
    routingNumber: acct.routingNumber,
    subtype: acct.subtype,
    address: { line1: p.address_line1, line2: p.address_line2, city: p.address_city, region: p.address_region, postalCode: p.address_postal_code },
  });
  if ('error' in reg) throw new BankError(reg.error, 'upstream', 502);
  const id = `bank_${randomUUID()}`;
  const { rows } = await q.query<Row>(
    `INSERT INTO merchant.bank_accounts (id, merchant, rail, external_account_id, bank_name, mask, subtype, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, input.merchant, deps.rail.name, reg.externalAccountId, bankName, acct.mask, acct.subtype, input.staffId],
  );
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'bank.added', ref: { type: 'bank_account', id }, amountCents: null, detail: { bank: bankName, mask: acct.mask } });
  return toBank(rows[0]!);
}

export async function removeBank(q: Queryable, rail: BankRail, input: { merchant: string; staffId: string; id: string }): Promise<void> {
  const { rows } = await q.query<{ external_account_id: string; bridge_customer_id: string | null; mask: string }>(
    `UPDATE merchant.bank_accounts b SET removed_at = now() FROM merchant.profiles p
      WHERE b.id = $1 AND b.merchant = $2 AND b.removed_at IS NULL AND p.merchant = b.merchant
      RETURNING b.external_account_id, p.bridge_customer_id, b.mask`,
    [input.id, input.merchant],
  );
  if (!rows[0]) throw new BankError('No such bank account', 'not_found', 404);
  if (rows[0].bridge_customer_id) await rail.remove(rows[0].bridge_customer_id, rows[0].external_account_id).catch(() => undefined);
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'bank.removed', ref: { type: 'bank_account', id: input.id }, amountCents: null, detail: { mask: rows[0].mask } });
}
