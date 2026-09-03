import { getPlaidClient } from '../routes/plaid.js';
import { plaidTokenStore } from './plaidTokenStore.js';

/*
 * The account holder, as the bank knows them.
 *
 * Two callers want the same thing for different reasons, and they were solving it separately and
 * one of them wrongly:
 *
 *  - A withdrawal has to tell Bridge whose account it is paying. It was sending `account.name`,
 *    which is Plaid's word for the account's NICKNAME — "TOTAL CHECKING", "Plaid Saving". A product
 *    label where a person's legal name belongs.
 *  - The verification screen shows name and address rather than asking for them, which is what
 *    makes it two fields instead of six.
 *
 * `Identity` is requested as an OPTIONAL Plaid product, so this legitimately returns null: an
 * institution that does not support it still links, and both callers have somewhere honest to go —
 * the withdrawal falls back, the screen asks.
 */

export interface PlaidAccountHolder {
  /** The bank's spelling of the member's legal name. */
  legalName: string | null;
  address: {
    address1: string | null;
    city: string | null;
    /** Plaid calls it `region`; Lithic and Bridge both call it `state`. */
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
}

const EMPTY: PlaidAccountHolder = { legalName: null, address: null };

/**
 * Read the holder of one linked account.
 *
 * `plaidAccountId` is optional: withdrawals care about a specific account, while the verification
 * screen only wants "who is this member", and any linked account answers that equally well.
 */
export async function getAccountHolder(
  wallet: string,
  plaidAccountId?: string,
): Promise<PlaidAccountHolder> {
  const client = getPlaidClient();
  if (!client || !plaidTokenStore.isConfigured()) return EMPTY;

  const items = await plaidTokenStore.getItems(wallet);
  for (const item of items) {
    let resp;
    try {
      resp = await client.identityGet({ access_token: item.access_token });
    } catch {
      // Institution without Identity, or a product not yet initialised on this item. Not an error
      // worth surfacing — it is the documented reason this returns null.
      continue;
    }
    const accounts = resp.data.accounts ?? [];
    const account = plaidAccountId
      ? accounts.find((a: { account_id: string }) => a.account_id === plaidAccountId)
      : accounts.find((a: { owners?: unknown[] }) => (a.owners?.length ?? 0) > 0);
    const owner = account?.owners?.[0];
    if (!owner) continue;

    // Banks return several names on a joint account. The first is the primary holder, which is who
    // an ACH credit is going to and who is signing up.
    const legalName = owner.names?.[0]?.trim() || null;
    // `primary` marks the mailing address; without the flag the first is the best available guess.
    const chosen = owner.addresses?.find((a: { primary?: boolean | null }) => Boolean(a.primary)) ?? owner.addresses?.[0];
    const data = chosen?.data;
    const address = data
      ? {
          address1: data.street?.trim() || null,
          city: data.city?.trim() || null,
          state: data.region?.trim() || null,
          postalCode: data.postal_code?.trim() || null,
          country: data.country?.trim() || null,
        }
      : null;

    if (legalName || address) return { legalName, address };
  }
  return EMPTY;
}
