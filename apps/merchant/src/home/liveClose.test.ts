import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { REFERENCE_DAY, STAFF_ID } from '../data/merchantApi/seed';
import { closeDayFrom, closedSummary } from './liveClose';

describe('Close the day, from the merchant API', () => {
  test('the reference day: by method, the drawer short $4 signed off, cash tips out, $53 to the bank', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0, drawer: 'short', viewer: STAFF_ID.mike });
    const s = (await api.drawer())!;
    const load = async () => ({
      session: s,
      view: await api.counts(s.id),
      overview: await api.overview({ from: REFERENCE_DAY, to: REFERENCE_DAY }),
      orders: await api.orders({ date: REFERENCE_DAY }),
      settings: await api.settings(),
      staff: await api.staff(),
      audit: await api.audit({ from: REFERENCE_DAY, to: REFERENCE_DAY }),
    });
    const before = closeDayFrom(await load())!;
    expect(before.day).toMatchObject({ takenCents: 189952, clear: { n: 3, cents: 90000 }, card: { n: 1, cents: 93752 }, cash: { n: 2, cents: 6200 }, tipsCents: 1500, waiting: { n: 2, cents: 135000 } });
    expect(before.drawer).toMatchObject({ expectedCents: 21200, countedCents: 20800, counters: ['Luis M.', 'Mike R.'], leaveCents: 15000 });
    expect(before.drawer.signed).toBeUndefined();
    expect(before.drawer.tips).toEqual([
      { name: 'Luis M.', cents: 500, how: 'cash' },
      { name: 'Jen R.', cents: 1000, how: 'card' },
    ]);

    await api.signOff(s.id, { note: 'Change error', pin: '9999' });
    const signed = closeDayFrom(await load())!;
    expect(signed.drawer).toMatchObject({ signed: { name: 'Mike R.' }, note: 'Change error' });

    const closed = await api.closeDay(s.id);
    expect(closedSummary(closed).rows).toContainEqual(['To the bank', '$53.00']);
    expect(closedSummary(closed).rows).toContainEqual(['Drawer', 'Counted $208.00, $4.00 short']);
  });

  test('nothing to show before the two counts agree', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0, drawer: 'disagree' });
    const s = (await api.drawer())!;
    const got = closeDayFrom({ session: s, view: await api.counts(s.id), overview: await api.overview({ from: REFERENCE_DAY, to: REFERENCE_DAY }), orders: [], settings: null, staff: [], audit: [] });
    expect(got).toBeNull();
  });
});
