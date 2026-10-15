import { z } from 'zod';
import { Id, NonNegativeCents, ShopId, Timestamp } from './common';
import { PointState } from './devices';
import { ServiceType } from './orders';

/**
 * Tables, their tabs, the wait list and alerts (terminal reference, sections 8 and 9). Tables are
 * only for shops that serve at tables (`tableService` in settings); Order ready is for counter
 * service.
 */

export const Table = z.object({
  id: Id,
  shop: ShopId,
  /** What's on the tile: 12. */
  number: z.number().int().min(1).max(999),
  /** Set when the shop calls it something else: "Bar 3". Null shows "Table 12". */
  label: z.string().trim().max(40).nullable(),
  /** "back patio", "by the window". */
  area: z.string().trim().max(40).nullable(),
  /** How many it seats: the Seat sheet offers tables that fit first. */
  seats: z.number().int().min(1).max(40),
});
export type Table = z.infer<typeof Table>;

export const TableInput = Table.pick({ number: true, label: true, area: true, seats: true });

/**
 * A table held for a party just seated (seating addendum). Its Point shows their first name, or
 * Reserved when `showName` is off, until the first item lands on the tab, staff mark them seated,
 * or `HOLD_SECONDS` pass.
 */
export const TableHold = z.object({ partyId: Id, showName: z.boolean(), seatedAt: Timestamp, expiresAt: Timestamp });
export type TableHold = z.infer<typeof TableHold>;

/**
 * Call or Bill, pressed on a table's Pay case. One open request of each kind per table: a second
 * press while one is open changes nothing. `bill_sent` is a Bill answered by sending the bill.
 */
export const TableRequest = z.object({
  id: Id,
  tableId: Id,
  pointId: Id,
  kind: z.enum(['call', 'bill']),
  at: Timestamp,
  state: z.enum(['open', 'answered', 'bill_sent']),
  answeredBy: Id.nullable(),
  answeredAt: Timestamp.nullable(),
  /** "$62.00" on the strip, when the bill was sent. */
  billCents: z.number().int().min(0).nullable(),
});
export type TableRequest = z.infer<typeof TableRequest>;

/**
 * A tile on Floor. Its tab is the table's open order. `held` while it waits for its party;
 * `ordering` is a tab with items; `bill_sent` once its bill is on the table's Point; `paid` until
 * the table is cleared. An open Call turns the tile amber whatever its status.
 */
export const TableView = Table.extend({
  status: z.enum(['free', 'held', 'seated', 'ordering', 'bill_sent', 'paid']),
  /** "Held for Ana": the party's first name, for staff. Null when not held. */
  hold: TableHold.extend({ partyName: z.string() }).nullable(),
  /** Its open Call or Bill, if any. */
  request: TableRequest.nullable(),
  /** Set from seated to paid. */
  seatedAt: Timestamp.nullable(),
  orderId: Id.nullable(),
  tabCents: NonNegativeCents.nullable(),
  billSentAt: Timestamp.nullable(),
  paidAt: Timestamp.nullable(),
  /** The table's Point, and what it shows: "Point shows Menu". */
  point: z.object({ id: Id, showing: PointState }).nullable(),
});
export type TableView = z.infer<typeof TableView>;

// ---- The wait list -----------------------------------------------------------------------------------

export const WaitlistParty = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  /** "5+" is 5. */
  size: z.number().int().min(1).max(20),
  phone: z.string().nullable(),
  /** They ticked the consent line on the join page, or the counter asked them. Texts need it. */
  textConsent: z.boolean(),
  /** 1 is next. */
  position: z.number().int().min(1),
  /** "about 15 min", when they joined. */
  quotedMinutes: z.number().int().min(0),
  state: z.enum(['waiting', 'ready', 'seated', 'left']),
  /** "Ana's table is 12 when it clears." */
  tableId: Id.nullable(),
  joinedAt: Timestamp,
  readyAt: Timestamp.nullable(),
});
export type WaitlistParty = z.infer<typeof WaitlistParty>;

export const Waitlist = z.object({
  parties: z.array(WaitlistParty),
  /** "4 waiting · about 15 min": the quote for someone joining now. */
  quotedMinutes: z.number().int().min(0),
});
export type Waitlist = z.infer<typeof Waitlist>;

/** Add a party, at the door. The phone page's join is `JoinWaitlist` (public.ts). */
export const AddParty = z.object({
  name: z.string().trim().min(1).max(40),
  size: z.number().int().min(1).max(20),
  phone: z.string().trim().min(7).max(24).nullable(),
  textConsent: z.boolean(),
});

export const UpdateParty = z.object({
  tableId: Id.nullable().optional(),
  state: z.enum(['waiting', 'left']).optional(),
  position: z.number().int().min(1).optional(),
});

/**
 * Seat a party (`POST /waitlist/:partyId/seat`): seated, the table held, its Point held, Table ready
 * on the door's Point, and a text if asked (and they left a number). Seating them again at the same
 * table changes nothing.
 */
export const SeatParty = z.object({ tableId: Id, showName: z.boolean(), text: z.boolean() });
export const PartySeated = z.object({ party: WaitlistParty, table: TableView });
export type PartySeated = z.infer<typeof PartySeated>;

/** The Floor page in one read, with Calls and bills from the last hour. */
export const Floor = z.object({ tables: z.array(TableView), waitlist: Waitlist, requests: z.array(TableRequest) });
export type Floor = z.infer<typeof Floor>;

// ---- Alerts --------------------------------------------------------------------------------------------

/**
 * Table ready (to a party) and Order ready (to a counter-service order): the inverted screen on a
 * Point, and a text if there's a number with consent. An alert clears itself when it expires, when
 * the order is picked up, or when the party is seated.
 */
export const ALERT_KINDS = ['table_ready', 'order_ready'] as const;
export const Alert = z.object({
  id: Id,
  kind: z.enum(ALERT_KINDS),
  /** The Point it shows on: the door's for a table, the counter's for an order. Null: text only. */
  pointId: Id.nullable(),
  partyId: Id.nullable(),
  orderId: Id.nullable(),
  /** The big line on the Point: "27", "Ana". */
  label: z.string().min(1).max(40),
  /** Where it was texted, last four only: "··0142". Null when not texted. */
  textedTo: z.string().nullable(),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  clearedAt: Timestamp.nullable(),
});
export type Alert = z.infer<typeof Alert>;

/** Order ready clears itself after ten minutes. */
export const ORDER_READY_SECONDS = 600;
/** Table ready, the same, unless they're seated first. */
export const TABLE_READY_SECONDS = 600;

export const CreateAlert = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table_ready'), partyId: Id, pointId: Id.nullable() }),
  z.object({ kind: z.literal('order_ready'), orderId: Id, pointId: Id.nullable() }),
]);

/**
 * Home's Order ready cell: paid orders waiting to be picked up, called, and picked up today, the
 * newest first.
 */
export const PickupOrder = z.object({
  orderId: Id,
  number: z.number().int().nullable(),
  /** "Ana", or null for a walk-in. */
  name: z.string().nullable(),
  paidAt: Timestamp,
  itemCount: z.number().int().min(0),
  serviceType: ServiceType.nullable(),
  calledAt: Timestamp.nullable(),
  pickedUpAt: Timestamp.nullable(),
});
export type PickupOrder = z.infer<typeof PickupOrder>;
