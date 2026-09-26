import { describe, expect, test } from 'bun:test';
import type { CardDeposit } from '@clear/merchant-contracts';
import { everyChargeCsv, everyPayoutCsv, PAYOUT_HEADER, since, windows } from './yourData';

describe('Your data', () => {
  test('the history in windows of 93 days at most, with nothing missed or read twice', () => {
    const w = windows('2026-01-01', '2026-09-26');
    expect(w[0]).toEqual({ from: '2026-01-01', to: '2026-04-03' });
    expect(w.at(-1)!.to).toBe('2026-09-26');
    for (let i = 1; i < w.length; i++) expect(new Date(`${w[i]!.from}T00:00:00Z`).getTime() - new Date(`${w[i - 1]!.to}T00:00:00Z`).getTime()).toBe(86_400_000);
    expect(windows('2026-09-26', '2026-09-26')).toEqual([{ from: '2026-09-26', to: '2026-09-26' }]);
  });

  test('from the day the shop joined, or a year back when that isn’t known', () => {
    expect(since('2026-08-11T17:00:00Z', '2026-09-26')).toBe('2026-08-11');
    expect(since(null, '2026-09-26')).toBe('2025-09-26');
    expect(since('someday', '2026-09-26')).toBe('2025-09-26');
  });

  test('every charge: each window asked once, Clear charges before the start left out', async () => {
    const asked: string[] = [];
    const csv = await everyChargeCsv({
      from: '2026-01-01',
      to: '2026-06-30',
      history: async (r) => (asked.push(`${r.from}..${r.to}`), []),
      clear: async () => [
        { code: 'CLR-OLD', amount: 10, state: 'approved', createdAt: '2025-12-31T18:00:00Z', memberName: 'A', raisedBy: 'Jen' },
        { code: 'CLR-NEW', amount: 12.5, state: 'approved', createdAt: '2026-03-02T18:00:00Z', memberName: 'Dana', raisedBy: 'Jen' },
      ] as never,
      nameOf: () => '—',
    });
    expect(asked).toEqual(['2026-01-01..2026-04-03', '2026-04-04..2026-06-30']);
    expect(csv).toContain('CLR-NEW');
    expect(csv).not.toContain('CLR-OLD');
  });

  test('every payout: Clear’s and the card deposits, oldest first, fees where they’re known', () => {
    const deposit = { id: 'dep_1', shop: '0x1', externalPayoutId: 'po_123', arrivalDate: '2026-09-03', grossCents: 50000, processorFeeCents: 1495, clearFeeCents: 300, netCents: 48205, chargeCount: 4, status: 'in_transit' } as CardDeposit;
    const csv = everyPayoutCsv({ clear: [{ id: 'pay_1', amountCents: 181891, charges: 12, on: '2026-09-14', paidAt: '2026-09-14T16:00:00Z' }], deposits: [deposit] });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(PAYOUT_HEADER.join(','));
    expect(lines[1]).toBe('2026-09-03,Card deposit,po_123,4,500.00,14.95,3.00,482.05,in transit');
    expect(lines[2]).toBe('2026-09-14,Clear payout,pay_1,12,1818.91,,,1818.91,paid');
  });
});
