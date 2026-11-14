/**
 * Shared domain for the Clear apps.
 *
 * The member app and the merchant app are two ends of one state machine: the merchant's "waiting"
 * is the member's approve screen, unopened. Anything both surfaces must agree on — the charge
 * lifecycle, what a split costs, what a refund does, how a figure is written — is computed here
 * once and imported by both. Neither app reimplements any of it.
 *
 * If the merchant app and the member app ever disagree on a number for the same charge, this
 * package is wrong. The reference figures are asserted in `split.test.ts` and `refund.test.ts`.
 *
 * Deliberately narrow. Member-specific display logic stays in `apps/member`, and there is no
 * shared component library — tokens and formatters are the whole shared surface.
 */

export {
  CHARGE_LABEL,
  CHARGE_TRANSITIONS,
  type ChargeState,
  canTransition,
  fromWire,
  isFinanced,
  countsAsVolume,
  isPending,
  isTerminal,
  PAY_OVER_TIME_MIN_CENTS,
  splitsOffered,
  toWire,
} from './charge';

export { levelPayment, type SplitQuote, splitQuote } from './split';

export { type RefundQuote, carryAccrued, refundQuote } from './refund';

export { type PayoutSettlement, merchantFee, merchantPayout, payoutSettlement } from './merchant';

export { compactMoney, count, credits, dollars, money, signedMoney } from './money';

export { parsePendingTotal, shopDisplayName, shopSlug } from './counterCode';

export { fromCents, toCents } from './units';

export {
  buildPlanTerms,
  bytes32String,
  disclosureMoney,
  PLAN_DISCLOSURE_VERSION,
  PLAN_PRODUCTS,
  PLAN_SIGNATURE_TTL_SECONDS,
  PLAN_TERMS_DOMAIN_NAME,
  PLAN_TERMS_DOMAIN_VERSION,
  PLAN_TERMS_TYPE_STRING,
  PLAN_TERMS_TYPES,
  planDisclosure,
  planDisclosureForTerms,
  planDisclosureText,
  planProductOf,
  planSchedule,
  planTermsArg,
  planTermsDomain,
  planTermsMessage,
  planTermsMismatch,
  planTermsTypedData,
  RESPLIT_TYPE_STRING,
  RESPLIT_TYPES,
  resplitDisclosure,
  resplitMessage,
  resplitMismatch,
  resplitTypedData,
  samePlanTerms,
  TERM_CYCLE_SECONDS,
  termPeriodRate,
  unitsToCents,
  type PlanDisclosureInput,
  type PlanProduct,
  type PlanSchedule,
  type PlanTerms,
  type PlanTermsTypedData,
  type ResplitTypedData,
  type ScheduledInstallment,
} from './planTerms';

export {
  CLEAR_CASH_SPLIT,
  isOfferedPlanSplit,
  quotePlan,
  resplitCostRises,
  type MerchantSplitTerms,
  type PlanQuote,
  type PlanQuoteRefusal,
  type RateProductParams,
} from './planQuote';

export {
  CLAIM_ESCROW_DOMAIN_NAME,
  CLAIM_ESCROW_DOMAIN_VERSION,
  CLAIM_KEY_DERIVATION_PREFIX,
  CLAIM_TYPES,
  claimEscrowDomain,
  claimKeySeed,
  claimTypedData,
  claimWindowOpen,
  PAYOUT_CLAIM_TYPE_STRING,
  PAYOUT_CLAIM_TYPES,
  PAYOUT_REF_PREFIX,
  payoutClaimTypedData,
  payoutRefSeed,
  TRANSFER_TERMS_TYPES,
  type ClaimPayoutMethod,
  type ClaimTransferTerms,
} from './claimKey';

export {
  COLLATERAL_REGISTRY_DOMAIN_NAME,
  COLLATERAL_REGISTRY_DOMAIN_VERSION,
  COLLATERAL_SIGNED_TYPES,
  collateralMessage,
  collateralMismatch,
  collateralRegistryDomain,
  collateralTypedData,
  collateralTypeString,
  PLEDGE_SIGNATURE_TTL_SECONDS,
  pledgeTypedData,
  type CollateralDomain,
  type CollateralPrimaryType,
  type CollateralShown,
  type CollateralTypedData,
} from './pledge';

export { formatCalendarDate, parseCalendarDate } from './dates';

export {
  AUTO_CLEAR_SCOPE,
  AUTO_CLEAR_TYPE_STRING,
  AUTO_CLEAR_TYPES,
  autoClearMessage,
  autoClearTypedData,
  REVOLVING_DOMAIN_NAME,
  REVOLVING_DOMAIN_VERSION,
  revolvingDomain,
  SAVINGS_DRAW_TYPE_STRING,
  SAVINGS_DRAW_TYPES,
  savingsDrawMessage,
  savingsDrawTypedData,
  SWITCH_SIGNATURE_TTL_SECONDS,
  switchMismatch,
  type AutoClearScope,
  type AutoClearTypedData,
  type SavingsDrawTypedData,
} from './revolvingSwitches';

export type {
  Charge,
  MemberRef,
  Merchant,
  Payout,
  Plan,
  Refund,
  Staff,
  StaffRole,
} from './types';

export {
  canAddRole,
  canAuthoriseRefund,
  canChangePayoutAccount,
  canChangeTerms,
  canInitiatePayout,
  canManageStaff,
  seesMoney,
} from './types';
