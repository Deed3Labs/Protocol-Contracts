import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dollars, money, orderNo, phoneRoute, pollMs } from './format';

const here = import.meta.dirname;
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

describe('the phone pages', () => {
  test('a Point code and a receipt code each find their page, and nothing else does', () => {
    expect(phoneRoute('/p/A7K2')).toEqual({ page: 'point', code: 'A7K2' });
    expect(phoneRoute('/p/a7k2/')).toEqual({ page: 'point', code: 'A7K2' });
    expect(phoneRoute('/r/K7Q2M9XH4P')).toEqual({ page: 'receipt', code: 'K7Q2M9XH4P' });
    expect(phoneRoute('/p/')).toBeNull();
    expect(phoneRoute('/p/A7K2/menu')).toBeNull();
    expect(phoneRoute('/pay/A7K2')).toBeNull();
  });

  test('figures as drawn: 18.00 on a line, $48.20 as a total, order 0142', () => {
    expect(money(1800)).toBe('18.00');
    expect(dollars(4820)).toBe('$48.20');
    expect(dollars(123456)).toBe('$1,234.56');
    expect(orderNo(142)).toBe('0142');
  });

  test('a bill is followed closely, everything else slowly, and a paid page stops', () => {
    expect(pollMs('bill')).toBe(4_000);
    expect(pollMs('menu')).toBe(15_000);
    expect(pollMs(null)).toBe(15_000);
    expect(pollMs('paid')).toBeNull();
  });

  test('no wallet, sign-in or app code comes with them', () => {
    const files = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));
    for (const f of files) {
      for (const [, spec] of read(f).matchAll(/from '([^']+)'/g)) {
        expect(spec!.startsWith('./') || spec === 'react' || spec === 'react-dom/client').toBe(true);
      }
    }
  });

  test('calls are never cached and carry no cookies', () => {
    const api = read('api.ts');
    expect(api).toContain("cache: 'no-store'");
    expect(api).toContain("credentials: 'omit'");
  });

  test('Vercel serves the phone entry before the app catches every path', () => {
    const { rewrites } = JSON.parse(read('..', '..', 'vercel.json')) as { rewrites: { source: string; destination: string }[] };
    expect(rewrites.slice(0, 2)).toEqual([
      { source: '/p/(.*)', destination: '/phone.html' },
      { source: '/r/(.*)', destination: '/phone.html' },
    ]);
    expect(rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
  });

  test('the service worker never keeps a bill or a receipt', () => {
    const sw = read('..', '..', 'public', 'sw.js');
    expect(sw).toMatch(/if \(isPhonePageAPI\(url\)\) \{\s*event\.respondWith\(networkOnly\(request\)\);/);
  });
});
