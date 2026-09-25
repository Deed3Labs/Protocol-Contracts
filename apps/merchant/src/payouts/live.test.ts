import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { STAFF, STAFF_ID } from '../data/merchantApi/seed';
import { cardRows, drawerCash } from './live';

const range = { from: '2026-09-01', to: '2026-09-30' };
const nameOf = (id: string) => STAFF.find((s) => s.id === id)?.name ?? '—';

describe('Payouts from the merchant API', () => {
  test('the card deposit: $911.86 on Wed, Sep 23, after $25.66 (Stripe $25.36, Clear 30¢)', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const [row] = cardRows(await api.cardDeposits(range), 'Chase ••4417');
    expect(row).toMatchObject({ t: 'Wed, Sep 23', next: true, cents: 91186, card: { salesCents: 93752, stripeCents: 2536, clearCents: 30 } });
    expect(row!.det).toBe('1 charge, less $25.66 card processing · to Chase ••4417');
  });

  test('the drawer’s cash from the last close: $150 stays, $53 to the bank until marked, Jen’s card tip', async () => {
    const { api, controls } = createMockMerchantApi({ delayMs: 0, drawer: 'closed', viewer: STAFF_ID.mike });
    const d = drawerCash(await api.dayReports(range), await api.bankDeposits(), nameOf)!;
    expect(d).toMatchObject({ inDrawerCents: 15000, toBankCents: 5300, tipsCents: 1000, tipsWho: 'Jen, card tip, with the next payroll', from: 'From Tuesday’s close' });
    expect(d.deposited).toBeUndefined();
    controls.setViewer(STAFF_ID.mike);
    await api.markDeposited(d.depositId!);
    const after = drawerCash(await api.dayReports(range), await api.bankDeposits(), nameOf)!;
    expect(after.deposited).toMatch(/^Deposited .* by Mike$/);
    expect(after.depositId).toBeNull();
  });
});
