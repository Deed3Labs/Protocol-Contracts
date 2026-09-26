import { type KybStatus, StartKyb } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { getCustomerSnapshot, startKyc, type CustomerSnapshot } from '../../bridgeCustomerService.js';
import { audit } from '../security/audit.js';

/**
 * The shop's business verification (KYB), hosted by Bridge, as the member app's KYC is: Clear sends
 * the owner to Bridge's pages (its terms, then the business's details and documents), and reads back
 * where it stands. Bridge needs this before it moves the shop's money to a bank. Clear keeps only
 * Bridge's customer id and the address it was started under; the business's documents and owners'
 * details stay with Bridge.
 */

export class KybError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_configured' | 'upstream',
    readonly status = 422,
  ) {
    super(message);
    this.name = 'KybError';
  }
}

/** Bridge, as KYB uses it: swapped for a stand-in in tests. */
export interface BridgeKyb {
  configured(): boolean;
  start(input: { email: string; legalName: string; redirectUri: string }): Promise<{ customerId: string | null; url: string | null } | { error: string; status: number }>;
  snapshot(customerId: string): Promise<CustomerSnapshot | null>;
}

export function bridgeKyb(): BridgeKyb {
  return {
    configured: () => Boolean((process.env.BRIDGE_API_KEY || '').trim()),
    start: (input) => startKyc({ emails: [input.email], email: input.email, fullName: input.legalName, customerType: 'business', redirectUri: input.redirectUri }),
    snapshot: getCustomerSnapshot,
  };
}

/** Bridge's customer status, as the shop reads it. */
function stateOf(s: CustomerSnapshot): KybStatus['state'] {
  switch (s.status) {
    case 'active':
      return 'verified';
    case 'rejected':
    case 'offboarded':
      return 'rejected';
    case 'under_review':
      return 'in_review';
    case 'paused':
      return 'paused';
    default:
      return 'needs_info';
  }
}

export async function kybStatus(q: Queryable, bridge: BridgeKyb, merchant: string): Promise<KybStatus> {
  const { rows } = await q.query<{ bridge_customer_id: string | null; kyb_email: string | null }>('SELECT bridge_customer_id, kyb_email FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const p = rows[0];
  const available = bridge.configured();
  if (!p?.bridge_customer_id) return { state: 'not_started', withdrawToBank: false, reason: null, email: p?.kyb_email ?? null, available };
  const snap = available ? await bridge.snapshot(p.bridge_customer_id) : null;
  // Bridge unreachable: say it's under way rather than guess either way.
  if (!snap) return { state: 'needs_info', withdrawToBank: false, reason: null, email: p.kyb_email, available };
  const state = stateOf(snap);
  return {
    state,
    withdrawToBank: state === 'verified' && snap.payoutFiat === 'active',
    reason: snap.rejectionReason,
    email: p.kyb_email,
    available,
  };
}

/**
 * The link to Bridge's hosted verification. The first time, it makes the shop a Bridge business
 * customer under the email given; after that, the same customer's link (to carry on, or fix what
 * Bridge asked for). Bridge sends the owner back to Settings › Advanced when they're done.
 */
export async function startKyb(q: Queryable, bridge: BridgeKyb, input: { merchant: string; staffId: string; body: unknown; appUrl: string }): Promise<{ url: string }> {
  const parsed = StartKyb.safeParse(input.body);
  if (!parsed.success) throw new KybError(parsed.error.issues[0]?.message ?? 'The business’s name and email', 'invalid');
  if (!bridge.configured()) throw new KybError('Business verification isn’t available yet.', 'not_configured', 503);
  const { rows } = await q.query<{ bridge_customer_id: string | null; kyb_email: string | null }>('SELECT bridge_customer_id, kyb_email FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  // Once started, it stays with the address it was started under: Bridge finds the customer by it.
  const email = rows[0]?.kyb_email ?? parsed.data.email.toLowerCase();
  const r = await bridge.start({ email, legalName: parsed.data.legalName, redirectUri: `${input.appUrl.replace(/\/+$/, '')}/settings/advanced?kyb=back` });
  if ('error' in r) throw new KybError(r.error, 'upstream', r.status >= 500 ? 502 : 422);
  if (!r.url) throw new KybError('Bridge returned no verification link. Try again.', 'upstream', 502);
  await q.query('UPDATE merchant.profiles SET bridge_customer_id = COALESCE(bridge_customer_id, $2), kyb_email = COALESCE(kyb_email, $3) WHERE merchant = $1', [input.merchant, r.customerId, email]);
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'kyb.started', ref: null, amountCents: null, detail: { domain: email.split('@')[1] ?? '' } });
  return { url: r.url };
}
