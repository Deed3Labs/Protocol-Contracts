import { randomUUID } from 'crypto';
import { bridge } from './billerPayoutService.js';

/*
 * Bridge customer + KYC + virtual account, resolved across EVERY email on a Clear account.
 *
 * A member can sign in with email, Google, or Apple — and may already be a Bridge customer under any
 * of those addresses (they onboarded through another Bridge-powered app, or signed up here with a
 * different login). So before creating anything we probe each verified email and reuse the first
 * customer we find; only if none matches do we onboard them as new.
 *
 * Shapes follow Bridge v0 (apidocs.bridge.xyz). Notes that bit us / worth remembering:
 *  - `GET /customers?email=` is the real lookup. `/kyc_links?email=` only finds customers that were
 *    created THROUGH a KYC link, so it's a fallback, not the primary.
 *  - customer.status uses `active`; kyc_links.kyc_status uses `approved`. Different enums, same idea.
 *  - `Idempotency-Key` is REQUIRED on virtual-account + external-account creates.
 *  - Fiat on-ramp is PUSH-ONLY. Bridge does not debit bank accounts (no ACH pull, no Plaid debit),
 *    so a virtual account is the only inbound fiat rail: the member pushes to it.
 */

/** Chain Bridge should deliver USDC on — matches the payout source chain used elsewhere. */
const BRIDGE_CHAIN = (process.env.BRIDGE_PAYOUT_SOURCE_CHAIN || 'base').trim();

/*
 * Deposits are FREE by design — we take nothing on the way in; the revenue is the off-ramp fee.
 * Bridge treats a blank fee field as 0.0 ("Fees are optional. Leaving the developer_fee or
 * developer_fee_percent field blank is treated as a fee of 0.0"), so we simply set nothing.
 *
 * If inbound ever needs a fee: a flat rate across every rail is `developer_fee_percent` on the
 * virtual account. Charging only the instant rails (fednow/wire) while `ach_push` stays free needs
 * `fee_config.source` — `{ default: {...}, fednow: {...} }` — which is virtual-accounts-only,
 * available from Bridge by request, and mutually exclusive with `developer_fee_percent`.
 */

export type BridgeCustomerStatus =
  | 'active'
  | 'awaiting_questionnaire'
  | 'awaiting_ubo'
  | 'incomplete'
  | 'not_started'
  | 'offboarded'
  | 'paused'
  | 'rejected'
  | 'under_review';

export type CapabilityStatus = 'pending' | 'active' | 'inactive' | 'rejected';

interface BridgeCustomer {
  id?: string;
  status?: BridgeCustomerStatus;
  has_accepted_terms_of_service?: boolean;
  capabilities?: Partial<Record<'payin_crypto' | 'payout_crypto' | 'payin_fiat' | 'payout_fiat', CapabilityStatus>>;
  endorsements?: { name?: string; status?: string }[];
  rejection_reasons?: { reason?: string; developer_reason?: string }[];
}

export interface ResolvedBridgeCustomer {
  customerId: string;
  /** Which of the account's emails matched — the one Bridge knows them by. */
  email: string;
}

export interface CustomerSnapshot {
  customerId: string;
  status: BridgeCustomerStatus;
  tosAccepted: boolean;
  /** `base` endorsement — USD payments (ACH + wire + virtual accounts). */
  baseEndorsement: 'incomplete' | 'approved' | 'revoked';
  payinFiat: CapabilityStatus;
  payoutFiat: CapabilityStatus;
  rejectionReason: string | null;
}

export interface VirtualAccountDetails {
  id: string;
  status: string;
  bankName: string | null;
  accountNumber: string | null;
  routingNumber: string | null;
  beneficiary: string | null;
  /** Inbound rails this account accepts, e.g. ["ach_push","wire"] (fednow when enabled). */
  paymentRails: string[];
}

const normalizeEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** First Bridge customer found across the account's emails, or null if none of them are known. */
export async function resolveCustomerForEmails(emails: string[]): Promise<ResolvedBridgeCustomer | null> {
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    // Primary: the customers index. A miss (or a Bridge hiccup) on one email shouldn't stop the loop.
    const byCustomer = await bridge<{ data?: BridgeCustomer[] }>(
      `/customers?email=${encodeURIComponent(email)}&limit=1`,
    );
    // A rejected API key looks identical to "this member isn't a Bridge customer" from here, which
    // is how a bad BRIDGE_API_KEY masqueraded as a brand-new user. Call it out in the logs.
    if (!byCustomer.ok && (byCustomer.status === 401 || byCustomer.status === 403)) {
      console.error('[bridge] API key rejected (%d) — check BRIDGE_API_KEY and BRIDGE_API_BASE_URL: %s', byCustomer.status, byCustomer.message);
    }
    const customerId = byCustomer.ok ? byCustomer.data?.data?.[0]?.id : undefined;
    if (customerId) return { customerId, email };

    // Fallback: customers created through a hosted KYC link.
    const byKycLink = await bridge<{ data?: { customer_id?: string }[] }>(
      `/kyc_links?email=${encodeURIComponent(email)}&limit=1`,
    );
    const linkCustomerId = byKycLink.ok ? byKycLink.data?.data?.[0]?.customer_id : undefined;
    if (linkCustomerId) return { customerId: linkCustomerId, email };
  }
  return null;
}

/** Read a customer's verification state — what the money-movement gate keys off. */
export async function getCustomerSnapshot(customerId: string): Promise<CustomerSnapshot | null> {
  const result = await bridge<BridgeCustomer>(`/customers/${encodeURIComponent(customerId)}`);
  if (!result.ok || !result.data) return null;
  const c = result.data;
  const base = c.endorsements?.find((e) => e.name === 'base')?.status;
  return {
    customerId,
    status: c.status ?? 'not_started',
    tosAccepted: Boolean(c.has_accepted_terms_of_service),
    baseEndorsement: base === 'approved' || base === 'revoked' ? base : 'incomplete',
    payinFiat: c.capabilities?.payin_fiat ?? 'pending',
    payoutFiat: c.capabilities?.payout_fiat ?? 'pending',
    rejectionReason: c.rejection_reasons?.[0]?.reason ?? null,
  };
}

export interface KycLinkResult {
  customerId: string | null;
  /** Where to send the user next — ToS first when unsigned, else the KYC flow. */
  url: string | null;
  kycUrl: string | null;
  tosUrl: string | null;
  source: 'existing_customer' | 'new_customer';
}

/**
 * Get the hosted Bridge verification link for this member, reusing their existing customer when one
 * of their emails already maps to one. `email` is the address to onboard under when they're new.
 */
export async function startKyc(input: {
  emails: string[];
  email: string;
  fullName: string;
  redirectUri?: string;
  customerType?: 'individual' | 'business';
}): Promise<KycLinkResult | { error: string; status: number }> {
  const existing = await resolveCustomerForEmails(input.emails);

  if (existing) {
    const redirectQuery = input.redirectUri ? `?redirect_uri=${encodeURIComponent(input.redirectUri)}` : '';
    const [tos, kyc] = await Promise.all([
      bridge<{ url?: string | null }>(`/customers/${encodeURIComponent(existing.customerId)}/tos_acceptance_link`),
      bridge<{ url?: string | null }>(`/customers/${encodeURIComponent(existing.customerId)}/kyc_link${redirectQuery}`),
    ]);
    const tosUrl = (tos.ok && tos.data?.url) || null;
    const kycUrl = (kyc.ok && kyc.data?.url) || null;
    const snapshot = await getCustomerSnapshot(existing.customerId);
    // Signed the ToS already → straight to KYC; otherwise ToS has to come first.
    const url = snapshot?.tosAccepted ? kycUrl || tosUrl : tosUrl || kycUrl;
    if (url) {
      return { customerId: existing.customerId, url, kycUrl, tosUrl, source: 'existing_customer' };
    }
    // Fall through to creating a link if Bridge gave us nothing usable.
  }

  const created = await bridge<{ customer_id?: string; kyc_link?: string; tos_link?: string }>('/kyc_links', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      full_name: input.fullName,
      email: normalizeEmail(input.email),
      type: input.customerType === 'business' ? 'business' : 'individual',
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    }),
  });
  if (!created.ok || !created.data) {
    return { error: created.message || 'Could not start verification.', status: created.status || 502 };
  }
  const tosUrl = created.data.tos_link ?? null;
  const kycUrl = created.data.kyc_link ?? null;
  return {
    customerId: created.data.customer_id ?? null,
    url: tosUrl || kycUrl,
    kycUrl,
    tosUrl,
    source: 'new_customer',
  };
}

type BridgeVirtualAccount = {
  id?: string;
  status?: string;
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

function toDetails(va: BridgeVirtualAccount): VirtualAccountDetails | null {
  const di = va.source_deposit_instructions;
  const accountNumber = di?.bank_account_number || di?.account_number || null;
  const routingNumber = di?.bank_routing_number || di?.routing_number || null;
  if (!va.id || !accountNumber || !routingNumber) return null;
  return {
    id: va.id,
    status: va.status ?? 'activated',
    bankName: di?.bank_name ?? null,
    accountNumber,
    routingNumber,
    beneficiary: di?.bank_beneficiary_name ?? null,
    paymentRails: di?.payment_rails ?? [],
  };
}

/**
 * The member's USD virtual account, creating one if they don't have it yet. This is what produces
 * their account + routing numbers: USD pushed to it is auto-converted to USDC on Base at `wallet`.
 * Returns a reason instead of throwing so the UI can explain itself.
 */
export async function ensureVirtualAccount(input: {
  customerId: string;
  walletAddress: string;
}): Promise<{ account: VirtualAccountDetails } | { error: string; reason: string }> {
  const listed = await bridge<{ data?: BridgeVirtualAccount[] }>(
    `/customers/${encodeURIComponent(input.customerId)}/virtual_accounts`,
  );
  if (listed.ok) {
    for (const va of listed.data?.data ?? []) {
      if (va.status && va.status !== 'activated') continue;
      const details = toDetails(va);
      if (details) return { account: details };
    }
  }

  // None yet — Bridge requires the customer to be KYC-approved before it will open one.
  const created = await bridge<BridgeVirtualAccount>(
    `/customers/${encodeURIComponent(input.customerId)}/virtual_accounts`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `va-${input.customerId}-${BRIDGE_CHAIN}` },
      body: JSON.stringify({
        source: { currency: 'usd' },
        destination: { currency: 'usdc', payment_rail: BRIDGE_CHAIN, address: input.walletAddress },
      }),
    },
  );
  if (!created.ok || !created.data) {
    return { error: created.message || 'Could not open your USD account.', reason: 'create_failed' };
  }
  const details = toDetails(created.data);
  if (!details) return { error: 'Bridge did not return deposit instructions.', reason: 'no_instructions' };
  return { account: details };
}
