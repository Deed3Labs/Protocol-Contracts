import { INTEGRATIONS_LIVE, apiGet, apiPost } from './client';

/*
 * Plaid link → Bridge external accounts.
 * Docs: https://apidocs.bridge.xyz/platform/orchestration/external-accounts/plaid
 * Flow: createLinkToken → open Plaid Link SDK (gets a public_token) → exchangePublicToken →
 * poll listExternalAccounts (Bridge creates them async). Requires a Bridge customer.
 * NOTE: Plaid is linking-only; money movement runs through Bridge transfers, not a Plaid debit.
 */

export interface ExternalAccountDTO {
  id: string;
  name: string; // institution
  mask: string; // last 4
  type: string; // Checking / Savings
}

export async function createLinkToken(customerId: string): Promise<{ linkToken: string }> {
  if (INTEGRATIONS_LIVE) return apiPost(`/bridge/customers/${customerId}/plaid_link_token`, {});
  return { linkToken: `link-mock-${Date.now().toString(36)}` };
}

export async function exchangePublicToken(linkToken: string, publicToken: string): Promise<{ ok: boolean }> {
  if (INTEGRATIONS_LIVE) return apiPost(`/bridge/plaid/exchange`, { linkToken, publicToken });
  return { ok: true };
}

export async function listExternalAccounts(customerId: string): Promise<ExternalAccountDTO[]> {
  if (INTEGRATIONS_LIVE) return apiGet<ExternalAccountDTO[]>(`/bridge/customers/${customerId}/external_accounts`);
  return [];
}
