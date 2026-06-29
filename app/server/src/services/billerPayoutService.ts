import { randomUUID } from 'crypto';
import { payLedgerStore } from './payLedgerStore.js';

/*
 * Biller payout via Bridge (Phase 1: USDC funding source). Flow:
 *   1. Resolve the user's Bridge customer (by email).
 *   2. Ensure the biller has a Bridge external account (created from its account/routing, cached).
 *   3. Create a Bridge transfer: source = the user's USDC, destination = the biller's bank (ACH).
 *      Bridge returns deposit instructions (where to send the USDC); the gasless relayer funds it.
 *
 * UNVERIFIED against live Bridge — request shapes follow Bridge's v0 docs and must be confirmed on a
 * sandbox before real money. The bank (Plaid) funding leg is a separate phase (2-hop via treasury).
 */

const BRIDGE_USDC_CHAIN = (process.env.BRIDGE_PAYOUT_SOURCE_CHAIN || 'base').trim(); // Bridge payment_rail for USDC

function bridgeBaseUrl(): string {
  const raw = (process.env.BRIDGE_API_BASE_URL || 'https://api.bridge.xyz/v0').trim().replace(/\/+$/, '');
  return raw.endsWith('/v0') ? raw : `${raw}/v0`;
}

function bridgeApiKey(): string {
  return (process.env.BRIDGE_API_KEY || '').trim();
}

interface BridgeResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
}

async function bridge<T>(path: string, init: RequestInit = {}): Promise<BridgeResult<T>> {
  const key = bridgeApiKey();
  if (!key) return { ok: false, status: 503, message: 'Bridge is not configured (BRIDGE_API_KEY).' };
  try {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    headers.set('Api-Key', key);
    if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(`${bridgeBaseUrl()}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message =
        (body && typeof body === 'object' && (body.message || body.error)) || `Bridge request failed (${res.status})`;
      return { ok: false, status: res.status, message: String(message) };
    }
    return { ok: true, status: res.status, data: body as T };
  } catch (error) {
    return { ok: false, status: 502, message: error instanceof Error ? error.message : 'Bridge request failed' };
  }
}

async function resolveCustomerId(email: string): Promise<string | null> {
  const r = await bridge<{ data?: { customer_id?: string }[] }>(
    `/kyc_links?email=${encodeURIComponent(email)}&limit=1`,
  );
  return (r.ok && r.data?.data?.[0]?.customer_id) || null;
}

/** Ensure the biller has a Bridge external account; create + cache one from its stored details. */
async function ensureExternalAccount(
  wallet: string,
  billerId: string,
  customerId: string,
): Promise<{ externalAccountId: string } | { error: string }> {
  const secret = await payLedgerStore.getBillerPayoutSecret(wallet, billerId);
  if (!secret) return { error: 'This biller has no payout details on file.' };
  if (secret.bridgeExternalAccountId) return { externalAccountId: secret.bridgeExternalAccountId };

  const created = await bridge<{ id?: string }>(`/customers/${encodeURIComponent(customerId)}/external_accounts`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      currency: 'usd',
      account_type: 'us',
      account_owner_name: secret.bankName || 'Biller',
      account: { account_number: secret.accountNumber, routing_number: secret.routingNumber },
    }),
  });
  if (!created.ok || !created.data?.id) {
    return { error: created.message || 'Could not register the biller bank account with Bridge.' };
  }
  await payLedgerStore.setBillerBridgeExternalAccount(wallet, billerId, created.data.id);
  return { externalAccountId: created.data.id };
}

export interface BillerPayoutResult {
  success: boolean;
  providerReference?: string;
  /** Where the user's USDC must be sent for Bridge to offramp to the biller (gasless relayer funds this). */
  sourceDepositInstructions?: unknown;
  status?: string;
  reason?: string;
}

/** Initiate a USDC→biller ACH payout via Bridge. Returns deposit instructions to fund the transfer. */
export async function payBillerViaUsdc(input: {
  wallet: string;
  email: string;
  billerId: string;
  amountUsd: number;
}): Promise<BillerPayoutResult> {
  if (!input.email) return { success: false, reason: 'Complete identity verification to pay bills.' };
  if (!(input.amountUsd > 0)) return { success: false, reason: 'Amount must be greater than zero.' };

  const customerId = await resolveCustomerId(input.email);
  if (!customerId) return { success: false, reason: 'No verified Bridge customer for this account yet.' };

  const ext = await ensureExternalAccount(input.wallet, input.billerId, customerId);
  if ('error' in ext) return { success: false, reason: ext.error };

  const amount = input.amountUsd.toFixed(2);
  const transfer = await bridge<{ id?: string; state?: string; source_deposit_instructions?: unknown }>('/transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      amount,
      on_behalf_of: customerId,
      source: { payment_rail: BRIDGE_USDC_CHAIN, currency: 'usdc' },
      destination: { payment_rail: 'ach', currency: 'usd', external_account_id: ext.externalAccountId },
    }),
  });
  if (!transfer.ok || !transfer.data?.id) {
    return { success: false, reason: transfer.message || 'Bridge could not create the payout transfer.' };
  }

  return {
    success: true,
    providerReference: transfer.data.id,
    status: transfer.data.state,
    sourceDepositInstructions: transfer.data.source_deposit_instructions,
  };
}
