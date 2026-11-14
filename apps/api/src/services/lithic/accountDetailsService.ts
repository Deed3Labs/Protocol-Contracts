import { requireLithic } from './lithicClient.js';
import { lithicStore } from './lithicStore.js';

/*
 * Spendable account details: what a member hands an employer or another bank to pay into Clear.
 *
 * Read from Lithic at request time, every time. Nothing here is stored, cached or logged: the
 * financial account comes from Lithic's account details endpoint (GET /financial_accounts/{token})
 * and the holder's name from the account holder Lithic verified.
 *
 * Two reads, deliberately apart:
 *  - `readMaskedAccountDetails` never lets the full account number out of this module. It returns
 *    the last four, and the route that serves it has no step-up.
 *  - `readFullAccountNumber` returns the full number, and its route sits behind step-up
 *    (middleware/stepUp). It returns only the number, so a caller cannot reach it by accident while
 *    asking for the rest.
 *
 * What Lithic does not give us:
 *  - The partner bank's name. Neither the financial account nor the account holder carries it, and
 *    Lithic places accounts across several partner banks, so the row reads "Lithic partner bank"
 *    (owner's decision). LITHIC_PARTNER_BANK_NAME overrides it if one bank is ever named.
 *  - "Checking". Lithic's `type` is a ledger type (OPERATING, ISSUING), not the ACH account type an
 *    employer's form asks for. The owner's spec says a Clear deposit account is a checking account,
 *    so that is what is shown; it is a product fact, not something read from Lithic.
 */

/** What an employer's direct deposit form calls this account. Product spec, not a Lithic field. */
export const DEPOSIT_ACCOUNT_TYPE = 'Checking';

/** Shown for the bank: Lithic's API does not name it, and Lithic uses several partner banks. */
export const DEFAULT_PARTNER_BANK = 'Lithic partner bank';

/** The bank row: LITHIC_PARTNER_BANK_NAME if set, otherwise "Lithic partner bank". */
export function partnerBankName(): string {
  const name = (process.env.LITHIC_PARTNER_BANK_NAME || '').trim();
  return name || DEFAULT_PARTNER_BANK;
}

export interface MaskedAccountDetails {
  /** The name Lithic verified the account holder under. Null when Lithic has no individual on file. */
  holderName: string | null;
  /** LITHIC_PARTNER_BANK_NAME, or "Lithic partner bank". */
  bankName: string;
  routingNumber: string;
  accountNumberLast4: string;
  accountType: string;
}

interface RoutableAccount {
  routingNumber: string;
  accountNumber: string;
  accountHolderToken: string;
}

/**
 * The member's routable cash account, straight from Lithic. Null when they have none yet: not
 * provisioned, no cash financial account on the program, or one without numbers.
 */
async function readRoutable(wallet: string): Promise<RoutableAccount | null> {
  const record = await lithicStore.get(wallet);
  if (!record?.cashFinancialAccountToken) return null;
  const account = await requireLithic().financialAccounts.retrieve(record.cashFinancialAccountToken);
  const routingNumber = account.routing_number || '';
  const accountNumber = account.account_number || '';
  if (!routingNumber || !accountNumber) return null;
  return { routingNumber, accountNumber, accountHolderToken: record.accountHolderToken };
}

/** The holder's legal name as Lithic verified it. A failed read is a missing name, not a failed page. */
async function readHolderName(accountHolderToken: string): Promise<string | null> {
  try {
    const holder = await requireLithic().accountHolders.retrieve(accountHolderToken);
    const first = holder.individual?.first_name?.trim() ?? '';
    const last = holder.individual?.last_name?.trim() ?? '';
    const name = `${first} ${last}`.trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Everything the details surface shows, with the account number cut to its last four. */
export async function readMaskedAccountDetails(wallet: string): Promise<MaskedAccountDetails | null> {
  const routable = await readRoutable(wallet);
  if (!routable) return null;
  const holderName = await readHolderName(routable.accountHolderToken);
  return {
    holderName,
    bankName: partnerBankName(),
    routingNumber: routable.routingNumber,
    accountNumberLast4: routable.accountNumber.slice(-4),
    accountType: DEPOSIT_ACCOUNT_TYPE,
  };
}

/** The full account number, for the route behind step-up only. */
export async function readFullAccountNumber(wallet: string): Promise<string | null> {
  const routable = await readRoutable(wallet);
  return routable?.accountNumber ?? null;
}
