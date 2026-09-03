/**
 * The nouns both apps share.
 *
 * Only what genuinely crosses the two surfaces. The member app's own display model — credit tiers,
 * cycle status, reserve projection — stays in the member app, so the merchant app cannot reach it.
 *
 * Money is in whole units throughout, matching `splitQuote`, `refundQuote` and `money`. The server
 * persists cents (`amountCents`, `payoutCents`); converting is the job of whatever talks to it.
 */

import type { ChargeState } from './charge';

/**
 * Two roles, not a permission matrix.
 *
 * A shop has people who take money at a counter and people whose money it is. Anything finer is a
 * configuration screen nobody fills in, and a writer who cannot tell what they are allowed to do.
 */
export type StaffRole = 'counter' | 'owner';

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  /**
   * Counter staff authenticate with a PIN; an owner gets a real password, because they reach
   * money. Never the credential itself — only whether one is set.
   */
  hasPin: boolean;
  active: boolean;
}

/** What the counter role may never see: payout figures, bank details, the rate, monthly totals. */
export function seesMoney(role: StaffRole): boolean {
  return role === 'owner';
}

/** Only an owner authorises a refund; anyone may start one. */
export function canAuthoriseRefund(role: StaffRole): boolean {
  return role === 'owner';
}

export interface Merchant {
  id: string;
  name: string;
  /** The merchant's discount, e.g. 0.025 for 2.5%. Owner-visible only. */
  discountRate: number;
  /** Cost of carry quoted to members on this merchant's charges, e.g. 0.02 per cycle. */
  ratePerCycle: number;
  /** Splits offered at this counter. The member chooses among them, never the merchant. */
  splitOptions: number[];
  payoutAccountLast4?: string;
}

/**
 * The member, as the merchant is allowed to know them.
 *
 * A display name and nothing else. The counter has no business with a member's limit, balance or
 * standing, and a decline never explains itself.
 */
export interface MemberRef {
  id: string;
  displayName: string;
}

export interface Charge {
  id: string;
  /**
   * The code shown at the counter.
   *
   * Identity, not payment. It carries no amount, so a scanned code can never move money on its
   * own — the payer always approves a figure they can see.
   */
  code: string;
  merchantId: string;
  member?: MemberRef;
  /** What the shop's own system produced. One number; this app settles it, it does not compose it. */
  amount: number;
  state: ChargeState;
  /** Chosen by the member on their phone, and only once approved. */
  splitInto?: number;
  /** What the merchant receives, after their discount. */
  payout?: number;
  raisedByStaffId: string;
  createdAt: string;
  expiresAt: string;
  /** Set the first time the member opens it — the merchant's waiting state reads this. */
  openedAt?: string;
  resolvedAt?: string;
}

export interface Plan {
  id: string;
  chargeId: string;
  amount: number;
  splitInto: number;
  ratePerCycle: number;
  cyclesCleared: number;
  perCycle: number;
  total: number;
  carry: number;
}

export interface Payout {
  id: string;
  merchantId: string;
  /** Net of fees and of anything clawed back by a refund. */
  amount: number;
  /** When it lands. Withdrawing early does not change the merchant's rate. */
  scheduledFor: string;
  paidAt?: string;
  status: 'scheduled' | 'available' | 'paid';
}

/**
 * A refund in flight, and the record it leaves.
 *
 * Both names are kept: an owner reviewing the month needs to know who asked as well as who
 * approved. The charge's own `state` carries where the refund has got to.
 */
export interface Refund {
  id: string;
  chargeId: string;
  amount: number;
  requestedByStaffId: string;
  requestedAt: string;
  decidedByStaffId?: string;
  decidedAt?: string;
}
