import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { REFERENCE_DAY, STAFF, STAFF_ID } from '../data/merchantApi/seed';
import { fromApi } from './model';

const staff = STAFF.map((s) => ({ ...s, chargesThisMonth: 0 }));
const nameOf = (id: string) => STAFF.find((s) => s.id === id)?.name ?? '—';

describe('Home from the day’s orders', () => {
  test('confirmed is every sale however paid: Clear, the card walk-in, both cash walk-ins', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const orders = await api.orders({ date: REFERENCE_DAY });
    const m = fromApi({ role: 'owner', staffId: STAFF_ID.mike, charges: [], position: null, staff, orders, nameOf });
    // Marcus $412, Priya $188, Ana V. $300 (Clear); $937.52 card; $23 and $39 cash.
    expect(m.confirmedCount).toBe(6);
    expect(m.confirmedCents).toBe(41200 + 18800 + 30000 + 93752 + 2300 + 3900);
    expect(m.confirmed.find((c) => c.amountCents === 93752)).toMatchObject({ by: 'Jen' });
    expect(m.byPerson?.find((p) => p.name === 'Jen R.')).toMatchObject({ confirmed: 3, waiting: 2 });
    expect(m.byPerson?.find((p) => p.name === 'Luis M.')).toMatchObject({ confirmed: 3, waiting: 0 });
  });

  test('a counter’s shift counts their own sales against the shop’s', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const orders = await api.orders({ date: REFERENCE_DAY });
    const m = fromApi({ role: 'counter', staffId: STAFF_ID.jen, charges: [], position: null, staff, orders, nameOf });
    expect(m.shift).toMatchObject({ raised: 5, shopRaised: 8 });
  });
});
