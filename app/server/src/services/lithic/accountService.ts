import type { Address } from 'lithic/resources/shared';
import { requireLithic } from './lithicClient.js';

/*
 * Lithic account provisioning — the member's banking identity and their cash account.
 *
 * The shape of this is not what "create an account, then create a financial account" suggests:
 * creating an ACCOUNT HOLDER creates the Account and its Financial Accounts in one call. You then
 * LIST the financial accounts for that account token and pick the one you want. There is a
 * POST /financial_accounts, but for a program-managed customer the automatic ones are the real
 * accounts.
 *
 * Two types matter to us:
 *  - ISSUING   — what card spending draws from.
 *  - OPERATING — non-card cash movement: payments, book transfers, management operations.
 *
 * "Routable" is not a type. It is a property: `routing_number` and `account_number` come back
 * populated when the program is configured for it, and that is what makes direct deposit possible.
 *
 * Three workflows, shaped differently, and the choice is a compliance one:
 *  - KYC_BASIC — Lithic runs KYC. This is the default here, because Program Managed means Lithic
 *    and its partner bank own KYC/AML; asserting we did it ourselves would contradict the
 *    arrangement we're actually in.
 *  - KYC_BYO — we assert we verified them, via `kyc_passed_timestamp`. Our Bridge flow does verify
 *    members, but claiming that satisfies Lithic's bank sponsor is their sponsor's call to make,
 *    not an inference to encode. Available, never automatic.
 *  - KYC_EXEMPT — flat shape (no `individual` wrapper), needs `kyc_exemption_type`, no dob or
 *    government id. It is for authorized users and prepaid-card users, not for a member who holds
 *    their own funds. Useful for smoke tests.
 */

export type ProvisionWorkflow = 'KYC_EXEMPT' | 'KYC_BASIC' | 'KYC_BYO';

export interface ProvisionMemberInput {
  /** Our member id / auth subject — echoed onto the holder so records can be tied back. */
  externalId: string;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, e.g. "+15555555555". */
  phoneNumber: string;
  address: Address;
  /** Defaults to KYC_BASIC — Lithic runs KYC, which is what Program Managed means. */
  workflow?: ProvisionWorkflow;
  /** YYYY-MM-DD. Required for the KYC workflows. */
  dob?: string;
  /** SSN or ITIN, `000-00-0000`. Required for the KYC workflows. */
  governmentId?: string;
  /** When we verified them ourselves. Required for KYC_BYO. */
  kycPassedTimestamp?: string;
  /** KYC_EXEMPT only. */
  kycExemptionType?: 'AUTHORIZED_USER' | 'PREPAID_CARD_USER';
}

export interface ProvisionedAccount {
  accountHolderToken: string;
  accountToken: string;
  /** ACCEPTED | PENDING_REVIEW | PENDING_DOCUMENT | PENDING_RESUBMIT | REJECTED */
  status: string;
  statusReasons: string[];
}

export interface MemberFinancialAccount {
  token: string;
  type: string;
  nickname: string | null;
  /** Present only when the account is routable. Both or neither. */
  routingNumber: string | null;
  accountNumber: string | null;
  isRoutable: boolean;
}

/**
 * Find an existing account holder by the external id we set — our member's wallet.
 *
 * This is the idempotency mechanism, and it is a lookup rather than a header because Lithic has no
 * idempotency on this endpoint. Verified against sandbox: two creates with the same
 * `idempotencyKey` produced two different account tokens, and the SDK turns out never to send an
 * idempotency header at all. So a create is not safe to retry blind — check first.
 */
export async function findAccountHolderByExternalId(
  externalId: string,
): Promise<ProvisionedAccount | null> {
  const lithic = requireLithic();
  for await (const holder of lithic.accountHolders.list({ external_id: externalId })) {
    const accountToken = (holder as { account_token?: string }).account_token;
    if (!accountToken) continue;
    return {
      accountHolderToken: holder.token,
      accountToken,
      status: String((holder as { status?: string }).status ?? 'UNKNOWN'),
      statusReasons: ((holder as { status_reasons?: string[] }).status_reasons ?? []) as string[],
    };
  }
  return null;
}

/**
 * Create the member's account holder, which brings their Account and Financial Accounts with it.
 *
 * Callers must check `findAccountHolderByExternalId` first — see above. This function creates,
 * every time it is called.
 */
export async function provisionAccountHolder(
  input: ProvisionMemberInput,
): Promise<ProvisionedAccount> {
  const lithic = requireLithic();
  const workflow = input.workflow ?? 'KYC_BASIC';

  const response =
    workflow === 'KYC_EXEMPT'
      ? await lithic.accountHolders.create(
          {
            workflow: 'KYC_EXEMPT',
            kyc_exemption_type: input.kycExemptionType ?? 'PREPAID_CARD_USER',
            first_name: input.firstName,
            last_name: input.lastName,
            email: input.email,
            phone_number: input.phoneNumber,
            address: input.address,
            external_id: input.externalId,
          })
      : await lithic.accountHolders.create(
          {
            workflow,
            tos_timestamp: new Date().toISOString(),
            individual: {
              first_name: input.firstName,
              last_name: input.lastName,
              email: input.email,
              phone_number: input.phoneNumber,
              address: input.address,
              dob: requireField(input.dob, 'dob', workflow),
              government_id: requireField(input.governmentId, 'governmentId', workflow),
            },
            external_id: input.externalId,
            ...(workflow === 'KYC_BYO'
              ? {
                  kyc_passed_timestamp: requireField(
                    input.kycPassedTimestamp,
                    'kycPassedTimestamp',
                    workflow,
                  ),
                }
              : {}),
          });

  return {
    accountHolderToken: response.token,
    accountToken: response.account_token,
    status: response.status,
    statusReasons: response.status_reasons ?? [],
  };
}

function requireField(value: string | undefined, name: string, workflow: string): string {
  if (!value) throw new Error(`Lithic ${workflow} requires ${name}`);
  return value;
}

/** Every financial account Lithic created for this member. */
export async function listFinancialAccounts(
  accountToken: string,
): Promise<MemberFinancialAccount[]> {
  const lithic = requireLithic();
  const accounts: MemberFinancialAccount[] = [];

  for await (const account of lithic.financialAccounts.list({ account_token: accountToken })) {
    const routingNumber = account.routing_number || null;
    const accountNumber = account.account_number || null;
    accounts.push({
      token: account.token,
      type: String(account.type ?? ''),
      nickname: account.nickname ?? null,
      routingNumber,
      accountNumber,
      isRoutable: Boolean(routingNumber && accountNumber),
    });
  }

  return accounts;
}

/**
 * The account direct deposit can actually land in.
 *
 * Returns null rather than falling back to a non-routable account: a routing/account pair we show a
 * member has to be one their employer can pay into, and quietly handing back an
 * internal-transfer-only account surfaces as a failed paycheck weeks later.
 */
export function findRoutable(
  accounts: MemberFinancialAccount[],
  preferredType = 'OPERATING',
): MemberFinancialAccount | null {
  const routable = accounts.filter((a) => a.isRoutable);
  return routable.find((a) => a.type === preferredType) ?? routable[0] ?? null;
}
