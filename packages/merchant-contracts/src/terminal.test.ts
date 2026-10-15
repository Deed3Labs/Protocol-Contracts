import { describe, expect, test } from 'bun:test';
import {
  CreateOrder,
  DEFAULT_SETTINGS,
  Device,
  DrawerEventBatch,
  PointCode,
  PointSettings,
  POINT_PAID_SECONDS,
  pointShowing,
  pointLit,
  DEFAULT_IDLE_MODE,
  HOLD_SECONDS,
  TABLE_REQUEST_SECONDS,
  PointScreen,
  SeatParty,
  TableView,
  PublicPoint,
  Receipt,
  ShopSettings,
} from './index';

const at = (iso: string) => new Date(iso);
const T0 = '2026-10-15T19:42:00-07:00';

describe('what a Point shows', () => {
  const idle = { kind: 'idle' as const, mode: 'number' as const };
  const bill = { kind: 'bill' as const, orderId: 'ord_12', since: T0 };
  const paid = { kind: 'paid' as const, orderId: 'ord_12', since: T0 };
  const alert = { kind: 'alert' as const, alertId: 'alr_1', since: T0, expiresAt: '2026-10-15T19:52:00-07:00' };
  const hold = { kind: 'held' as const, tableId: 'tbl_6', partyName: 'Ana', partySize: 2, seatedAt: T0, expiresAt: new Date(Date.parse(T0) + HOLD_SECONDS * 1000).toISOString() };
  const called = { kind: 'called' as const, requestId: 'req_1', since: T0, expiresAt: new Date(Date.parse(T0) + TABLE_REQUEST_SECONDS * 1000).toISOString() };
  const show = (p: Partial<Parameters<typeof pointShowing>[0]>, when: string | Date) =>
    pointShowing({ base: idle, hold: null, request: null, alert: null, idleMode: 'number', ...p }, typeof when === 'string' ? at(when) : when);

  test('idle → bill → paid → idle', () => {
    expect(show({}, T0)).toEqual(idle);
    expect(show({ base: bill }, '2026-10-15T19:45:00-07:00')).toEqual(bill);
    expect(show({ base: paid }, '2026-10-15T19:43:00-07:00')).toEqual(paid);
    expect(show({ base: paid, idleMode: 'pay' }, new Date(Date.parse(T0) + POINT_PAID_SECONDS * 1000))).toEqual({ kind: 'idle', mode: 'pay' });
  });

  test('an alert covers anything, and the bill comes back when it expires', () => {
    expect(show({ base: bill, alert }, '2026-10-15T19:50:00-07:00')).toEqual(alert);
    expect(show({ base: bill, alert }, '2026-10-15T19:52:00-07:00')).toEqual(bill);
  });

  test('held over idle, lit, until it lapses after 15 minutes', () => {
    expect(show({ hold }, '2026-10-15T19:50:00-07:00')).toEqual(hold);
    expect(pointLit(hold)).toBe(true);
    expect(show({ hold }, new Date(Date.parse(T0) + HOLD_SECONDS * 1000))).toEqual(idle);
  });

  test('a bill and an alert win over held', () => {
    expect(show({ base: bill, hold }, '2026-10-15T19:45:00-07:00')).toEqual(bill);
    expect(show({ alert, hold }, '2026-10-15T19:45:00-07:00')).toEqual(alert);
  });

  test('Call covers what it showed, and gives it back when answered or after 10 minutes', () => {
    for (const before of [{ base: bill }, { hold }, {}]) {
      expect(show({ ...before, request: called }, '2026-10-15T19:45:00-07:00')).toEqual(called);
      const back = show(before, '2026-10-15T19:45:00-07:00');
      expect(show({ ...before, request: null }, '2026-10-15T19:45:00-07:00')).toEqual(back);
    }
    expect(show({ base: bill, request: called }, new Date(Date.parse(T0) + TABLE_REQUEST_SECONDS * 1000))).toEqual(bill);
  });

  test('each placement starts on its own idle', () => {
    expect(DEFAULT_IDLE_MODE).toEqual({ table: 'number', counter: 'pay', door: 'waitlist' });
  });
});

describe('codes', () => {
  test("a Point's code is four Crockford letters, typed in any case", () => {
    expect(PointCode.parse('a7k2')).toBe('A7K2');
    expect(PointCode.parse('D00R')).toBe('D00R');
    expect(PointCode.safeParse('A7KL').success).toBe(false);
    expect(PointCode.safeParse('A7K2X').success).toBe(false);
  });
  test("a receipt's code is ten characters, never an order number", () => {
    const base = Receipt.parse({
      shop: { name: 'Mi Casa Tacos', address: null },
      orderNumber: 142,
      businessDate: '2026-10-15',
      issuedAt: '2026-10-15T12:41:00-07:00',
      lines: [],
      discount: null,
      subtotalCents: 4225,
      discountCents: 0,
      taxCents: 345,
      taxIncluded: false,
      tipCents: 0,
      totalCents: 4570,
      tenders: [],
      refundedCents: 0,
    });
    expect(Receipt.safeParse({ ...base, code: '7KQ2M9XHRT' }).success).toBe(true);
    expect(Receipt.safeParse({ ...base, code: '0142' }).success).toBe(false);
  });
});

describe('devices', () => {
  test('the selling switches stay off', () => {
    const s = { placement: 'table', tableId: 'tbl_12', idleMode: 'number', showcaseCategories: [], mixUp: false, byTimeOfDay: true, readerId: 'rdr_1a3f', buttons: { call: true, bill: 'send_bill' } };
    expect(PointSettings.safeParse({ ...s, suggestBeforePaying: false, oneMoreRound: false }).success).toBe(true);
    expect(PointSettings.safeParse({ ...s, suggestBeforePaying: true, oneMoreRound: false }).success).toBe(false);
  });
  test('a printer is one of the kinds', () => {
    const printer = Device.parse({
      id: 'dev_1',
      shop: '0xshop',
      name: 'Kitchen',
      createdAt: T0,
      kind: 'printer',
      settings: { connection: 'wifi', address: '192.168.1.41:9100', language: 'tspl', paper: 'label4x3', prints: { receipt: null, bagLabel: null, kitchenTicket: 'always' } },
    });
    expect(printer.kind).toBe('printer');
  });
});

describe('the drawer log', () => {
  const opened = { kind: 'opened', clientId: 'evt_01JAB3', drawerId: 'dev_4f2a', at: T0, staffId: 'stf_jen', orderId: null, approvalId: 'nsa_1' };
  test('a No sale carries its reason', () => {
    expect(DrawerEventBatch.safeParse({ events: [{ ...opened, reason: 'no_sale', noSale: { reason: 'change_for_note', note: 'a $50' } }] }).success).toBe(true);
  });
  test('every event carries the tablet’s own id and time', () => {
    const { clientId: _c, ...noId } = opened;
    expect(DrawerEventBatch.safeParse({ events: [{ ...noId, reason: 'sale', noSale: null }] }).success).toBe(false);
    expect(DrawerEventBatch.safeParse({ events: [{ ...opened, at: 'yesterday', reason: 'sale', noSale: null }] }).success).toBe(false);
  });
});

describe('an order rung up offline', () => {
  test('carries its key and the tablet’s figures', () => {
    const o = CreateOrder.parse({
      lines: [{ itemId: 'itm_pastor', quantity: 4, optionIds: [] }],
      customer: null,
      idempotencyKey: 'ord-01JAB3XYZ',
      offline: { createdAt: T0, subtotalCents: 1800, taxCents: 140, totalCents: 1940 },
    });
    expect(o.offline?.totalCents).toBe(1940);
  });
  test('an online order needs neither', () => {
    expect(CreateOrder.safeParse({ lines: [], customer: null }).success).toBe(true);
  });
});

describe('settings', () => {
  test('Tables is off by default, and a No sale needs a PIN', () => {
    expect(DEFAULT_SETTINGS.tableService).toBe(false);
    expect(DEFAULT_SETTINGS.noSaleNeedsPin).toBe(true);
    expect(DEFAULT_SETTINGS.drawerNoSaleRoles).toBe('managers');
    expect(ShopSettings.safeParse({ ...DEFAULT_SETTINGS, updatedAt: T0 }).success).toBe(true);
  });
});

describe('the phone page', () => {
  const page = {
    code: 'A7K2',
    shop: { name: 'Mi Casa Tacos' },
    table: 'Table 12',
    placement: 'table',
    view: 'bill',
    bill: { orderNumber: null, lines: [{ name: 'Al pastor', quantity: 4, lineCents: 1800 }], discountCents: 0, taxCents: 370, tipCents: 0, totalCents: 4820, remainingCents: 4820, sentAt: T0 },
    paid: null,
    waitlist: null,
    pay: { clear: true, card: true },
  };
  test('a bill names nobody', () => {
    const p = PublicPoint.parse(page);
    expect(JSON.stringify(p)).not.toContain('stf_');
    expect(p.bill?.totalCents).toBe(4820);
  });
  test("a held table is the menu, and the party's name never reaches the page", () => {
    const held = { kind: 'held', tableId: 'tbl_6', partyName: 'Ana', partySize: 2, seatedAt: T0, expiresAt: T0 };
    const screen = PointScreen.parse({ ...page, view: 'menu', bill: null, state: held, lit: true, tableNumber: 6, alert: null, showcase: null, url: 'useclear.org/p/A7K2', pollSeconds: 30 });
    expect(screen.state.kind).toBe('held');
    // The server builds the page from the screen; whatever it carries, the public schema drops the state.
    const pub = PublicPoint.parse(screen);
    expect(JSON.stringify(pub)).not.toContain('Ana');
    expect(pub.view).toBe('menu');
  });
});

describe('seating', () => {
  test('the Seat sheet sends a table, the name switch and the text switch', () => {
    expect(SeatParty.safeParse({ tableId: 'tbl_6', showName: true, text: false }).success).toBe(true);
    expect(SeatParty.safeParse({ tableId: 'tbl_6', showName: true }).success).toBe(false);
  });
  test('a held tile carries its party for staff', () => {
    const tile = TableView.parse({
      id: 'tbl_6', shop: '0xshop', number: 6, label: null, area: 'by the window', seats: 2,
      status: 'held', hold: { partyId: 'pty_ana', showName: true, seatedAt: T0, expiresAt: T0, partyName: 'Ana' }, request: null,
      seatedAt: T0, orderId: null, tabCents: null, billSentAt: null, paidAt: null, point: null,
    });
    expect(tile.hold?.partyName).toBe('Ana');
  });
});
