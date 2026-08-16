import { isConfigured } from './lithicClient.js';
import {
  findAccountHolderByExternalId,
  findRoutable,
  listFinancialAccounts,
  provisionAccountHolder,
  type ProvisionMemberInput,
} from './accountService.js';
import { lithicStore, type LithicAccountRecord } from './lithicStore.js';

/*
 * Provisioning a member's banking identity — spec step 2.
 *
 * Deliberately NOT automatic on signup, and that is a finding rather than a shortcut: Lithic's KYC
 * workflows need date of birth, a government id and a street address, and the member record holds
 * none of them (member_profile_private is legal name, email, phone and city). Bridge collects that
 * PII through its own hosted flow, so it lives at Bridge, not here. Provisioning therefore takes the
 * KYC fields as an explicit argument and happens when we actually have them — silently deriving a
 * banking identity from data we don't hold is how you end up submitting a wrong SSN to a bank.
 *
 * Idempotency is ours to enforce, because Lithic gives us nothing here: verified in sandbox, two
 * creates with the same idempotency key produce two different account holders, and the SDK never
 * sends an idempotency header at all. So provisioning checks twice — our own store first, then
 * Lithic by the external id we stamp on every holder. The second check is what saves a member whose
 * account was created and whose database write then failed; without it they would get a second
 * banking identity on retry, and there is no way to merge two of those after the fact.
 */

export type ProvisionStatus =
  | 'provisioned'
  | 'already_provisioned'
  | 'refreshed'
  | 'not_configured';

export interface ProvisionResult {
  status: ProvisionStatus;
  record: LithicAccountRecord | null;
  /**
   * True when Lithic accepted the member but the program exposes no Financial Accounts, so there is
   * no cash account yet. Cards work; direct deposit and ACH do not.
   */
  awaitingFinancialAccounts: boolean;
}

export type ProvisionKycInput = Omit<ProvisionMemberInput, 'externalId'>;

/**
 * Read the financial accounts Lithic created and persist the two we care about.
 *
 * Tolerates the program not having them at all — that call 400s on a card-only program, which is a
 * configuration state rather than an error, so it resolves to "no accounts yet" and the record keeps
 * its null tokens until a later refresh finds them.
 */
async function attachFinancialAccounts(
  wallet: string,
  accountHolderToken: string,
  accountToken: string,
  status: string,
  statusReasons: string[],
): Promise<ProvisionResult> {
  let issuing: string | null = null;
  let cash: string | null = null;

  try {
    const accounts = await listFinancialAccounts(accountToken);
    issuing = accounts.find((a) => a.type === 'ISSUING')?.token ?? null;
    cash = findRoutable(accounts)?.token ?? null;
  } catch {
    // Program has no Financial Accounts product enabled. Nothing to attach yet.
  }

  const record = await lithicStore.upsert(wallet, {
    accountHolderToken,
    accountToken,
    issuingFinancialAccountToken: issuing,
    cashFinancialAccountToken: cash,
    status,
    statusReasons,
  });

  return {
    status: 'provisioned',
    record,
    awaitingFinancialAccounts: !cash,
  };
}

/**
 * Ensure this member has a Lithic account holder, account and financial accounts.
 *
 * `kyc` is only consulted when there is nothing to return — an already-provisioned member is never
 * re-submitted to KYC.
 */
export async function ensureProvisioned(
  wallet: string,
  kyc: ProvisionKycInput,
): Promise<ProvisionResult> {
  if (!isConfigured() || !lithicStore.isConfigured()) {
    return { status: 'not_configured', record: null, awaitingFinancialAccounts: false };
  }

  const existing = await lithicStore.get(wallet);
  if (existing) {
    // Already banked. If the cash account was missing last time — because the program hadn't been
    // configured yet — look again, since that is exactly what changes underneath us.
    if (!existing.cashFinancialAccountToken) {
      const refreshed = await attachFinancialAccounts(
        wallet,
        existing.accountHolderToken,
        existing.accountToken,
        existing.status,
        existing.statusReasons,
      );
      return { ...refreshed, status: 'refreshed' };
    }
    return { status: 'already_provisioned', record: existing, awaitingFinancialAccounts: false };
  }

  const externalId = wallet.toLowerCase();

  // Adopt an orphan before creating: an account holder can exist at Lithic with no row here if a
  // previous attempt died between the API call and the write.
  const orphan = await findAccountHolderByExternalId(externalId);
  const holder = orphan ?? (await provisionAccountHolder({ ...kyc, externalId }));

  return attachFinancialAccounts(
    wallet,
    holder.accountHolderToken,
    holder.accountToken,
    holder.status,
    holder.statusReasons,
  );
}

export interface DepositInstructions {
  routingNumber: string;
  accountNumber: string;
  accountType: string;
}

/**
 * The numbers a member gives their employer.
 *
 * Read from Lithic on demand rather than stored: these are bank details, and the fewer places they
 * sit at rest the better. Returns null when there is no routable account, which the caller must
 * render as "not ready yet" rather than an empty field pair.
 */
export async function getDepositInstructions(
  wallet: string,
): Promise<DepositInstructions | null> {
  const record = await lithicStore.get(wallet);
  if (!record) return null;

  try {
    const accounts = await listFinancialAccounts(record.accountToken);
    const routable = findRoutable(accounts);
    if (!routable?.routingNumber || !routable.accountNumber) return null;
    return {
      routingNumber: routable.routingNumber,
      accountNumber: routable.accountNumber,
      accountType: routable.type || 'CHECKING',
    };
  } catch {
    return null;
  }
}
