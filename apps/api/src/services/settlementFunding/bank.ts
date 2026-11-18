import { centsToUnits } from './desk.js';

/*
 * The bank side of Settlement Funding (decision 54): the Credit Settlement Account (CSA), the
 * Collection Account and the Savings-Backed Margin, and the two ways the desk moves money between
 * them and out: a book transfer (same bank) and an ACH payment (the Return's fiat leg, to the
 * on-ramp's bank details).
 *
 * Where the balances live. Nothing in the API names a CSA or a Collection Account yet. Lithic, our
 * card and banking rail, keeps every account at the bank partner as a financial account: a program
 * has ISSUING, OPERATING, RESERVE and SECURITY ones, and card settlement is debited from the
 * program's settlement (reserve) account. So the CSA and the Collection Account are expected to be
 * Lithic financial accounts and are configured by token:
 *
 *   SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN          the CSA (expected: the program's RESERVE account)
 *   SETTLEMENT_COLLECTION_FINANCIAL_ACCOUNT_TOKEN   the Collection Account; defaults to
 *                                                    LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN, where
 *                                                    automatic clearing books members' repayments
 *   SETTLEMENT_MARGIN_FINANCIAL_ACCOUNT_TOKEN       the Savings-Backed Margin, if Lithic holds it
 *
 * The bank partner confirms which accounts these are; until the CSA token is set the desk cannot read
 * the CSA and moves nothing. A balance that cannot be read is never taken as zero.
 *
 * `mock` keeps the balances in memory, for Base Sepolia runs without a bank (SETTLEMENT_BANK=mock).
 */

export interface BankAccounts {
  csa: string | null;
  collection: string | null;
  margin: string | null;
  /** Lithic's token for the on-ramp's bank details (the desk's Bridge virtual account), for Returns. */
  onRampExternalBankAccount: string | null;
}

export interface BankTransferClass {
  category: string;
  type: string;
  subtype: string;
}

export type BankStatus = 'pending' | 'settled' | 'failed';

export interface BankRail {
  name: 'lithic' | 'mock';
  accounts: BankAccounts;
  /** Available balance in USDC base units; null when it cannot be read. */
  balance(account: string | null): Promise<bigint | null>;
  /** A book transfer, idempotent on `token`. */
  bookTransfer(input: { token: string; from: string; to: string; amount: bigint; memo: string }): Promise<BankStatus>;
  /** A same-day ACH payment out to an external bank account, idempotent on `token`. */
  payment(input: { token: string; from: string; externalBankAccount: string; amount: bigint; memo: string }): Promise<BankStatus>;
  /** A transfer or payment's status, or null when the bank has never seen the token. */
  status(token: string, kind: 'book' | 'payment'): Promise<BankStatus | null>;
}

const first = (env: Record<string, string | undefined>, ...keys: string[]) => keys.map((k) => env[k]?.trim()).find(Boolean) || null;

export function bankAccountsFromEnv(env: Record<string, string | undefined>): BankAccounts {
  return {
    csa: first(env, 'SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN'),
    collection: first(env, 'SETTLEMENT_COLLECTION_FINANCIAL_ACCOUNT_TOKEN', 'LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN'),
    margin: first(env, 'SETTLEMENT_MARGIN_FINANCIAL_ACCOUNT_TOKEN'),
    onRampExternalBankAccount: first(env, 'SETTLEMENT_ONRAMP_EXTERNAL_BANK_ACCOUNT_TOKEN'),
  };
}

/**
 * The book transfer's classification. As for automatic clearing, Lithic's implementation team sets
 * the types up for the program with the bank's approval, so they are configuration.
 */
export function transferClassFromEnv(env: Record<string, string | undefined>): BankTransferClass {
  return {
    category: (env.SETTLEMENT_BOOK_TRANSFER_CATEGORY || 'PROGRAM_FUNDING').trim(),
    type: (env.SETTLEMENT_BOOK_TRANSFER_TYPE || 'TRANSFER').trim(),
    subtype: (env.SETTLEMENT_BOOK_TRANSFER_SUBTYPE || '').trim(),
  };
}

const mapStatus = (s: string | undefined): BankStatus => (s === 'SETTLED' ? 'settled' : s === 'PENDING' ? 'pending' : 'failed');
/** Cents to USDC base units; book transfers and payments take whole cents. */
const toCents = (units: bigint) => Number(units / 10_000n);

/** The Lithic SDK surface used here; the real client fits it, and tests pass a fake. */
export interface LithicLike {
  financialAccounts: { balances: { list(token: string): AsyncIterable<{ available_amount: number }> | Promise<{ data: Array<{ available_amount: number }> }> } };
  bookTransfers: { create(body: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ status: string }>; retrieve(token: string): Promise<{ status: string }> };
  payments: { create(body: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ status: string }>; retrieve(token: string): Promise<{ status: string }> };
}

const notFound = (e: unknown) => (e as { status?: number })?.status === 404;

export function lithicBank(lithic: LithicLike, accounts: BankAccounts, cls: BankTransferClass): BankRail {
  return {
    name: 'lithic',
    accounts,
    async balance(account) {
      if (!account) return null;
      try {
        const page = lithic.financialAccounts.balances.list(account);
        const rows: Array<{ available_amount: number }> = [];
        if (Symbol.asyncIterator in (page as object)) for await (const b of page as AsyncIterable<{ available_amount: number }>) rows.push(b);
        else rows.push(...(await (page as Promise<{ data: Array<{ available_amount: number }> }>)).data);
        const b = rows[0];
        if (!b || !Number.isFinite(b.available_amount)) return null;
        return centsToUnits(Math.round(b.available_amount));
      } catch {
        return null;
      }
    },
    async bookTransfer(t) {
      if (!cls.subtype) throw new Error('SETTLEMENT_BOOK_TRANSFER_SUBTYPE is not set: Lithic needs the program\'s book transfer subtype.');
      const r = await lithic.bookTransfers.create(
        {
          ...cls,
          token: t.token,
          amount: toCents(t.amount),
          from_financial_account_token: t.from,
          to_financial_account_token: t.to,
          memo: t.memo,
          external_id: t.token,
          on_closed_account: 'FAIL',
        },
        { idempotencyKey: t.token },
      );
      return mapStatus(r.status);
    },
    async payment(p) {
      const r = await lithic.payments.create(
        {
          type: 'PAYMENT',
          token: p.token,
          financial_account_token: p.from,
          external_bank_account_token: p.externalBankAccount,
          amount: toCents(p.amount),
          method: 'ACH_SAME_DAY',
          method_attributes: { sec_code: 'CCD' },
          memo: p.memo,
        },
        { idempotencyKey: p.token },
      );
      return mapStatus(r.status);
    },
    async status(token, kind) {
      try {
        const r = await (kind === 'book' ? lithic.bookTransfers : lithic.payments).retrieve(token);
        return mapStatus(r.status);
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
  };
}

/**
 * In-memory balances for Base Sepolia (no bank there). Seeded from SETTLEMENT_MOCK_CSA_USDC and
 * SETTLEMENT_MOCK_COLLECTION_USDC; book transfers settle at once.
 */
export function mockBank(accounts: Partial<BankAccounts> & { balances?: Record<string, bigint> } = {}): BankRail & { balances: Map<string, bigint>; moves: Array<{ kind: string; token: string; amount: bigint }> } {
  const balances = new Map<string, bigint>(Object.entries(accounts.balances ?? {}));
  const seen = new Map<string, BankStatus>();
  const moves: Array<{ kind: string; token: string; amount: bigint }> = [];
  const acc: BankAccounts = {
    csa: accounts.csa ?? 'mock-csa',
    collection: accounts.collection ?? 'mock-collection',
    margin: accounts.margin ?? 'mock-margin',
    onRampExternalBankAccount: accounts.onRampExternalBankAccount ?? 'mock-onramp',
  };
  for (const k of [acc.csa, acc.collection, acc.margin]) if (k && !balances.has(k)) balances.set(k, 0n);
  return {
    name: 'mock',
    accounts: acc,
    balances,
    moves,
    async balance(account) {
      return account && balances.has(account) ? balances.get(account)! : null;
    },
    async bookTransfer(t) {
      const done = seen.get(t.token);
      if (done) return done;
      const from = balances.get(t.from) ?? 0n;
      if (from < t.amount) {
        seen.set(t.token, 'failed');
        return 'failed';
      }
      balances.set(t.from, from - t.amount);
      balances.set(t.to, (balances.get(t.to) ?? 0n) + t.amount);
      moves.push({ kind: 'book', token: t.token, amount: t.amount });
      seen.set(t.token, 'settled');
      return 'settled';
    },
    async payment(p) {
      const done = seen.get(p.token);
      if (done) return done;
      const from = balances.get(p.from) ?? 0n;
      if (from < p.amount) {
        seen.set(p.token, 'failed');
        return 'failed';
      }
      balances.set(p.from, from - p.amount);
      moves.push({ kind: 'payment', token: p.token, amount: p.amount });
      seen.set(p.token, 'pending');
      return 'pending';
    },
    async status(token) {
      return seen.get(token) ?? null;
    },
  };
}
