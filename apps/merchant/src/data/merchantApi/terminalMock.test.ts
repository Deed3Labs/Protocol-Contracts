import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from './mock';

/** The mock at Mi Casa's dinner draws what the terminal reference draws. */
const dinner = () => createMockMerchantApi({ shop: 'micasa', calls: 'open', delayMs: 0 }).api;

describe('Mi Casa Tacos at dinner', () => {
  test('the floor: who is where, and what each tab comes to', async () => {
    const f = await dinner().floor();
    const tile = (n: number) => f.tables.find((t) => t.number === n)!;
    expect(f.tables.map((t) => t.number)).toEqual([1, 2, 4, 6, 7, 9, 12, 14]);
    expect([1, 2, 4, 6, 7, 9, 12, 14].map((n) => tile(n).status)).toEqual(['free', 'ordering', 'bill_sent', 'held', 'seated', 'paid', 'bill_sent', 'free']);
    expect([2, 4, 7, 9, 12].map((n) => tile(n).tabCents)).toEqual([3150, 6200, null, 2740, 4820]);
    expect(tile(6).hold).toMatchObject({ partyName: 'Ana', showName: true });
    expect(tile(12).request).toMatchObject({ kind: 'call', state: 'open' });
    expect(f.waitlist.quotedMinutes).toBe(15);
    expect(f.waitlist.parties.map((p) => [p.name, p.state])).toEqual([
      ['Ana', 'seated'],
      ['Lee', 'waiting'],
      ['Marco', 'waiting'],
      ['Priya', 'waiting'],
    ]);
  });

  test('the devices, and what Table 12 shows', async () => {
    const devices = await dinner().hardware();
    expect(devices.map((d) => d.name)).toEqual(['Counter', 'Table 12', 'Table 14', 'Door', 'Clear Drawer', 'Counter printer', 'Kitchen']);
    const t12 = devices.find((d) => d.name === 'Table 12')!;
    expect(t12.kind === 'point' && t12.showing.kind).toBe('called');
    const drawer = devices.find((d) => d.kind === 'drawer')!;
    expect(drawer.kind === 'drawer' && drawer.status.opensToday).toBe(23);
  });

  test('the drawer today, and order 0142 at the reference’s one tax rate', async () => {
    const api = dinner();
    expect(await api.drawerDay('any')).toMatchObject({
      opens: 23,
      withSale: 21,
      noSales: [{ reason: 'change_for_note' }, { reason: 'counting' }],
      withKey: [{ orderNumber: 142 }],
    });
    const lunch = await api.orders({ date: '2026-10-15' });
    const o142 = lunch.find((o) => o.number === 142)!;
    expect(o142).toMatchObject({
      taxCents: 351,
      totalCents: 4576,
      status: 'paid',
      serviceType: 'to_go',
    });
  });

  test('seating Lee holds 14 and sends Table ready to the door', async () => {
    const api = dinner();
    const lee = (await api.waitlist()).parties.find((p) => p.name === 'Lee')!;
    const seated = await api.seatParty(lee.id, {
      tableId: 'tbl_14',
      showName: true,
      text: true,
    });
    expect(seated.table).toMatchObject({
      status: 'held',
      hold: { partyName: 'Lee' },
    });
    const door = (await api.hardware()).find((d) => d.name === 'Door')!;
    expect(door.kind === 'point' && door.showing.kind).toBe('alert');
  });
});
