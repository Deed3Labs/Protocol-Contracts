import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from './mock';
import { slugBase } from './payMock';

const NOW = '2026-10-16T17:40:00.000Z';
const miCasa = (as: string) => {
  const m = createMockMerchantApi({ shop: 'micasa', delayMs: 0, now: () => NOW });
  m.controls.setViewer(as);
  return m;
};
const tray = { for: 'item' as const, itemId: 'itm_tray12', quantity: 1, note: 'Saturday pickup, 11:30am', expires: '7d' as const, allowOverTime: true };

describe('Send a link, in the mock (pay spec §5)', () => {
  test('the taco tray for 12 is $161.48 with tax, for 7 days, at micasa-…', async () => {
    const { api } = miCasa('stf_mike');
    const link = await api.createPaymentLink(tray);
    expect(link).toMatchObject({ name: 'Taco tray for 12', totalCents: 16148, note: 'Saturday pickup, 11:30am', expiresAt: '2026-10-23T17:40:00.000Z', active: true });
    expect(link.url).toMatch(/^https:\/\/pay\.useclear\.org\/l\/micasa-[a-z0-9]{6}$/);
    expect(await api.paymentLinks()).toEqual([link]);
    expect((await api.deactivatePaymentLink(link.id)).active).toBe(false);
  });
  test('an amount is what they pay', async () => {
    const { api } = miCasa('stf_luis');
    expect(await api.createPaymentLink({ for: 'amount', amountCents: 2500, note: null, expires: 'never', allowOverTime: false })).toMatchObject({ name: 'Payment', totalCents: 2500, expiresAt: null });
  });
  test('the counter can’t make one', async () => {
    const { api } = miCasa('stf_jen');
    await expect(api.createPaymentLink(tray)).rejects.toMatchObject({ status: 403 });
  });
  test('a shop’s everyday name', () => {
    expect(slugBase('Mi Casa Tacos')).toBe('micasa');
    expect(slugBase('Mike’s Tire')).toBe('mikestire');
  });
});
