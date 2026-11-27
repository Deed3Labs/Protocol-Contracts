import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { beforeSend, sanitizePath, tracker } from './analytics';

/*
 * The merchant app's Umami: what an address looks like when it leaves, which tracker and id it accepts,
 * and that page views are only counted on shift and never on a customer's receipt.
 */

const ID = '22222222-2222-4222-8222-222222222222';

describe('analytics', () => {
  test('ids never leave in an address', () => {
    expect(sanitizePath('/charges/ch_8f2a')).toBe('/charges/:id');
    expect(sanitizePath('/charges/ch_8f2a/refund')).toBe('/charges/:id/refund');
    expect(sanitizePath('/payouts/po_1')).toBe('/payouts/:id');
    expect(sanitizePath('/inventory/12')).toBe('/inventory/:id');
    expect(sanitizePath('/inventory/12/variants')).toBe('/inventory/:id/:sub');
    expect(sanitizePath('/r/8QK2')).toBe('/r/:token');
    expect(sanitizePath('/charges?q=kai')).toBe('/charges');
    expect(sanitizePath('/new')).toBe('/new');
  });

  test('every event leaves without its query, hash or title', () => {
    const out = beforeSend('pageview', { url: 'https://merchant.useclear.org/charges/ch_1?x=1#y', title: 'Rosa’s Panadería' });
    expect(out).toEqual({ url: 'https://merchant.useclear.org/charges/:id', title: 'Clear for shops' });
  });

  test('the tracker only from an https .js address, the id only as a uuid', () => {
    expect(tracker('https://umami.useclear.org/script.js', ID)).toEqual({ src: 'https://umami.useclear.org/script.js', id: ID });
    expect(tracker('https://umami.useclear.org/script.js', 'nope')).toBeNull();
    expect(tracker('http://umami.useclear.org/script.js', ID)).toBeNull();
  });

  test('page views on shift only, and no tracker on a receipt', () => {
    const shell = readFileSync(new URL('../shell/AppShell.tsx', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('usePageViews()');
    expect(main).toMatch(/if \(!\/\^\\\/r\\\/\/\.test\(window\.location\.pathname\)\) initAnalytics\(\)/);
  });
});
