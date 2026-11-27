import type { ReceiveDetails } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { bridge } from '../../billerPayoutService.js';
import { getCustomerSnapshot } from '../../bridgeCustomerService.js';
import { sendNotificationService } from '../../sendNotificationService.js';
import { audit } from '../security/audit.js';

/**
 * Payouts › Receive: the shop's own account and routing numbers, for being paid by ACH or wire.
 *
 * They are a Bridge virtual account on the shop's verified business customer: dollars sent to them
 * are converted to USDC and delivered to the shop's wallet, which is its cash account, so a deposit
 * shows in the cash figure as any other USDC does. Bridge opens one only for a verified business;
 * an owner opens it once, and after that it's read back from Bridge each time rather than copied
 * here. Clear stores none of the numbers.
 */

export class ReceiveError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'not_verified' | 'no_email' | 'upstream',
    readonly status = 422,
  ) {
    super(message);
    this.name = 'ReceiveError';
  }
}

type Account = NonNullable<ReceiveDetails['account']>;

/** Bridge, as receiving uses it: swapped for a stand-in in tests. */
export interface BridgeReceive {
  configured(): boolean;
  verified(customerId: string): Promise<boolean>;
  /** The customer's account that pays into `address`, if one is open. */
  find(customerId: string, address: string): Promise<Account | null>;
  open(customerId: string, address: string): Promise<Account | { error: string }>;
}

type BridgeVirtualAccount = {
  id?: string;
  status?: string;
  destination?: { address?: string; currency?: string };
  source_deposit_instructions?: {
    bank_name?: string;
    bank_account_number?: string;
    account_number?: string;
    bank_routing_number?: string;
    routing_number?: string;
    bank_beneficiary_name?: string;
    payment_rails?: string[];
  };
};

function toAccount(va: BridgeVirtualAccount): Account | null {
  const di = va.source_deposit_instructions;
  const accountNumber = di?.bank_account_number || di?.account_number;
  const routingNumber = di?.bank_routing_number || di?.routing_number;
  if (!accountNumber || !routingNumber) return null;
  return { beneficiary: di?.bank_beneficiary_name ?? '', bankName: di?.bank_name ?? null, routingNumber, accountNumber, rails: di?.payment_rails ?? [] };
}

/** The chain Bridge delivers on: the same setting the member app's accounts use. */
const chain = () => (process.env.BRIDGE_PAYOUT_SOURCE_CHAIN || 'base').trim();

export function bridgeReceive(): BridgeReceive {
  return {
    configured: () => Boolean((process.env.BRIDGE_API_KEY || '').trim()),
    // Verified, and as the business: never the owner verified as a person (kybService.ts).
    verified: async (customerId) => {
      const s = await getCustomerSnapshot(customerId);
      return s?.status === 'active' && s.type !== 'individual';
    },
    async find(customerId, address) {
      const r = await bridge<{ data?: BridgeVirtualAccount[] }>(`/customers/${encodeURIComponent(customerId)}/virtual_accounts`);
      if (!r.ok) throw new ReceiveError(r.message || 'Bridge didn’t answer. Try again.', 'upstream', 502);
      // Only one paying the shop's own wallet in USDC: anything else on the customer isn't this.
      for (const va of r.data?.data ?? []) {
        if (va.status && va.status !== 'activated') continue;
        if (va.destination?.address?.toLowerCase() !== address.toLowerCase() || va.destination.currency !== 'usdc') continue;
        const a = toAccount(va);
        if (a) return a;
      }
      return null;
    },
    async open(customerId, address) {
      const r = await bridge<BridgeVirtualAccount>(`/customers/${encodeURIComponent(customerId)}/virtual_accounts`, {
        method: 'POST',
        // One per shop and chain, however many times it's asked for.
        headers: { 'Idempotency-Key': `merchant-va-${customerId}-${address.toLowerCase()}-${chain()}` },
        body: JSON.stringify({ source: { currency: 'usd' }, destination: { currency: 'usdc', payment_rail: chain(), address } }),
      });
      if (!r.ok || !r.data) return { error: r.message || 'Bridge didn’t open the account.' };
      return toAccount(r.data) ?? { error: 'Bridge opened the account but sent no account number. Try again.' };
    },
  };
}

type Profile = { name: string; bridge_customer_id: string | null; kyb_email: string | null };
async function profile(q: Queryable, merchant: string): Promise<Profile | undefined> {
  const { rows } = await q.query<Profile>('SELECT name, bridge_customer_id, kyb_email FROM merchant.profiles WHERE merchant = $1', [merchant]);
  return rows[0];
}

const withName = (a: Account, p: Profile): Account => ({ ...a, beneficiary: a.beneficiary || p.name });

export async function receiveDetails(q: Queryable, bridge: BridgeReceive, merchant: string): Promise<ReceiveDetails> {
  const p = await profile(q, merchant);
  const email = p?.kyb_email ?? null;
  if (!bridge.configured()) return { state: 'not_configured', account: null, email };
  if (!p?.bridge_customer_id) return { state: 'not_verified', account: null, email };
  const found = await bridge.find(p.bridge_customer_id, merchant);
  if (found) return { state: 'ready', account: withName(found, p), email };
  return { state: (await bridge.verified(p.bridge_customer_id)) ? 'not_opened' : 'not_verified', account: null, email };
}

/** Opens the shop's account, or hands back the one it has. */
export async function openReceive(q: Queryable, bridge: BridgeReceive, input: { merchant: string; staffId: string }): Promise<ReceiveDetails> {
  if (!bridge.configured()) throw new ReceiveError('Receiving by ACH isn’t available yet.', 'not_configured', 503);
  const p = await profile(q, input.merchant);
  const verify = 'Verify the business first (Settings › Advanced): Bridge opens an account only for a verified business.';
  if (!p?.bridge_customer_id) throw new ReceiveError(verify, 'not_verified', 409);
  const found = await bridge.find(p.bridge_customer_id, input.merchant);
  if (found) return { state: 'ready', account: withName(found, p), email: p.kyb_email };
  if (!(await bridge.verified(p.bridge_customer_id))) throw new ReceiveError(verify, 'not_verified', 409);
  const opened = await bridge.open(p.bridge_customer_id, input.merchant);
  if ('error' in opened) throw new ReceiveError(opened.error, 'upstream', 502);
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'receive.opened', ref: null, amountCents: null, detail: { last4: opened.accountNumber.slice(-4) } });
  return { state: 'ready', account: withName(opened, p), email: p.kyb_email };
}

/** The details as an email, to the address the business was verified under (and only there). */
export async function emailReceive(
  q: Queryable,
  bridge: BridgeReceive,
  send: (m: { to: string; subject: string; body: string }) => Promise<unknown>,
  input: { merchant: string; staffId: string },
): Promise<{ to: string }> {
  const d = await receiveDetails(q, bridge, input.merchant);
  if (!d.account) throw new ReceiveError('Open the account first.', 'not_verified', 409);
  if (!d.email) throw new ReceiveError('There’s no business email on file to send them to.', 'no_email', 409);
  const a = d.account;
  const body = [
    'Your Clear account for being paid by ACH or wire:',
    '',
    `Account name: ${a.beneficiary}`,
    ...(a.bankName ? [`Bank: ${a.bankName}`] : []),
    `Routing number: ${a.routingNumber}`,
    `Account number: ${a.accountNumber}`,
    'Type: Checking',
    '',
    'Money sent here arrives in your Clear cash account, usually the same business day.',
  ].join('\n');
  await send({ to: d.email, subject: 'Your account and routing numbers', body }).catch((e: unknown) => {
    throw new ReceiveError(`The email didn’t send: ${e instanceof Error ? e.message : String(e)}`, 'upstream', 502);
  });
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'receive.emailed', ref: null, amountCents: null, detail: { domain: d.email.split('@')[1] ?? '' } });
  return { to: d.email };
}

export const sendReceiveEmail = (m: { to: string; subject: string; body: string }) => sendNotificationService.sendEmail(m);
