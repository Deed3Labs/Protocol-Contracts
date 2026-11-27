import { requireLithic } from './lithicClient.js';
import { lithicStore } from './lithicStore.js';
import { pulledFundsStore } from './pulledFundsStore.js';

/*
 * Pulling from a member's outside bank — spec step 5.
 *
 * A `COLLECTION` is Lithic's word for a debit: money moving from the member's linked bank into
 * their Lithic cash account. The opposite direction is a `PAYMENT`. Getting these the wrong way
 * round would send money out of the co-op rather than in, so the type is never inferred from a
 * sign — it is stated.
 *
 * THE RULE THAT MATTERS: a pulled deposit is not final when it arrives.
 *
 * Insufficient-funds returns come back in days. Unauthorized-entry returns can come back for up to
 * SIXTY. So money that arrived by debit must not count as collateral until its window closes —
 * sweeping it into the ESA early would collateralise a credit line with money that can be clawed
 * back, and the member could spend against savings that then evaporate. Everything pulled is
 * recorded as pending, held out of the snapshot's collateral, and only released when the window
 * passes or a return arrives.
 *
 * The hold Lithic applies (1–4 days, its own default 2) is a different thing: it delays when the
 * funds become available at all. Ours is a longer, second window governing what they're allowed to
 * back. Both exist because they protect against different failures.
 */

/** How long money stays out of collateral, by risk. Not the same as Lithic's availability hold. */
export const RETURN_WINDOW_DAYS = {
  /** Administrative and NSF returns land inside this. */
  standard: 5,
  /**
   * Unauthorized-entry returns (R05, R07, R10, R11, R51) have a 60-day consumer window. Anything
   * pulled from a consumer account with PPD or WEB carries that risk for its whole life.
   */
  unauthorized: 60,
} as const;

export type SecCode = 'CCD' | 'PPD' | 'WEB';

export interface PullInput {
  wallet: string;
  externalBankAccountToken: string;
  amountCents: number;
  /**
   * PPD for a consumer account authorised on paper or by phone, WEB for one authorised online —
   * which is what an in-app auto-save setup is. CCD is business-to-business.
   */
  secCode?: SecCode;
  sameDay?: boolean;
  /** Lithic's availability hold, 1–4 days. Left to Lithic's default when unset. */
  holdDays?: number;
  memo?: string;
  /** Ours, for idempotency — a scheduled rule id plus its run, not a random uuid. */
  idempotencyToken: string;
}

export interface PullResult {
  paymentToken: string;
  status: string;
  amountCents: number;
  /** When the pulled amount is allowed to count as collateral. */
  collateralEligibleAt: string;
}

/**
 * Debit the member's linked bank into their Lithic cash account.
 *
 * The pull is recorded as pending collateral in the same breath as it is created. If that record
 * failed while the debit succeeded, the money would silently become spendable collateral the moment
 * it landed — so the write happens first and the payment carries its id.
 */
export async function pullFromBank(input: PullInput): Promise<PullResult> {
  const lithic = requireLithic();
  const record = await lithicStore.get(input.wallet);
  if (!record?.cashFinancialAccountToken) {
    throw new Error('Member has no Lithic cash account — cannot pull into it');
  }

  const secCode: SecCode = input.secCode ?? 'WEB';
  // Consumer debits authorised online carry the 60-day unauthorized-return window. Business
  // (CCD) debits do not, so they clear for collateral far sooner.
  const windowDays =
    secCode === 'CCD' ? RETURN_WINDOW_DAYS.standard : RETURN_WINDOW_DAYS.unauthorized;

  const eligibleAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);

  await pulledFundsStore.record({
    wallet: input.wallet,
    idempotencyToken: input.idempotencyToken,
    amountCents: input.amountCents,
    secCode,
    collateralEligibleAt: eligibleAt.toISOString(),
  });

  const payment = await lithic.payments.create({
    type: 'COLLECTION',
    financial_account_token: record.cashFinancialAccountToken,
    external_bank_account_token: input.externalBankAccountToken,
    amount: Math.round(input.amountCents),
    method: input.sameDay ? 'ACH_SAME_DAY' : 'ACH_NEXT_DAY',
    method_attributes: { sec_code: secCode },
    token: input.idempotencyToken,
    ...(input.holdDays !== undefined ? { hold: { days: input.holdDays } } : {}),
    ...(input.memo ? { memo: input.memo } : {}),
  } as Parameters<typeof lithic.payments.create>[0]);

  const paymentToken = String(
    (payment as unknown as { token?: string }).token ?? input.idempotencyToken,
  );
  await pulledFundsStore.attachPaymentToken(input.idempotencyToken, paymentToken);

  return {
    paymentToken,
    status: String((payment as unknown as { status?: string }).status ?? 'PENDING'),
    amountCents: input.amountCents,
    collateralEligibleAt: eligibleAt.toISOString(),
  };
}

/**
 * A return came back. Reverse it through both ledgers.
 *
 * Returns are not failures to log and move on from: the money left the member's bank, arrived, may
 * have been settled against credit, and is now going back. The pending record is marked returned so
 * it can never become collateral, and the caller reverses the deposit's ledger entries.
 */
export async function handleReturn(
  paymentToken: string,
  returnReasonCode: string,
): Promise<{ wallet: string; amountCents: number } | null> {
  const pending = await pulledFundsStore.markReturned(paymentToken, returnReasonCode);
  if (!pending) return null;
  return { wallet: pending.wallet, amountCents: pending.amountCents };
}
