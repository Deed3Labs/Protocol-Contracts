import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { REFERENCE_DAY, STAFF, STAFF_ID } from '../data/merchantApi/seed';
import { liveMonth } from './live';
import { fromApi } from './model';

describe('Overview from the merchant API', () => {
  test('the month across Clear, card and cash; the second slab; card processing; the close', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0, drawer: 'closed', viewer: STAFF_ID.mike });
    const range = { from: '2026-09-01', to: '2026-09-30' };
    const base = fromApi({ charges: [], position: null, profile: null, staff: null, now: new Date(`${REFERENCE_DAY}T17:00:00-07:00`) });
    const m = liveMonth(base, {
      month: await api.overview(range),
      prev: null,
      deposits: await api.cardDeposits(range),
      orders: await api.orders({ date: REFERENCE_DAY }),
      nameOf: (id) => STAFF.find((s) => s.id === id)?.name ?? '—',
      today: REFERENCE_DAY,
      monthName: 'September',
    });
    // Ray's $1,240 (Sep 21) and the reference day's paid sales.
    expect(m.monthCents).toBe(124000 + 41200 + 18800 + 30000 + 93752 + 2300 + 3900);
    expect(m.more!.paid).toMatchObject({ clear: [4, 214000], card: [1, 93752], cash: [2, 6200] });
    expect(m.more!.tips).toBe('$15.00 · Luis $5.00, Jen $10.00');
    expect(m.more!.eod).toEqual([{ date: 'Tue, Sep 22', det: '6 charges · closed by Mike', cents: 189952, state: 'Short $4.00 · signed off' }]);
    expect(m.fees.at(-1)).toEqual({ t: 'Card processing', det: 'Processor $25.36 · Clear $0.30', cents: 2566 });
    // Recent: the day's sales, the waiting ones marked.
    expect(m.recent.filter((r) => r.state === 'waiting').map((r) => r.name).sort()).toEqual(['Dana R.', 'Nina P.']);
  });
});
