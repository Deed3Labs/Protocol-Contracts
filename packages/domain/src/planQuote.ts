/**
 * What a term plan costs, the way the chain prices it (compliance spec items 5-9).
 *
 * `TermIssuerOrigination.openPlan` reverts with `TermIssuerTermsMismatch` unless the signed
 * `ratePerCycle` and `payout` equal what `TermIssuerBase._quote` computes. This is that function,
 * step for step, over figures read from chain. Nothing here is a price list: the list rate and the
 * legal cap come from `RateSchedule.effectiveMonthlyBps(state, product, principal)`, the free
 * rules from `RateSchedule.paramsOf`, and the merchant's discount, subsidy and free split from
 * `MerchantRegistry.splitTermsOf(merchant, installments)`. The caller reads them; this decides.
 *
 * Kept free of I/O so the rules can be tested against the contract's own cases.
 */

/** `RateSchedule.ProductParams`, the fields `_quote` reads. Amounts in ledger units. */
export interface RateProductParams {
  enabled: boolean;
  largeLoanThreshold: bigint;
  minTermSeconds: bigint;
  freeInFull: boolean;
  freeBelowAmount: bigint;
  freeSplitMax: number;
}

/** `MerchantRegistry.splitTermsOf(merchant, installments)`. */
export interface MerchantSplitTerms {
  discountBps: bigint;
  subsidyBps: bigint;
  freeSplitMax: number;
}

export type PlanQuoteRefusal =
  /** `NetworkRegistry.stateCodeOf(member)` is zero: nobody has attested where they live. */
  | { kind: 'state_not_confirmed' }
  /** The product is not enabled in the member's state. */
  | { kind: 'product_not_enabled'; stateCode: string }
  /** A large loan scheduled over less than the product's minimum term. */
  | { kind: 'term_too_short'; termSeconds: bigint; minimumSeconds: bigint };

export interface PlanQuote {
  /** Monthly bps the member is charged: min(list, cap) less the merchant's subsidy, or 0 if free. */
  rateBps: bigint;
  /** What the merchant is paid, in ledger units. */
  payout: bigint;
  free: boolean;
  largeLoan: boolean;
  subsidyBps: bigint;
}

const BPS = 10_000n;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

/**
 * `_quote`, given what it reads. `stateCode` is `stateCodeOf(member)`; `enabled` and `params` are
 * for (state, product); `effectiveMonthlyBps` is `RateSchedule.effectiveMonthlyBps(state, product,
 * principal)`. Returns the refusal the contract would revert with, or the quote.
 */
export function quotePlan(input: {
  stateCode: string;
  params: RateProductParams | null;
  merchant: MerchantSplitTerms;
  effectiveMonthlyBps: bigint;
  principal: bigint;
  installments: number;
  installmentLengthSeconds: bigint;
}): { ok: true; quote: PlanQuote } | { ok: false; refusal: PlanQuoteRefusal } {
  const { params, merchant, principal } = input;
  if (!input.stateCode || input.stateCode.toLowerCase() === ZERO_BYTES32) {
    return { ok: false, refusal: { kind: 'state_not_confirmed' } };
  }
  if (!params || !params.enabled) {
    return { ok: false, refusal: { kind: 'product_not_enabled', stateCode: input.stateCode } };
  }
  const installments = BigInt(input.installments);
  const payout = principal - (principal * merchant.discountBps) / BPS;
  const largeLoan = params.largeLoanThreshold !== 0n && principal >= params.largeLoanThreshold;
  if (largeLoan) {
    const term = installments * input.installmentLengthSeconds;
    if (term < params.minTermSeconds) {
      return { ok: false, refusal: { kind: 'term_too_short', termSeconds: term, minimumSeconds: params.minTermSeconds } };
    }
  }
  let free =
    (params.freeInFull && input.installments === 1) ||
    (params.freeBelowAmount !== 0n && principal < params.freeBelowAmount) ||
    (params.freeSplitMax !== 0 && input.installments <= params.freeSplitMax) ||
    (merchant.freeSplitMax !== 0 && input.installments <= merchant.freeSplitMax);
  const effective = input.effectiveMonthlyBps;
  if (!free && merchant.subsidyBps >= effective) free = true;
  return {
    ok: true,
    quote: { rateBps: free ? 0n : effective - merchant.subsidyBps, payout, free, largeLoan, subsidyBps: merchant.subsidyBps },
  };
}

/**
 * Whether `setSplit` would need the member's signature (`_resplit`): the new rate is higher than
 * the plan's, or the plan carries a rate and the new split is longer than the installments left.
 */
export function resplitCostRises(input: {
  oldRateBps: bigint;
  newRateBps: bigint;
  installments: number;
  remainingInstallments: number;
}): boolean {
  return input.newRateBps > input.oldRateBps || (input.newRateBps > 0n && input.installments > input.remainingInstallments);
}

/** Clear Cash at or above the large-loan threshold may run 13 cycles (DECISIONS #4). */
export const CLEAR_CASH_SPLIT = 13;

/** `TermIssuerBase.isOfferedSplit`, plus the 13-cycle option for a large loan. */
export function isOfferedPlanSplit(installments: number, largeLoan = false): boolean {
  return [1, 2, 4, 6, 12].includes(installments) || (largeLoan && installments === CLEAR_CASH_SPLIT);
}
