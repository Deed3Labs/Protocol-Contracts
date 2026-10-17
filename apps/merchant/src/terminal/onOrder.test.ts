import { describe, expect, test } from 'bun:test';
import type { HardwareOrderLine } from '@clear/merchant-contracts';
import { lineDet, lineName, openLines, statusChip, usd } from './onOrderLines';
import { createMockMerchantApi } from '../data/merchantApi/mock';

const line = (over: Partial<HardwareOrderLine> = {}): HardwareOrderLine => ({
  n: 1,
  slug: 'clear-point',
  variant: 'table',
  name: 'Clear Point, Table',
  qty: 4,
  depositCents: 22000,
  balanceCents: 13600,
  ships: 'Feb 2027',
  status: 'reserved',
  startsOn: null,
  cancellable: true,
  ...over,
});

describe('On order, as it reads', () => {
  test('money, names and the line under each', () => {
    expect(usd(104000)).toBe('$1,040.00');
    expect(usd(900)).toBe('$9.00');
    expect(lineName(line())).toBe('4 × Clear Point, Table');
    expect(lineName(line({ qty: 1 }))).toBe('Clear Point, Table');
    expect(lineDet(line())).toBe('Deposit $220.00 paid · $136.00 when it ships · Feb 2027, estimated');
    expect(lineDet(line({ status: 'building', startsOn: '2026-10-19' }))).toBe('Deposit $220.00 paid · $136.00 when it ships · building starts Oct 19');
    expect(lineDet(line({ status: 'refunded', cancellable: false }))).toBe('Deposit $220.00 refunded');
    expect(lineDet(line({ status: 'shipped', cancellable: false }))).toBe('Paid in full · $356.00');
  });
  test('the chip says where it stands, and only open lines count as on order', () => {
    expect(statusChip(line()).text).toBe('Reserved');
    expect(statusChip(line({ status: 'building' })).text).toBe('Building');
    expect(statusChip(line({ status: 'awaiting-payment' })).text).toBe('Invoice sent');
    expect(statusChip(line({ status: 'refunded' })).text).toBe('Cancelled');
    const orders = [{ id: 'pi_1', placedAt: '2026-10-16T00:00:00Z', lines: [line(), line({ n: 2, status: 'shipped' }), line({ n: 3, status: 'refunded' })] }];
    expect(openLines(orders).map((l) => l.n)).toEqual([1]);
  });
});

describe('the preview’s On order (Mi Casa)', () => {
  test('lists the reservation, and Cancel refunds a line once', async () => {
    const api = createMockMerchantApi({ shop: 'micasa', delayMs: 0 }).api;
    const before = await api.hardwareOrders();
    expect(before.orders[0].lines.map((l) => [l.name, l.status, l.cancellable])).toEqual([
      ['Clear Point, Table', 'reserved', true],
      ['Clear Tap, With an M2', 'building', true],
    ]);
    const after = await api.cancelHardwareOrder('pi_micasa_reserve', 1);
    expect(after.orders[0].lines[0]).toMatchObject({ status: 'refunded', cancellable: false });
    await expect(api.cancelHardwareOrder('pi_micasa_reserve', 1)).rejects.toBeTruthy();
  });
});
