import { describe, expect, test } from 'bun:test';
import type { MerchantCharge } from '@/data/apiClient';
import { fromApi, REFERENCE } from './model';

const now = new Date(2026, 8, 22, 15, 0);
const charge = (over: Partial<MerchantCharge>): MerchantCharge => ({
  code: Math.random().toString(36).slice(2),
  amount: 100,
  payout: 98,
  state: 'approved',
  splitInto: 1,
  memberName: 'A. Member',
  raisedBy: 'Jen R.',
  raisedByStaffId: 's_jen',
  createdAt: new Date(2026, 8, 10).toISOString(),
  expiresAt: new Date(2026, 8, 11).toISOString(),
  openedAt: null,
  resolvedAt: null,
  ...over,
});

describe('the month, from the API', () => {
  test('counts this month, compares it with last, and splits the fees by plan', () => {
    const m = fromApi({
      now,
      position: null,
      profile: null,
      staff: null,
      charges: [
        charge({ amount: 412, payout: 403.76, splitInto: 4 }),
        charge({ amount: 188, payout: 185.65, raisedBy: 'Luis M.' }),
        charge({ amount: 300, payout: 294, splitInto: 2, raisedBy: 'Jen R.' }),
        charge({ amount: 1240, createdAt: new Date(2026, 7, 20).toISOString() }),
      ],
    });
    expect([m.month, m.monthCents, m.count, m.avgCents]).toEqual(['September', 90000, 3, 30000]);
    expect(m.vs).toEqual({ cents: 90000 - 124000, prev: 'August' });
    expect(m.fees.map((f) => f.cents)).toEqual([235, 1424]);
    expect(m.tip?.fact).toBe('Jen has raised 2 of this month’s 3 charges');
    expect(m.months.map((x) => [x.t, x.cents])).toEqual([
      ['Aug 2026', 124000],
      ['Sep 2026', 90000],
    ]);
  });

  test('the reference month adds up: Clear, card and cash make the month', () => {
    const p = REFERENCE.more!.paid;
    expect(p.clear[1] + p.card[1] + p.cash[1]).toBe(REFERENCE.monthCents);
    expect(Math.round(REFERENCE.monthCents / REFERENCE.count)).toBe(REFERENCE.avgCents);
  });
});
