import { requireLithic } from './lithicClient.js';
import { lithicStore } from './lithicStore.js';

/*
 * Linking a member's outside bank — spec step 6, and the prerequisite for pulling from it.
 *
 * Every creation shape requires `financial_account_token`, which is the member's Lithic cash
 * account. An external account is not a free-floating record; it is attached to the account that
 * will debit it. That is also why this cannot be exercised until the program has Financial
 * Accounts — verified in sandbox: the create rejects with
 * `body.financial_account_token field required`.
 *
 * Verification methods, and why the default is what it is:
 *   MICRO_DEPOSIT  two small deposits the member reads back. Slow — a day or two — but it needs
 *                  nothing from the member except access to their own statement, and it proves
 *                  ownership rather than merely knowledge of the numbers.
 *   PLAID          instant, and we already run Plaid here. Better UX, but it verifies through a
 *                  third party the member has to trust with bank credentials.
 *   PRENOTE        a zero-dollar ACH that proves the account exists, not that it is theirs.
 *   MANUAL /
 *   EXTERNALLY_VERIFIED   we assert it. Same category of claim as KYC_BYO, and the same answer:
 *                  available, never the default.
 *
 * Micro-deposit is the default because it is the one that proves ownership without asking anyone to
 * hand over credentials.
 */

export type LinkVerification = 'MICRO_DEPOSIT' | 'PLAID' | 'PRENOTE';

export interface LinkBankInput {
  wallet: string;
  accountNumber: string;
  routingNumber: string;
  accountType: 'CHECKING' | 'SAVINGS';
  /** Name on the account, as the bank has it. */
  owner: string;
  ownerType: 'INDIVIDUAL' | 'BUSINESS';
  verification?: LinkVerification;
  /** The member's own label — "Chase ••4021". */
  nickname?: string;
}

export interface LinkedBankAccount {
  token: string;
  state: string;
  verificationMethod: string;
  verificationState: string;
  last4: string;
  routingNumber: string;
  nickname: string | null;
  type: string;
}

function toLinked(account: Record<string, unknown>): LinkedBankAccount {
  return {
    token: String(account.token ?? ''),
    state: String(account.state ?? ''),
    verificationMethod: String(account.verification_method ?? ''),
    verificationState: String(account.verification_state ?? ''),
    last4: String(account.last_four ?? ''),
    routingNumber: String(account.routing_number ?? ''),
    nickname: (account.name as string | undefined) ?? null,
    type: String(account.type ?? ''),
  };
}

/**
 * Link an outside bank account to the member's Lithic cash account.
 *
 * Fails loudly when the member has no cash account rather than passing an empty token: the API
 * error for that is generic, and "you have no cash account yet" is the useful thing to know.
 */
export async function linkBankAccount(input: LinkBankInput): Promise<LinkedBankAccount> {
  const lithic = requireLithic();
  const record = await lithicStore.get(input.wallet);
  if (!record?.cashFinancialAccountToken) {
    throw new Error('Member has no Lithic cash account — provision one before linking a bank');
  }

  const account = await lithic.externalBankAccounts.create({
    financial_account_token: record.cashFinancialAccountToken,
    account_token: record.accountToken,
    account_number: input.accountNumber,
    routing_number: input.routingNumber,
    type: input.accountType,
    owner: input.owner,
    owner_type: input.ownerType,
    country: 'USA',
    currency: 'USD',
    verification_method: input.verification ?? 'MICRO_DEPOSIT',
    ...(input.nickname ? { name: input.nickname } : {}),
  } as Parameters<typeof lithic.externalBankAccounts.create>[0]);

  return toLinked(account as unknown as Record<string, unknown>);
}

/** Every outside account this member has linked. */
export async function listBankAccounts(wallet: string): Promise<LinkedBankAccount[]> {
  const lithic = requireLithic();
  const record = await lithicStore.get(wallet);
  if (!record) return [];

  const accounts: LinkedBankAccount[] = [];
  for await (const account of lithic.externalBankAccounts.list({
    account_token: record.accountToken,
  })) {
    accounts.push(toLinked(account as unknown as Record<string, unknown>));
  }
  return accounts;
}

/**
 * Confirm the two micro-deposit amounts the member read off their statement.
 *
 * Lithic counts attempts and locks the account after too many, which is the point of the mechanism
 * — so the error is passed through rather than retried, and the caller shows it.
 */
export async function verifyMicroDeposits(
  token: string,
  amountsCents: number[],
): Promise<LinkedBankAccount> {
  const lithic = requireLithic();
  const account = await lithic.externalBankAccounts.retryMicroDeposits(token, {
    micro_deposits: amountsCents,
  } as Parameters<typeof lithic.externalBankAccounts.retryMicroDeposits>[1]);
  return toLinked(account as unknown as Record<string, unknown>);
}

/** An account that can actually be debited. Anything else is still proving itself. */
export function isUsable(account: LinkedBankAccount): boolean {
  return account.state === 'ENABLED' && account.verificationState === 'VERIFIED';
}
