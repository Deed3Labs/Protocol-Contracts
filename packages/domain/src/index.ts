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
  isPending,
  isTerminal,
  toWire,
} from './charge';

export { type SplitQuote, splitQuote } from './split';

export { type RefundQuote, carryAccrued, refundQuote } from './refund';

export { compactMoney, count, credits, dollars, money, signedMoney } from './money';

export { parsePendingTotal, shopDisplayName } from './counterCode';

export { fromCents, toCents } from './units';

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

export { canAuthoriseRefund, seesMoney } from './types';
