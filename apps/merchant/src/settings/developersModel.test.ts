import { describe, expect, test } from 'bun:test';
import type { DevelopersView } from '@clear/merchant-contracts';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { deliveryRow, endpointCheck, endpointsHead, forMode, keyShown, publishableDet, secretDet, siteCheck, siteRow, sitesHead } from './developersModel';

const NOW = '2026-10-16T20:00:00.000Z'; // 1pm in Redlands
const LA = 'America/Los_Angeles';
const drawn = async (): Promise<DevelopersView> => {
  const m = createMockMerchantApi({ shop: 'micasa', delayMs: 0, now: () => NOW });
  return m.api.developers();
};

describe('Settings › Developers, as drawn (pay spec §6)', () => {
  test('the keys read as the spec draws them', async () => {
    const live = forMode(await drawn(), true, NOW);
    expect(keyShown(live.publishable!)).toBe('pk_live_mc8Q2v…');
    expect(publishableDet(live.publishable!)).toBe('pk_live_mc8Q2v… · safe in a web page');
    expect(keyShown(live.secret!)).toBe('sk_live_…9fA2');
    expect(secretDet(live.secret!)).toBe('sk_live_…9fA2 · server only. Shown once when made');
  });
  test('the websites, by host, with when they were added', async () => {
    const v = await drawn();
    expect(sitesHead(v.sites.length)).toBe('2');
    expect(v.sites.map((s) => siteRow(s, LA))).toEqual([
      { t: 'micasatacos.com', det: 'Added Oct 12' },
      { t: 'order.micasatacos.com', det: 'Added Oct 14' },
    ]);
    expect(siteRow({ origin: 'http://localhost:3000', addedAt: NOW, addedBy: null, testOnly: true }, LA).det).toBe('Added Oct 16 · test keys only');
  });
  test('the endpoint and its three deliveries, today in shop time', async () => {
    const live = forMode(await drawn(), true, NOW);
    expect(endpointsHead(live.endpoints.length)).toBe('1 endpoint');
    expect(live.endpoints[0]).toMatchObject({ url: 'https://micasatacos.com/clear/webhook', events: ['payment.succeeded', 'payment.failed', 'refund.succeeded'], health: 'healthy' });
    expect(live.deliveries.map((d) => deliveryRow(d, NOW, LA))).toEqual([
      { k: 'payment.succeeded · catering-1042 · 10:42am', v: '200', ok: true },
      { k: 'payment.succeeded · catering-1041 · 9:15am', v: '200', ok: true },
      { k: 'payment.failed · catering-1040 · 9:02am', v: '200', ok: true },
    ]);
  });
  test('Test shows the test keys and none of the live endpoints or deliveries', async () => {
    const test = forMode(await drawn(), false, NOW);
    expect(keyShown(test.publishable!)).toMatch(/^pk_test_[0-9A-Za-z]{6}…$/);
    expect(test.secret?.livemode).toBe(false);
    expect(test.endpoints).toEqual([]);
    expect(test.deliveries).toEqual([]);
    expect(endpointsHead(0)).toBe('—');
  });
  test('another day’s delivery says its date; an unreachable one a dash', () => {
    const row = deliveryRow(
      { id: 'd', endpointId: 'we_1', eventId: 'evt_1', eventType: 'refund.succeeded', reference: null, status: 'failed', attempts: 3, responseCode: null, at: '2026-10-15T17:42:00.000Z', nextAttemptAt: null },
      NOW,
      LA,
    );
    expect(row).toEqual({ k: 'refund.succeeded · Oct 15, 10:42am', v: '—', ok: false });
  });
});

describe('Add a site and Add an endpoint check as they’re typed', () => {
  test('a site', () => {
    expect(siteCheck('')).toEqual({ ok: false, reason: null });
    expect(siteCheck('micasatacos.com')).toEqual({ ok: true, origin: 'https://micasatacos.com', note: null });
    expect(siteCheck('http://micasatacos.com')).toEqual({ ok: false, reason: 'Pay with Clear only opens on https websites' });
    expect(siteCheck('http://localhost:3000')).toMatchObject({ ok: true, origin: 'http://localhost:3000', note: expect.stringContaining('Test keys only') });
  });
  test('an endpoint', () => {
    expect(endpointCheck('', ['payment.succeeded'], true)).toEqual({ ok: false, reason: null });
    expect(endpointCheck('http://micasatacos.com/hook', ['payment.succeeded'], true)).toMatchObject({ ok: false });
    expect(endpointCheck('https://micasatacos.com/hook', [], true)).toEqual({ ok: false, reason: 'Choose at least one event' });
    expect(endpointCheck('https://micasatacos.com/hook', ['refund.succeeded', 'payment.succeeded'], false)).toEqual({
      ok: true,
      request: { url: 'https://micasatacos.com/hook', events: ['payment.succeeded', 'refund.succeeded'], livemode: false },
    });
  });
});
