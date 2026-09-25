import { z } from 'zod';
import { BusinessDate, Cents, Id, NonNegativeCents, ShopId, Timestamp } from './common';
import { TenderMethod } from './orders';

/**
 * The drawer and Close the day.
 *
 * **Blind counts.** Neither counter sees the other's figure, or what the drawer should hold, until
 * both counts are saved. That is a property of these types, not only of the screens: before both
 * are in, the view a counter gets back has nowhere to put another person's figure or the expected
 * total (card-processing prompt, Phase 2).
 */

export const DrawerSession = z.object({
  id: Id,
  shop: ShopId,
  businessDate: BusinessDate,
  openedBy: Id,
  startingCashCents: NonNegativeCents,
  openedAt: Timestamp,
  closedAt: Timestamp.nullable(),
  status: z.enum(['open', 'counting', 'closed']),
});
export type DrawerSession = z.infer<typeof DrawerSession>;

/** $100, $50 … 1¢, by count. */
export const Denominations = z.record(z.enum(['10000', '5000', '2000', '1000', '500', '100', '25', '10', '5', '1']), z.number().int().min(0));

export const SaveCount = z.discriminatedUnion('method', [
  z.object({ method: z.literal('notes'), notes: Denominations }),
  z.object({ method: z.literal('total'), totalCents: NonNegativeCents }),
]);
export type SaveCount = z.infer<typeof SaveCount>;

/** One counter's own count, as they see it. */
export const OwnCount = z.object({
  id: Id,
  counter: Id,
  method: z.enum(['notes', 'total']),
  notes: Denominations.nullable(),
  totalCents: NonNegativeCents,
  second: z.boolean(),
  savedAt: Timestamp,
});
export type OwnCount = z.infer<typeof OwnCount>;

/**
 * What the counts endpoint returns. Before both counts are saved it can carry only the viewer's
 * own count. Once both are in, both figures, the expected total and the difference.
 */
export const CountsView = z.discriminatedUnion('state', [
  z.object({ state: z.literal('awaiting_first') }),
  z.object({ state: z.literal('awaiting_second'), mine: OwnCount.nullable() }),
  /**
   * Both counts are in and they don't agree. Both figures show (the counters see how far apart they
   * are), but the expected total stays hidden until two counts agree, or a recount could be steered
   * toward it.
   */
  z.object({ state: z.literal('disagree'), counts: z.tuple([OwnCount, OwnCount]) }),
  z.object({
    state: z.literal('compared'),
    /** Both counts; one when the shop has two counts turned off. */
    counts: z.union([z.tuple([OwnCount]), z.tuple([OwnCount, OwnCount])]),
    expectedCents: NonNegativeCents,
    /** Counted − expected: negative is short. */
    differenceCents: Cents,
    /** Always true here: counts that disagree are the `disagree` state. Kept for the screens that read it. */
    countsAgree: z.boolean(),
    /** A difference is signed off by an owner or manager who wasn't the first counter. */
    signoffNeeded: z.boolean(),
  }),
]);
export type CountsView = z.infer<typeof CountsView>;

export const DrawerSignoff = z.object({
  sessionId: Id,
  differenceCents: Cents,
  note: z.string().min(1),
  signedBy: Id,
  signedAt: Timestamp,
});
export type DrawerSignoff = z.infer<typeof DrawerSignoff>;

export const SignOff = z.object({ note: z.string().min(1).max(500), pin: z.string().regex(/^\d{4}$/) });

export const BankDeposit = z.object({
  id: Id,
  sessionId: Id,
  amountCents: NonNegativeCents,
  markedBy: Id.nullable(),
  markedAt: Timestamp.nullable(),
});
export type BankDeposit = z.infer<typeof BankDeposit>;

const ByMethod = z.record(TenderMethod, z.object({ count: z.number().int().min(0), cents: NonNegativeCents }));

/** Locked at Close the day; nothing edits it after. */
export const DayReport = z.object({
  id: Id,
  shop: ShopId,
  businessDate: BusinessDate,
  takenCents: NonNegativeCents,
  byMethod: ByMethod,
  tipsCents: NonNegativeCents,
  tipsByStaff: z.array(z.object({ staffId: Id, cents: NonNegativeCents, how: z.enum(['card', 'cash']) })),
  taxCents: NonNegativeCents,
  discountsCents: NonNegativeCents,
  refundsCents: NonNegativeCents,
  drawer: z.object({
    startingCashCents: NonNegativeCents,
    expectedCents: NonNegativeCents,
    countedCents: NonNegativeCents,
    differenceCents: Cents,
    leaveCents: NonNegativeCents,
    toBankCents: NonNegativeCents,
    signedOffBy: Id.nullable(),
  }),
  closedBy: Id,
  closedAt: Timestamp,
});
export type DayReport = z.infer<typeof DayReport>;

/**
 * What Close the day returns: the locked report, and any card it couldn't capture. The processor
 * keeps trying those, except a card left on an account the shop disconnected, which only the shop
 * can capture (the message says where and by when).
 */
export const CloseDayResult = z.object({
  report: DayReport,
  captureFailures: z.array(z.object({ tenderId: Id, error: z.string() })),
});
export type CloseDayResult = z.infer<typeof CloseDayResult>;

/**
 * Overview, for a range of days: what was taken and how, discounts, tips, tax, refunds, the top
 * items, and the day reports. Built from paid orders and their tenders, so it agrees with the day
 * reports and with Charges.
 */
export const Overview = z.object({
  from: BusinessDate,
  to: BusinessDate,
  takenCents: NonNegativeCents,
  orderCount: z.number().int().min(0),
  byMethod: ByMethod,
  discounts: z.object({ count: z.number().int().min(0), cents: NonNegativeCents }),
  tips: z.object({ cents: NonNegativeCents, byStaff: z.array(z.object({ staffId: Id, name: z.string(), cents: NonNegativeCents })) }),
  taxCents: NonNegativeCents,
  refundsCents: NonNegativeCents,
  topItems: z.array(z.object({ itemId: Id.nullable(), name: z.string(), quantity: z.number().int().min(0), cents: NonNegativeCents })),
  dayReports: z.array(DayReport),
});
export type Overview = z.infer<typeof Overview>;

/**
 * One row of the shop's audit trail (card-processing prompt, Phase 10): who did what to the money,
 * and when. Every ledger booking (`booked.<kind>`) and every money action that books nothing itself
 * (a card hold, capture or void; a refund asked for or decided; a PIN override; a count, a sign-off,
 * a close). Owners only: it names everyone's actions and shows blind counts.
 */
export const AuditEntry = z.object({
  id: z.string(),
  at: z.string(),
  /** Staff id; null for the system (a job, a processor webhook). */
  actor: z.string().nullable(),
  /** Whoever approved it with their PIN. */
  approver: z.string().nullable(),
  action: z.string(),
  ref: z.object({ type: z.string(), id: z.string() }).nullable(),
  amountCents: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
