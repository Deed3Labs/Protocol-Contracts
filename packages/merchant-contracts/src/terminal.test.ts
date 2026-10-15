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
  PublicPoint,
  Receipt,
  ShopSettings,
  type PointState,
} from './index';

const at = (iso: string) => new Date(iso);
const T0 = '2026-10-15T19:42:00-07:00';

describe('what a Point shows', () => {
  const idle: PointState = { kind: 'idle', mode: 'menu' };
  const bill: PointState = { kind: 'bill', orderId: 'ord_12', since: T0 };
  const paid: PointState = { kind: 'paid', orderId: 'ord_12', since: T0 };
  const alert = { kind: 'alert' as const, alertId: 'alr_1', since: T0, expiresAt: '2026-10-15T19:52:00-07:00' };

  test('idle → bill → paid → idle', () => {
    expect(pointShowing({ base: idle, alert: null, idleMode: 'menu' }, at(T0))).toEqual(idle);
    expect(pointShowing({ base: bill, alert: null, idleMode: 'menu' }, at('2026-10-15T19:45:00-07:00'))).toEqual(bill);
    expect(pointShowing({ base: paid, alert: null, idleMode: 'menu' }, at('2026-10-15T19:43:00-07:00'))).toEqual(paid);
    const later = new Date(Date.parse(T0) + POINT_PAID_SECONDS * 1000);
    expect(pointShowing({ base: paid, alert: null, idleMode: 'pay' }, later)).toEqual({ kind: 'idle', mode: 'pay' });
  });

  test('an alert covers anything, and the bill comes back when it expires', () => {
    expect(pointShowing({ base: bill, alert, idleMode: 'menu' }, at('2026-10-15T19:50:00-07:00'))).toEqual(alert);
    expect(pointShowing({ base: bill, alert, idleMode: 'menu' }, at('2026-10-15T19:52:00-07:00'))).toEqual(bill);
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
    const s = { placement: 'table', tableId: 'tbl_12', idleMode: 'menu', showcaseCategories: [], mixUp: false, byTimeOfDay: true };
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
  test('a bill names nobody', () => {
    const page = PublicPoint.parse({
      code: 'A7K2',
      shop: { name: 'Mi Casa Tacos' },
      table: 'Table 12',
      placement: 'table',
      state: { kind: 'bill', orderId: 'ord_12', since: T0 },
      view: 'bill',
      bill: { orderNumber: null, lines: [{ name: 'Al pastor', quantity: 4, lineCents: 1800 }], discountCents: 0, taxCents: 370, tipCents: 0, totalCents: 4820, remainingCents: 4820, sentAt: T0 },
      paid: null,
      waitlist: null,
      pay: { clear: true, card: true },
    });
    expect(JSON.stringify(page)).not.toContain('stf_');
    expect(page.bill?.totalCents).toBe(4820);
  });
});
