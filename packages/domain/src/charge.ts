/**
 * The charge lifecycle — one enum, one transition table, both apps.
 *
 * The merchant app and the member app are two ends of this machine. The merchant's "waiting" is
 * the member's approve screen, unopened; the merchant's "confirmed" is the member's plan opening.
 * Because there is one table here, neither surface can invent a state the other does not know, and
 * neither can move a charge somewhere the other thinks impossible.
 *
 * Reconciled with the server, which already ran a narrower version of this machine in
 * `apps/api/src/services/chargeStore.ts`. Where the server has a wire value, it wins — renaming a
 * persisted status is a migration, not a refactor. `WIRE` below is that mapping.
 */

export type ChargeState =
  /** The merchant has an amount on screen and nothing has been raised. Never persisted. */
  | 'draft'
  /**
   * Raised; the code is on the counter screen and the member has not acted. The member's approve
   * screen, unopened. Persisted by the server as `pending`.
   */
  | 'waiting'
  /**
   * The member approved and the chain call has not returned.
   *
   * A real, visible state rather than an implementation detail — the server's note is worth
   * repeating: if the process dies in this window the charge stays here deliberately, because
   * releasing it back to `waiting` would let a member approve a charge whose plan had already been
   * opened. A stuck charge is visible and fixable; a duplicate term plan is somebody owing twice.
   */
  | 'resolving'
  /** Financed. The plan is open and the merchant is owed a payout. */
  | 'approved'
  /**
   * The member said no, or could not be lent to.
   *
   * The merchant is never told which. A decline carries no reason to the counter — that is the
   * member's business, and a writer who knows the reason will repeat it out loud.
   */
  | 'declined'
  /** The code timed out unanswered. Resending raises a NEW charge; this one stays expired. */
  | 'expired'
  /** The merchant withdrew it before the member acted. Counter staff may cancel their own. */
  | 'cancelled'
  /**
   * A refund has been started by a staff member and is waiting on an owner.
   *
   * Persists deliberately: an owner may walk over minutes later, or approve from their phone. The
   * customer has been told nothing at this point and nothing has moved.
   */
  | 'refund_requested'
  /** An owner declined the refund. This tells the writer, not the customer; the charge stands. */
  | 'refund_declined'
  /** The refund settled. The plan is closed and the member's principal has returned. */
  | 'refunded';

/**
 * What each state may become.
 *
 * The single source of truth for both apps. A transition absent here is not merely discouraged —
 * it cannot be represented, because both surfaces ask this table before offering the control.
 */
export const CHARGE_TRANSITIONS: Readonly<Record<ChargeState, readonly ChargeState[]>> = {
  draft: ['waiting'],
  waiting: ['resolving', 'declined', 'expired', 'cancelled'],
  // Back to `waiting` only on an explicit release, when the chain call is known not to have landed.
  resolving: ['approved', 'declined', 'waiting'],
  approved: ['refund_requested'],
  declined: [],
  expired: [],
  cancelled: [],
  // An owner approves or declines; the writer may also withdraw the request before either.
  refund_requested: ['refunded', 'refund_declined', 'approved'],
  refund_declined: ['approved'],
  refunded: [],
} as const;

export function canTransition(from: ChargeState, to: ChargeState): boolean {
  return CHARGE_TRANSITIONS[from].includes(to);
}

/** States from which nothing further can happen. */
export function isTerminal(state: ChargeState): boolean {
  return CHARGE_TRANSITIONS[state].length === 0;
}

/** The charge is raised and money has not yet been committed either way. */
export function isPending(state: ChargeState): boolean {
  return state === 'waiting' || state === 'resolving';
}

/** The charge financed and has not been unwound — the merchant is owed for it. */
export function isFinanced(state: ChargeState): boolean {
  return state === 'approved' || state === 'refund_requested' || state === 'refund_declined';
}

/**
 * Wire values, where the server persists something under a different name.
 *
 * Only `waiting` differs: the column has stored `pending` since before this vocabulary existed,
 * and the spec's word is the better one to show a merchant. Displaying one and storing the other
 * is cheaper and safer than a migration.
 */
const WIRE: Partial<Record<ChargeState, string>> = { waiting: 'pending' };
const FROM_WIRE: Record<string, ChargeState> = { pending: 'waiting' };

export function toWire(state: ChargeState): string {
  return WIRE[state] ?? state;
}

export function fromWire(value: string): ChargeState {
  return FROM_WIRE[value] ?? (value as ChargeState);
}

/**
 * What a merchant is shown.
 *
 * `resolving` reads as "Confirming" rather than exposing the mechanism — from the counter it is
 * the same moment as waiting, a few seconds longer. A decline says only that it was declined.
 */
export const CHARGE_LABEL: Readonly<Record<ChargeState, string>> = {
  draft: 'Not sent',
  waiting: 'Waiting',
  resolving: 'Confirming',
  approved: 'Confirmed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  refund_requested: 'Refund needs an owner',
  refund_declined: 'Refund declined',
  refunded: 'Refunded',
} as const;
