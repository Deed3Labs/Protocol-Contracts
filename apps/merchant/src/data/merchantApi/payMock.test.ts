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

describe('Settings › Developers, in the mock (pay spec §6)', () => {
  test('the counter is refused; a manager and the owner are not', async () => {
    await expect(miCasa('stf_jen').api.developers()).rejects.toMatchObject({ status: 403 });
    await expect(miCasa('stf_jen').api.addSite({ site: 'example.com' })).rejects.toMatchObject({ status: 403 });
    expect((await miCasa('stf_luis').api.developers()).sites).toHaveLength(2);
    expect((await miCasa('stf_mike').api.developers()).ai).toMatchObject({ llmsUrl: 'https://useclear.org/llms.txt', mcpUrl: 'https://useclear.org/docs/mcp.md' });
  });
  test('the paste-in prompt carries the live publishable key', async () => {
    const v = await miCasa('stf_mike').api.developers();
    const pk = v.keys.find((k) => k.kind === 'publishable' && k.livemode)!.token!;
    expect(pk).toMatch(/^clear_pk_live_mc8Q2v[0-9A-Za-z]{18}$/);
    expect(v.ai.prompt).toContain(`Use publishable key ${pk}.`);
  });
  test('rolling shows a new secret once and keeps the old one 24 hours', async () => {
    const { api } = miCasa('stf_luis');
    const old = (await api.developers()).keys.find((k) => k.kind === 'secret' && k.livemode)!;
    const made = await api.rollSecretKey(old.id);
    expect(made.secret).toMatch(/^clear_sk_live_[0-9A-Za-z]{24}$/);
    expect(made.key).toMatchObject({ kind: 'secret', livemode: true, token: null, last4: made.secret.slice(-4), rolledAt: null });
    const after = (await api.developers()).keys.filter((k) => k.kind === 'secret' && k.livemode);
    expect(after.find((k) => k.id === old.id)).toMatchObject({ rolledAt: NOW, expiresAt: '2026-10-17T17:40:00.000Z' });
    await expect(api.rollSecretKey(old.id)).rejects.toMatchObject({ status: 409 });
  });
  test('keys are made once per mode', async () => {
    const m = createMockMerchantApi({ delayMs: 0, now: () => NOW });
    const made = await m.api.createKeys(false);
    expect(made.secret).toMatch(/^clear_sk_test_[0-9A-Za-z]{24}$/);
    expect((await m.api.developers()).keys.map((k) => k.kind)).toEqual(['publishable', 'secret']);
    await expect(m.api.createKeys(false)).rejects.toMatchObject({ status: 409 });
  });
  test('websites: checked, never twice, removed', async () => {
    const { api } = miCasa('stf_mike');
    await expect(api.addSite({ site: 'micasatacos.com' })).rejects.toMatchObject({ status: 409 });
    await expect(api.addSite({ site: 'http://micasatacos.com' })).rejects.toMatchObject({ status: 422 });
    expect(await api.addSite({ site: 'http://localhost:5173/checkout' })).toMatchObject({ origin: 'http://localhost:5173', testOnly: true });
    await api.removeSite('https://order.micasatacos.com');
    expect((await api.developers()).sites.map((s) => s.origin)).toEqual(['https://micasatacos.com', 'http://localhost:5173']);
  });
  test('an endpoint: https, some events, its secret once', async () => {
    const { api } = miCasa('stf_mike');
    await expect(api.addWebhookEndpoint({ url: 'http://micasatacos.com/hook', events: ['payment.succeeded'], livemode: false })).rejects.toMatchObject({ status: 422 });
    await expect(api.addWebhookEndpoint({ url: 'https://micasatacos.com/hook', events: [], livemode: false })).rejects.toMatchObject({ status: 422 });
    const made = await api.addWebhookEndpoint({ url: 'https://micasatacos.com/hook', events: ['payment.succeeded'], livemode: false });
    expect(made.secret).toMatch(/^whsec_/);
    expect(made.endpoint).toMatchObject({ health: 'new', livemode: false });
    expect(made.endpoint).not.toHaveProperty('secret');
    await api.removeWebhookEndpoint('we_micasa1');
    const v = await api.developers();
    expect(v.endpoints.map((e) => e.id)).toEqual([made.endpoint.id]);
    expect(v.deliveries).toEqual([]);
  });
});
