/**
 * The shop's ledger accounts (card-processing prompt, Phase 2). The same list is enforced by a
 * CHECK in migrations/0004_ledger.sql, so an account code the database doesn't know can't be opened.
 */

export type AccountType = 'asset' | 'liability' | 'income' | 'expense';
export type Normal = 'debit' | 'credit';

export const ACCOUNTS = {
  drawer_cash: { type: 'asset', normal: 'debit' },
  cash_in_transit_to_bank: { type: 'asset', normal: 'debit' },
  bank: { type: 'asset', normal: 'debit' },
  card_receivable: { type: 'asset', normal: 'debit' },
  clear_receivable: { type: 'asset', normal: 'debit' },
  // The shop's USDC account (its organization wallet). Only what the books move through it is here
  // so far: Clear's monthly fee bill, collected from it.
  cash_account: { type: 'asset', normal: 'debit' },
  sales: { type: 'income', normal: 'credit' },
  tax_payable: { type: 'liability', normal: 'credit' },
  // Clear's card fee on sales whose processor couldn't take it, until the month's bill is collected.
  clear_fees_payable: { type: 'liability', normal: 'credit' },
  // Contra-revenue: income accounts that a debit increases.
  discounts: { type: 'income', normal: 'debit' },
  refunds: { type: 'income', normal: 'debit' },
  cash_over_short: { type: 'expense', normal: 'debit' },
  card_processing_expense: { type: 'expense', normal: 'debit' },
} as const satisfies Record<string, { type: AccountType; normal: Normal }>;

export type FixedAccount = keyof typeof ACCOUNTS;
/** One tips account per person, so what the shop owes each of them is a balance, not a report. */
export type TipsAccount = `tips_payable:${string}`;
export type AccountCode = FixedAccount | TipsAccount;

export const tipsPayable = (staffId: string): TipsAccount => {
  if (!staffId) throw new Error('A tips account belongs to someone');
  return `tips_payable:${staffId}`;
};

export interface AccountDef {
  code: AccountCode;
  type: AccountType;
  normal: Normal;
  staffId: string | null;
}

export function accountDef(code: string): AccountDef {
  if (code.startsWith('tips_payable:')) {
    const staffId = code.slice('tips_payable:'.length);
    if (!staffId) throw new Error(`Unknown ledger account: ${code}`);
    return { code: code as TipsAccount, type: 'liability', normal: 'credit', staffId };
  }
  const fixed = ACCOUNTS[code as FixedAccount];
  if (!fixed) throw new Error(`Unknown ledger account: ${code}`);
  return { code: code as FixedAccount, ...fixed, staffId: null };
}
