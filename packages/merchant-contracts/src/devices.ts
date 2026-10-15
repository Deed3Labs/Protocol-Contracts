import { z } from 'zod';
import { Id, ShopId, Timestamp } from './common';

/**
 * Counter hardware (terminal reference, sections 1–4 and 14): Clear Points, the cash drawer and
 * printers. Card readers stay in `cards.ts`, and enrolled tablets stay where they are
 * (`/api/merchant/devices`); these live at `/api/merchant/hardware` (DECISIONS, Terminal Phase 2).
 *
 * **The one rule.** The tablet talks to the drawer, the printer and the reader directly; only a
 * Point listens to the server. So the server stores the drawer's and printers' settings and the
 * drawer's log, and owns what each Point shows. It never reaches a drawer or a printer itself.
 */

/** Four letters and digits under the code on a Point's back: `A7K2`. Crockford base32, no I L O U. */
export const PointCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-HJKMNP-TV-Z]{4}$/, 'That isn’t a Point’s code');

// ---- A Point -------------------------------------------------------------------------------------

export const POINT_PLACEMENTS = ['counter', 'table', 'door'] as const;
export const PointPlacement = z.enum(POINT_PLACEMENTS);
export type PointPlacement = z.infer<typeof PointPlacement>;

/**
 * What a Point shows when nothing is open: its table's Number (large, with the menu code), the
 * Menu, a Showcase of some groups, or Pay here. A door Point shows the wait list, which isn't one of
 * the pane's four.
 */
export const POINT_IDLE_MODES = ['number', 'menu', 'showcase', 'pay', 'waitlist'] as const;
export const PointIdleMode = z.enum(POINT_IDLE_MODES);
export type PointIdleMode = z.infer<typeof PointIdleMode>;

/** The idle mode a Point starts with, by where it goes (seating addendum). */
export const DEFAULT_IDLE_MODE: Record<z.infer<typeof PointPlacement>, PointIdleMode> = { table: 'number', counter: 'pay', door: 'waitlist' };

/** The Pay case's Bill button: send the table's bill to its Point, or just tell staff. */
export const BillButton = z.enum(['send_bill', 'notify']);
export type BillButton = z.infer<typeof BillButton>;

export const PointSettings = z.object({
  placement: PointPlacement,
  /** Set for a Point at a table: its bills come from that table's tab. */
  tableId: Id.nullable(),
  idleMode: PointIdleMode,
  /** Inventory's categories, by name, for Showcase. */
  showcaseCategories: z.array(z.string().min(1)),
  /** "A random few from those groups, every few minutes." */
  mixUp: z.boolean(),
  /** "Menu at lunch, Pay here after 9pm." */
  byTimeOfDay: z.boolean(),
  /**
   * The M2 in this Point's Pay case (a `Reader` id), linked once in its pane. One reader links to one
   * Point. The tablet borrows it while this table pays; the Point itself never drives it.
   */
  readerId: Id.nullable(),
  /** The Pay case's buttons: Call pages whoever is on shift; Bill sends the bill or tells staff. */
  buttons: z.object({ call: z.boolean(), bill: BillButton }),
  /** Drawn off with "Coming later": they need ordering from the phone. Fixed false until then. */
  suggestBeforePaying: z.literal(false),
  oneMoreRound: z.literal(false),
});
export type PointSettings = z.infer<typeof PointSettings>;

/** What a Point last said about itself (Health on its pane). Null until it first reports. */
export const PointHealth = z.object({
  /** 0–100. */
  batteryPercent: z.number().int().min(0).max(100),
  /** Plugged in: holds a stream instead of asking on wake. */
  pluggedIn: z.boolean(),
  /** Received signal, dBm. */
  rssi: z.number().int().min(-127).max(0),
  ssid: z.string().nullable(),
  firmware: z.string().min(1),
  /** A Pay case, detected through the pogo pins, and whether its buttons answer. Null: no case. */
  case: z.object({ kind: z.literal('pay'), buttons: z.enum(['ok', 'fault']) }).nullable(),
  /** Whether a newer firmware is published for it. */
  firmwareCurrent: z.boolean(),
  lastSeenAt: Timestamp,
});
export type PointHealth = z.infer<typeof PointHealth>;

/**
 * What a Point is showing, as the server owns it. One schema for the merchant app and the device
 * API (`pointStateFor` on the server); the phone page gets only a `view` from it, never a name.
 *
 * - `idle`: nothing open; it shows its idle mode.
 * - `held`: its table is held for a party just seated: inverted, their first name (null shows
 *   Reserved), the ready light on, until the first item, staff marking them seated, or 15 minutes.
 * - `bill`: an order sent to it and not yet paid. `paid` once the order is paid, for a while.
 * - `called`, `bill_asked`: the Pay case's Call or Bill was pressed and staff are told; until it is
 *   answered, or 10 minutes. Then back to what it showed before.
 * - `alert`: Table ready or Order ready, over anything, until it expires or is cleared.
 * - `test`: the test screen from its pane.
 */
export const PointState = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle'), mode: PointIdleMode }),
  z.object({
    kind: z.literal('held'),
    tableId: Id,
    partyName: z.string().nullable(),
    partySize: z.number().int().min(1),
    seatedAt: Timestamp,
    expiresAt: Timestamp,
  }),
  z.object({ kind: z.literal('bill'), orderId: Id, since: Timestamp }),
  z.object({ kind: z.literal('paid'), orderId: Id, since: Timestamp }),
  z.object({ kind: z.literal('called'), requestId: Id, since: Timestamp, expiresAt: Timestamp }),
  z.object({ kind: z.literal('bill_asked'), requestId: Id, since: Timestamp, expiresAt: Timestamp }),
  z.object({ kind: z.literal('alert'), alertId: Id, since: Timestamp, expiresAt: Timestamp }),
  z.object({ kind: z.literal('test'), since: Timestamp }),
]);
export type PointState = z.infer<typeof PointState>;

/** Send something to a Point (`POST /points/:id/show`). `clear` takes it back to idle. */
export const ShowOnPoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), orderId: Id }),
  z.object({ kind: z.literal('alert'), alertId: Id }),
  z.object({ kind: z.literal('test') }),
  z.object({ kind: z.literal('clear') }),
]);
export type ShowOnPoint = z.infer<typeof ShowOnPoint>;

/** How long a paid bill stays on a Point before it goes back to idle. */
export const POINT_PAID_SECONDS = 180;
/** A hold clears by itself after 15 minutes (seating addendum). */
export const HOLD_SECONDS = 900;
/** Call and Bill fall back after 10 minutes unanswered (Pay case addendum). */
export const TABLE_REQUEST_SECONDS = 600;

type Kind<K extends PointState['kind']> = Extract<PointState, { kind: K }>;

/**
 * What a Point shows at `now`. Pure, so the server, the mock and the fake Point agree. Each layer
 * covers the ones under it while it lasts:
 *
 *   alert  >  called / bill_asked  >  bill / paid / test  >  held  >  idle
 *
 * So a Call over a bill falls back to the bill when answered, a bill sent to a held table wins (the
 * server clears the hold too), and a paid bill holds for `POINT_PAID_SECONDS`, then idle.
 */
export function pointShowing(
  input: {
    /** The last thing sent to it; idle when nothing was. */
    base: Kind<'idle'> | Kind<'bill'> | Kind<'paid'> | Kind<'test'>;
    hold: Kind<'held'> | null;
    request: Kind<'called'> | Kind<'bill_asked'> | null;
    alert: Kind<'alert'> | null;
    idleMode: PointIdleMode;
  },
  now: Date,
): PointState {
  const t = now.getTime();
  const live = (x: { expiresAt: string } | null) => x !== null && Date.parse(x.expiresAt) > t;
  if (live(input.alert)) return input.alert!;
  if (live(input.request)) return input.request!;
  const b = input.base;
  if (b.kind === 'bill' || b.kind === 'test') return b;
  if (b.kind === 'paid' && t - Date.parse(b.since) < POINT_PAID_SECONDS * 1000) return b;
  if (live(input.hold)) return input.hold!;
  return { kind: 'idle', mode: input.idleMode };
}

/** Whether a Point's screen is lit: held, called or bill asked. The ring lights share the pin. */
export const pointLit = (s: PointState) => s.kind === 'held' || s.kind === 'called' || s.kind === 'bill_asked';

// ---- A cash drawer -------------------------------------------------------------------------------

export const DrawerSettings = z.object({
  /** The drawer's Bluetooth id (`4F2A` is its last four). Null when it is cabled to a printer. */
  bluetoothId: z.string().min(1).nullable(),
  /** The enrolled tablet that opens it. */
  pairedTabletId: Id.nullable(),
  /** "Cabled to the printer instead": the app sends the printer's drawer pulse. */
  cabledToPrinter: z.boolean(),
  /** The printer whose pulse opens it, when cabled. */
  printerId: Id.nullable(),
});
export type DrawerSettings = z.infer<typeof DrawerSettings>;

// ---- A printer -----------------------------------------------------------------------------------

export const PRINTER_CONNECTIONS = ['wifi', 'bluetooth', 'os'] as const;
/** ESC/POS raster, TSPL, ZPL, or the device's own print dialog. */
export const PRINTER_LANGUAGES = ['escpos', 'tspl', 'zpl', 'os'] as const;
/** 80mm receipt roll, or 4-inch labels. */
export const PRINTER_PAPERS = ['receipt80', 'label4x6', 'label4x3'] as const;
export const AutoPrint = z.enum(['ask', 'always', 'never']);
export type AutoPrint = z.infer<typeof AutoPrint>;

export const PrinterSettings = z.object({
  /** What it is, as Settings › Devices names it: "Clear 4-inch", "Rollo". Optional so older settings still parse. */
  model: z.string().trim().min(1).max(40).nullable().optional(),
  connection: z.enum(PRINTER_CONNECTIONS),
  /** `192.168.1.40:9100` for Wi-Fi, a Bluetooth id, or null for the OS dialog. */
  address: z.string().min(1).nullable(),
  language: z.enum(PRINTER_LANGUAGES),
  paper: z.enum(PRINTER_PAPERS),
  /** What prints by itself on this printer (Printers › Prints by itself). Absent: it doesn't print that. */
  prints: z.object({
    /** The receipt after a cash sale. */
    receipt: AutoPrint.nullable(),
    /** For orders marked To go or Delivery. */
    bagLabel: AutoPrint.nullable(),
    /** When an order is sent. */
    kitchenTicket: z.enum(['always', 'never']).nullable(),
  }),
});
export type PrinterSettings = z.infer<typeof PrinterSettings>;

// ---- Devices -------------------------------------------------------------------------------------

const DeviceBase = z.object({
  id: Id,
  shop: ShopId,
  /** "Table 12", "Counter", "Clear Drawer 4F2A", "Kitchen". */
  name: z.string().min(1).max(60),
  createdAt: Timestamp,
});

export const PointDevice = DeviceBase.extend({
  kind: z.literal('point'),
  code: PointCode,
  /** "Point", "Point Large". */
  model: z.enum(['point', 'point_large']),
  settings: PointSettings,
  health: PointHealth.nullable(),
  showing: PointState,
});
export type PointDevice = z.infer<typeof PointDevice>;

export const DrawerDevice = DeviceBase.extend({
  kind: z.literal('drawer'),
  settings: DrawerSettings,
  /** From the drawer's log: shut or open at its last event, and how many opens today. */
  status: z.object({ open: z.boolean().nullable(), lastEventAt: Timestamp.nullable(), opensToday: z.number().int().min(0) }),
});
export type DrawerDevice = z.infer<typeof DrawerDevice>;

export const PrinterDevice = DeviceBase.extend({
  kind: z.literal('printer'),
  settings: PrinterSettings,
});
export type PrinterDevice = z.infer<typeof PrinterDevice>;

export const DEVICE_KINDS = ['point', 'drawer', 'printer'] as const;
export const Device = z.discriminatedUnion('kind', [PointDevice, DrawerDevice, PrinterDevice]);
export type Device = z.infer<typeof Device>;

/** A drawer or printer found by the tablet. Points are claimed by their code instead. */
export const AddDevice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('drawer'), name: z.string().trim().min(1).max(60), settings: DrawerSettings }),
  z.object({ kind: z.literal('printer'), name: z.string().trim().min(1).max(60), settings: PrinterSettings }),
]);

/** Owners. Settings are merged a group at a time, as shop settings are. */
export const UpdateDevice = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  point: PointSettings.omit({ suggestBeforePaying: true, oneMoreRound: true }).partial().optional(),
  drawer: DrawerSettings.partial().optional(),
  printer: PrinterSettings.partial().optional(),
});

/** Add a Point, step 1: its code, scanned or typed. Step 3's name and placement follow as an update. */
export const ClaimPoint = z.object({ code: PointCode });

/**
 * The claimed Point, and a one-time secret the tablet hands it over Bluetooth with the Wi-Fi. The
 * Point trades the secret for its own device key (`ActivatePoint`); the secret works once, for ten
 * minutes.
 */
export const ClaimedPoint = z.object({
  device: PointDevice,
  provisioning: z.object({ secret: z.string().min(32), apiBase: z.string().url(), expiresAt: Timestamp }),
});
export type ClaimedPoint = z.infer<typeof ClaimedPoint>;

// ---- The device API: what a Point sends and gets ----------------------------------------------------

/** `POST /api/device/point/activate`: the provisioning secret, once, for the Point's device key. */
export const ActivatePoint = z.object({ code: PointCode, secret: z.string().min(32) });
export const PointKey = z.object({ deviceKey: z.string().min(32) });
export type PointKey = z.infer<typeof PointKey>;

/** `POST /api/device/point/health`. */
export const PointHealthReport = PointHealth.omit({ lastSeenAt: true, firmwareCurrent: true });
export type PointHealthReport = z.infer<typeof PointHealthReport>;

/**
 * `POST /api/device/point/event`: a Pay case button. Pressed offline, it is sent when the connection
 * returns if it's under two minutes old, otherwise dropped.
 */
export const PointEvent = z.object({ kind: z.literal('button'), button: z.enum(['call', 'bill']), at: Timestamp });
export type PointEvent = z.infer<typeof PointEvent>;

// ---- The drawer's log --------------------------------------------------------------------------------

export const DRAWER_OPEN_REASONS = ['sale', 'refund', 'no_sale', 'key', 'test'] as const;
export const DrawerOpenReason = z.enum(DRAWER_OPEN_REASONS);
export type DrawerOpenReason = z.infer<typeof DrawerOpenReason>;

/** No sale › Why. */
export const NO_SALE_REASONS = ['change_for_note', 'wrong_change', 'counting', 'other'] as const;
export const NoSaleReason = z.enum(NO_SALE_REASONS);
export type NoSaleReason = z.infer<typeof NoSaleReason>;

const EventBase = z.object({
  /** Made on the tablet. A sync that repeats one is a duplicate, never a second open. */
  clientId: z.string().min(8).max(100),
  drawerId: Id,
  /** The tablet's own clock when it happened, which may be long before it syncs. */
  at: Timestamp,
  /** Who was on the tablet. */
  staffId: Id,
});

export const DrawerEvent = z.discriminatedUnion('kind', [
  EventBase.extend({
    kind: z.literal('opened'),
    reason: DrawerOpenReason,
    /** The sale or refund it opened for; for `key`, the sale the drawer didn't open on. */
    orderId: Id.nullable(),
    noSale: z.object({ reason: NoSaleReason, note: z.string().trim().max(200).nullable() }).nullable(),
    /** A No sale's approval (`approveNoSale`), when one was needed. */
    approvalId: Id.nullable(),
  }),
  EventBase.extend({ kind: z.literal('shut') }),
]);
export type DrawerEvent = z.infer<typeof DrawerEvent>;

/** `POST /drawer/events`: in the order they happened, once each, however many times it is sent. */
export const DrawerEventBatch = z.object({ events: z.array(DrawerEvent).min(1).max(500) });
export const DrawerEventsSaved = z.object({ saved: z.number().int().min(0), duplicates: z.number().int().min(0) });
export type DrawerEventsSaved = z.infer<typeof DrawerEventsSaved>;

/**
 * A No sale's PIN, checked before the drawer opens: the counter's own when the owner allows
 * everyone, otherwise a manager's or owner's. It needs the connection (PINs are checked by the
 * server); the drawer then opens and its event carries the approval.
 */
export const ApproveNoSale = z.object({
  reason: NoSaleReason,
  note: z.string().trim().max(200).nullable(),
  pin: z.string().regex(/^\d{4}$/).nullable(),
});
export const NoSaleApproval = z.object({ approvalId: Id, approvedBy: Id.nullable(), expiresAt: Timestamp });
export type NoSaleApproval = z.infer<typeof NoSaleApproval>;

/** Close the day › the drawer: every open today. */
export const DrawerDay = z.object({
  opens: z.number().int().min(0),
  withSale: z.number().int().min(0),
  noSales: z.array(z.object({ at: Timestamp, staffId: Id, reason: NoSaleReason, note: z.string().nullable(), approvedBy: Id.nullable() })),
  withKey: z.array(z.object({ at: Timestamp, orderId: Id.nullable(), orderNumber: z.number().int().nullable() })),
});
export type DrawerDay = z.infer<typeof DrawerDay>;

/**
 * The drawer's signing key, for an enrolled tablet while online; kept in secure storage so the
 * drawer opens offline. An `open` is HMAC-SHA256 over the drawer id, a counter and the time.
 */
export const DrawerKey = z.object({ drawerId: Id, keyId: z.string().min(1), key: z.string().min(32), issuedAt: Timestamp });
export type DrawerKey = z.infer<typeof DrawerKey>;
