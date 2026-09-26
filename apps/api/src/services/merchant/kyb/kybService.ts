import { randomUUID } from 'node:crypto';
import { type KybStatus, StartKyb } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { bridge } from '../../billerPayoutService.js';
import { getCustomerSnapshot, verificationLinkFor, type CustomerSnapshot } from '../../bridgeCustomerService.js';
import { audit } from '../security/audit.js';
import { shopBridgeCustomers } from '../shopBridgeCustomers.js';

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
  /** The verification link: for `customerId` when the shop has one, else for a new business customer under `email`. */
  start(input: { customerId: string | null; email: string; legalName: string; redirectUri: string }): Promise<{ customerId: string | null; url: string | null } | { error: string; status: number }>;
  snapshot(customerId: string): Promise<CustomerSnapshot | null>;
}

export const PERSONAL_EMAIL =
  'That email is already verified with Bridge as a person, not a business (a Clear member account, perhaps). Verify the business under an email that belongs to it, such as accounts@ at the shop’s own domain.';

/*
 * Never found by email, as the member app finds its customers: Bridge keeps one verification per
 * email, so the owner's own address would hand back the owner, verified as a person, and the shop
 * would take them for the business. The shop's own customer is used once it has one; before that a
 * new business customer is made, and an email Bridge already has is taken only if it's a business
 * that isn't another shop's.
 */
export function bridgeKyb(): BridgeKyb {
  return {
    configured: () => Boolean((process.env.BRIDGE_API_KEY || '').trim()),
    async start(input) {
      if (input.customerId) {
        const r = await verificationLinkFor(input.customerId, input.redirectUri);
        return r ? { customerId: input.customerId, url: r.url } : { error: 'Bridge returned no verification link. Try again.', status: 502 };
      }
      const created = await bridge<{ customer_id?: string; kyc_link?: string; tos_link?: string }>('/kyc_links', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ full_name: input.legalName, email: input.email, type: 'business', redirect_uri: input.redirectUri }),
      });
      if (created.ok && created.data) return { customerId: created.data.customer_id ?? null, url: created.data.tos_link || created.data.kyc_link || null };
      // Bridge already has this email: it refuses with the link it made for it.
      const dup = (created.body as { existing_kyc_link?: { customer_id?: string; type?: string } } | null | undefined)?.existing_kyc_link;
      if (dup?.customer_id) {
        if (dup.type !== 'business') return { error: PERSONAL_EMAIL, status: 409 };
        if ((await shopBridgeCustomers([dup.customer_id])).has(dup.customer_id)) return { error: 'That email already verifies another shop with Bridge. Use this business’s own email.', status: 409 };
        const r = await verificationLinkFor(dup.customer_id, input.redirectUri);
        if (r) return { customerId: dup.customer_id, url: r.url };
      }
      return { error: created.message || 'Bridge couldn’t start the verification.', status: created.status || 502 };
    },
    snapshot: getCustomerSnapshot,
  };
}

const AS_A_PERSON = 'This was verified as a person, not the business. Start again with an email that belongs to the business.';

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
  // Started (before this was checked) under the owner's own verification: it isn't the business's.
  if (snap.type === 'individual') return { state: 'needs_info', withdrawToBank: false, reason: AS_A_PERSON, email: p.kyb_email, available };
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
  let customerId = rows[0]?.bridge_customer_id ?? null;
  // Once started, it stays with the customer and address it was started under...
  let email = rows[0]?.kyb_email ?? parsed.data.email.toLowerCase();
  // ...unless that was the owner verified as a person: then it starts over as the business.
  if (customerId && (await bridge.snapshot(customerId))?.type === 'individual') {
    customerId = null;
    email = parsed.data.email.toLowerCase();
  }
  const r = await bridge.start({ customerId, email, legalName: parsed.data.legalName, redirectUri: `${input.appUrl.replace(/\/+$/, '')}/settings/advanced?kyb=back` });
  if ('error' in r) throw new KybError(r.error, 'upstream', r.status >= 500 ? 502 : r.status === 409 ? 409 : 422);
  if (!r.url) throw new KybError('Bridge returned no verification link. Try again.', 'upstream', 502);
  await q.query('UPDATE merchant.profiles SET bridge_customer_id = COALESCE($2, bridge_customer_id), kyb_email = $3 WHERE merchant = $1', [input.merchant, r.customerId ?? customerId, email]);
  await audit(q, { merchant: input.merchant, actor: input.staffId, action: 'kyb.started', ref: null, amountCents: null, detail: { domain: email.split('@')[1] ?? '' } });
  return { url: r.url };
}
