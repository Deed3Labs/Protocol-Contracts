import { z } from 'zod';
import { Id, IdempotencyKey, NonNegativeCents, Timestamp } from './common';
import { PointCode, PointState } from './devices';
import { Table } from './floor';
import { Receipt } from './orders';

/**
 * The public pages a customer's phone opens, with no sign-in (terminal reference, sections 11 and
 * 12): `useclear.org/p/:code` follows a Point; `useclear.org/r/:code` is a printed receipt, for good.
 * Nothing here names a staff member, a customer or a wallet.
 */

/** What phones and Points show from Inventory: items on the menu, by the shop's category order. */
export const PublicMenu = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(z.object({ id: z.string(), name: z.string(), detail: z.string().nullable(), priceCents: NonNegativeCents })),
    }),
  ),
});
export type PublicMenu = z.infer<typeof PublicMenu>;

/** A bill on a Point: its lines and figures, and nothing about who rang it up. */
export const PublicBill = z.object({
  orderNumber: z.number().int().nullable(),
  lines: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1), lineCents: NonNegativeCents })),
  discountCents: NonNegativeCents,
  taxCents: NonNegativeCents,
  tipCents: NonNegativeCents,
  totalCents: NonNegativeCents,
  /** What is left to pay: a split bill can be part paid. */
  remainingCents: NonNegativeCents,
  sentAt: Timestamp,
});
export type PublicBill = z.infer<typeof PublicBill>;

/**
 * `GET /api/p/:code`. The page shows one of four states (menu, bill, paid, wait list), from the
 * Point's state: a bill or a paid bill when there is one; the wait list at a door Point; otherwise
 * the menu, or the Pay here line when the shop has nothing on the menu. A held table is the menu:
 * the party's name is never on this page, so the Point's state isn't either, only its `view`.
 */
export const PublicPoint = z.object({
  code: PointCode,
  /** `slug` when the shop has an app, so a rewards app's scanner opens the bill inside it. */
  shop: z.object({ name: z.string(), slug: z.string().optional() }),
  /** "Table 12". Null at the counter or the door. */
  table: z.string().nullable(),
  placement: z.enum(['counter', 'table', 'door']),
  view: z.enum(['menu', 'pay_here', 'bill', 'paid', 'waitlist']),
  bill: PublicBill.nullable(),
  /** When `paid`: the receipt, and when it was paid. */
  paid: z.object({ paidAt: Timestamp, receipt: Receipt }).nullable(),
  /** When `waitlist`: "WAIT LIST · ABOUT 15 MIN". */
  waitlist: z.object({ quotedMinutes: z.number().int().min(0) }).nullable(),
  /** How the shop can be paid here: card only when its card payments are connected. */
  pay: z.object({ clear: z.boolean(), card: z.boolean() }),
});
export type PublicPoint = z.infer<typeof PublicPoint>;

/**
 * `POST /api/p/:code/pay`. Clear raises the same Clear tender the counter would, for what is left,
 * and answers with its charge code, which the Clear app opens. Card is a Stripe Checkout Session on
 * the shop's own account, which returns to the page.
 */
export const PublicPay = z.object({
  method: z.enum(['clear', 'card']),
  idempotencyKey: IdempotencyKey,
  /**
   * From a signed-in rewards app (a shop's token): a ready reward to put on the bill before paying.
   * The token also puts the customer on the order, so a card payment earns too.
   */
  rewardId: Id.nullable().optional(),
});
export const PublicPayStarted = z.discriminatedUnion('method', [
  z.object({ method: z.literal('clear'), chargeCode: z.string(), url: z.string().url() }),
  z.object({ method: z.literal('card'), checkoutUrl: z.string().url() }),
]);
export type PublicPayStarted = z.infer<typeof PublicPayStarted>;

/** `POST /api/p/:code/waitlist`, from a door Point's page. A text needs the consent line ticked. */
export const JoinWaitlist = z.object({
  name: z.string().trim().min(1).max(40),
  size: z.number().int().min(1).max(20),
  phone: z.string().trim().min(7).max(24).nullable(),
  textConsent: z.boolean(),
});
export const WaitlistJoined = z.object({ position: z.number().int().min(1), quotedMinutes: z.number().int().min(0) });
export type WaitlistJoined = z.infer<typeof WaitlistJoined>;

/** `GET /api/r/:code`: a receipt, as it prints, with its shop. */
export const PublicReceipt = Receipt;
export type PublicReceipt = z.infer<typeof PublicReceipt>;

/**
 * `POST /api/r/:code/email` ("Email me this receipt", on the paid page). Sent by Resend, as other
 * receipts are; rate-limited by address and by receipt.
 */
export const EmailReceipt = z.object({ email: z.string().trim().email('That isn’t an email address') });

/**
 * The device API's answer (`GET /api/device/point/state`, and each event on `/stream`): what the
 * phone page gets, plus what only the screen draws. The server sends an ETag; a Point on battery
 * asks with If-None-Match and the server holds the request until something changes.
 */
export const PointScreen = PublicPoint.extend({
  state: PointState,
  /** Held, called and bill asked light the screen and the ring. */
  lit: z.boolean(),
  /** The table's number, drawn large in Number and Held. */
  tableNumber: Table.shape.number.nullable(),
  /** The inverted screen: "27 · ORDER Ready." or "Your table is ready". */
  alert: z.object({ kind: z.enum(['table_ready', 'order_ready']), label: z.string() }).nullable(),
  /** Idle in Showcase: the groups, already mixed up if the shop asked for it. */
  showcase: PublicMenu.nullable(),
  /** What the Point's QR and footer print: `useclear.org/p/A7K2`. */
  url: z.string(),
  /** When to ask again on battery, seconds. */
  pollSeconds: z.number().int().min(5),
});
export type PointScreen = z.infer<typeof PointScreen>;

/** The public API, as the phone pages call it. No sign-in; rate-limited by address. */
export interface PublicApi {
  point(code: string): Promise<PublicPoint>;
  menu(code: string): Promise<PublicMenu>;
  pay(code: string, input: z.input<typeof PublicPay>): Promise<PublicPayStarted>;
  joinWaitlist(code: string, input: z.input<typeof JoinWaitlist>): Promise<WaitlistJoined>;
  receipt(code: string): Promise<PublicReceipt>;
  emailReceipt(code: string, input: z.input<typeof EmailReceipt>): Promise<void>;
}
