import { describe, expect, test } from 'bun:test';
import type { Overview } from '@clear/merchant-contracts';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { STAFF } from '../data/merchantApi/seed';
import { field, HEADER, salesCsv } from './exportCsv';
import { statementOf } from './statement';

process.env.TZ = 'America/Los_Angeles';

describe('the month as a spreadsheet', () => {
  test('fields with commas, quotes or line breaks are quoted', () => {
    expect(field('Tires, brakes')).toBe('"Tires, brakes"');
    expect(field('17" rim')).toBe('"17"" rim"');
    expect(field('plain')).toBe('plain');
    expect(field(null)).toBe('');
  });

  test('a row a sale, every way it was paid, oldest first; open orders left out', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const orders = await api.orderHistory({ from: '2026-09-01', to: '2026-09-22' });
    const csv = salesCsv({ orders, nameOf: (id) => STAFF.find((s) => s.id === id)?.name ?? '—' });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER.join(','));
    const sold = orders.filter((o) => o.status !== 'open');
    expect(lines).toHaveLength(sold.length + 1);
    // Oldest first.
    const dates = lines.slice(1).map((l) => l.split(',')[0]!);
    expect([...dates].sort()).toEqual(dates);
    // Who raised it, by name, and the ways it was paid.
    expect(csv).toMatch(/Jen R\.|Luis M\.|Mike R\./);
    expect(csv).toMatch(/Card|Cash|Clear/);
  });

  test('a Clear charge with no order behind it is its own row, once', () => {
    const csv = salesCsv({
      orders: [],
      clear: [
        { code: 'AB12', amount: 94, state: 'approved', createdAt: '2026-09-03T17:00:00.000Z', memberName: 'Dana R.', raisedBy: 'Jen R.' } as never,
        { code: 'CD34', amount: 20, state: 'expired', createdAt: '2026-09-04T17:00:00.000Z', memberName: 'Tom', raisedBy: 'Jen R.' } as never,
      ],
      nameOf: () => '—',
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('AB12,Dana R.,Jen R.,paid');
    expect(lines[1]).toContain('Clear 94.00');
  });
});

describe('a month’s statement', () => {
  const overview: Overview = {
    from: '2026-08-01',
    to: '2026-08-31',
    takenCents: 318204,
    orderCount: 22,
    byMethod: { clear: { count: 10, cents: 200000 }, card: { count: 9, cents: 100000 }, cash: { count: 3, cents: 18204 } },
    discounts: { count: 2, cents: 3000 },
    tips: { cents: 4500, byStaff: [{ staffId: 's1', name: 'Jen R.', cents: 4500, cashCents: 1000 }] },
    taxCents: 12000,
    refundsCents: 5000,
    topItems: [],
    dayReports: [],
  };

  test('sales, what came off them, and card deposits', () => {
    const s = statementOf({
      shop: 'Mike’s Tire',
      month: 'August 2026',
      from: '2026-08-01',
      to: '2026-08-31',
      inProgress: false,
      overview,
      deposits: [{ id: 'd', shop: 'x', externalPayoutId: 'po', arrivalDate: '2026-08-12', grossCents: 100000, processorFeeCents: 2930, clearFeeCents: 270, netCents: 96800, chargeCount: 9, status: 'paid' }],
    });
    expect(s.period).toBe('Aug 1 – 31, 2026');
    expect(s.sections.map((x) => x.title)).toEqual(['Sales', 'On those sales', 'Card deposits', 'Tips by person', 'Days']);
    expect(s.sections[0]!.rows).toEqual([
      ['Taken · 22 sales', 318204],
      ['Clear · 10 sales', 200000],
      ['Card · 9 sales', 100000],
      ['Cash · 3 sales', 18204],
    ]);
    expect(s.sections[2]!.rows.at(-1)).toEqual(['To your bank', 96800]);
  });

  test('no card deposits, no card section', () => {
    const s = statementOf({ shop: 'x', month: 'x', from: '2026-09-01', to: '2026-09-22', inProgress: true, overview, deposits: [] });
    expect(s.sections.some((x) => x.title === 'Card deposits')).toBe(false);
    expect(s.period).toBe('Sep 1 – 22, 2026');
  });
});
