import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { bridge } from './billerPayoutService.js';
import { resolveCustomerForEmails } from './bridgeCustomerService.js';
import { plaidTokenStore } from './plaidTokenStore.js';
import { getPlaidClient } from '../routes/plaid.js';

/*
 * Withdraw (cash-out / off-ramp), Model A. The user's Cash = USDC on Base; Withdraw pays it out to a
 * Plaid-linked bank via a Bridge transfer:
 *   1. Resolve the user's Bridge customer (by email).
 *   2. Read the destination bank's account/routing via Plaid Auth (the account the user picked).
 *   3. Register a Bridge external account for it, then create a Bridge transfer:
 *        source = the user's USDC wallet (Bridge pulls), destination = that bank (ACH).
 *
 * Mirrors billerPayoutService (which pays a biller's bank) — here the destination is the user's OWN
 * linked bank. UNVERIFIED against live Bridge + Plaid Auth; needs both creds before real money. When
 * either is unconfigured the caller surfaces a graceful "not available yet" instead of failing hard.
 */

const BRIDGE_USDC_CHAIN = (process.env.BRIDGE_PAYOUT_SOURCE_CHAIN || 'base').trim();

/**
 * Payout rails we expose. Bridge's outbound USD rails are `ach`, `ach_same_day` and `wire` — there is
 * no instant/FedNow payout (FedNow is inbound only), so `ach_same_day` IS our "instant" tier.
 * Standard ACH stays free; the fast rail carries our developer fee.
 */
export type WithdrawRail = 'ach' | 'ach_same_day';

/** Our cut on the fast rail, as a Bridge `developer_fee_percent` string ("1" = 1%). */
const INSTANT_FEE_PERCENT = (process.env.BRIDGE_INSTANT_WITHDRAW_FEE_PERCENT || '1').trim();

export interface WithdrawResult {
  success: boolean;
  providerReference?: string;
  status?: string;
  reason?: string;
  /** True when the rail is not configured yet (Bridge/Plaid creds) — UI shows "coming soon", not an error. */
  notConfigured?: boolean;
}

/** Plaid Auth: account_number + routing_number for a specific linked account the user owns. */
async function resolveBankNumbers(
  wallet: string,
  plaidAccountId: string,
): Promise<{ accountNumber: string; routingNumber: string; ownerName: string } | { error: string }> {
  const client = getPlaidClient();
  if (!client || !plaidTokenStore.isConfigured()) {
    return { error: 'not_configured' };
  }
  const items = await plaidTokenStore.getItems(wallet);
  for (const item of items) {
    let resp;
    try {
      resp = await client.authGet({ access_token: item.access_token });
    } catch {
      continue; // skip an item Plaid can't read or that lacks Auth right now
    }
    const ach = resp.data.numbers?.ach?.find((n) => n.account_id === plaidAccountId);
    if (!ach) continue;
    const acct = resp.data.accounts?.find((a) => a.account_id === plaidAccountId);
    const ownerName = resp.data.accounts?.length ? (acct?.name || 'Account holder') : 'Account holder';
    if (!ach.account || !ach.routing) return { error: 'This bank did not return account/routing numbers.' };
    return { accountNumber: ach.account, routingNumber: ach.routing, ownerName };
  }
  return { error: 'Could not find that linked bank account.' };
}

/** Pay out USDC to the user's linked bank via Bridge: USDC pulled from wallet → ACH to the bank. */
export async function withdrawToBank(input: {
  wallet: string;
  /** Every email on the account — any of them may be the one Bridge knows this member by. */
  emails: string[];
  plaidAccountId: string;
  amountUsd: number;
  rail?: WithdrawRail;
}): Promise<WithdrawResult> {
  const emails = input.emails.filter(Boolean);
  if (emails.length === 0) return { success: false, reason: 'Complete identity verification to withdraw.' };
  if (!input.plaidAccountId) return { success: false, reason: 'Choose a bank to withdraw to.' };
  if (!(input.amountUsd > 0)) return { success: false, reason: 'Amount must be greater than zero.' };

  const rail: WithdrawRail = input.rail === 'ach_same_day' ? 'ach_same_day' : 'ach';
  const customerId = (await resolveCustomerForEmails(emails))?.customerId ?? null;
  if (!customerId) {
    // No Bridge customer (or Bridge unconfigured) → treat as "rail not ready yet".
    return { success: false, notConfigured: true, reason: 'Bank withdrawals are not available yet.' };
  }

  const numbers = await resolveBankNumbers(input.wallet, input.plaidAccountId);
  if ('error' in numbers) {
    if (numbers.error === 'not_configured') {
      return { success: false, notConfigured: true, reason: 'Bank withdrawals are not available yet.' };
    }
    return { success: false, reason: numbers.error };
  }

  // Deterministic idempotency so re-registering the same bank returns the same Bridge external account.
  const extKey = createHash('sha256').update(`${customerId}:${input.plaidAccountId}`).digest('hex');
  const ext = await bridge<{ id?: string }>(`/customers/${encodeURIComponent(customerId)}/external_accounts`, {
    method: 'POST',
    headers: { 'Idempotency-Key': extKey },
    body: JSON.stringify({
      currency: 'usd',
      account_type: 'us',
      account_owner_name: numbers.ownerName,
      account: {
        account_number: numbers.accountNumber,
        routing_number: numbers.routingNumber,
        checking_or_savings: 'checking',
      },
    }),
  });
  if (!ext.ok || !ext.data?.id) {
    return { success: false, reason: ext.message || 'Could not register your bank with Bridge.' };
  }

  const transfer = await bridge<{ id?: string; state?: string }>('/transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      amount: input.amountUsd.toFixed(2),
      on_behalf_of: customerId,
      source: { payment_rail: BRIDGE_USDC_CHAIN, currency: 'usdc', from_address: input.wallet },
      destination: { payment_rail: rail, currency: 'usd', external_account_id: ext.data.id },
      // Standard ACH is free; the same-day rail carries our developer fee. Bridge withholds it and
      // settles it to our fee account monthly — nothing to net out on our side.
      ...(rail === 'ach_same_day' ? { developer_fee_percent: INSTANT_FEE_PERCENT } : {}),
    }),
  });
  if (!transfer.ok || !transfer.data?.id) {
    return { success: false, reason: transfer.message || 'Bridge could not create the withdrawal.' };
  }

  return { success: true, providerReference: transfer.data.id, status: transfer.data.state };
}
