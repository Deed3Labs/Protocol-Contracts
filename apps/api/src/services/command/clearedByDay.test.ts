import { describe, expect, test } from 'bun:test';
import { clearedByDay } from './sections.js';

/* Merchants → a shop's panel: the reference's last 14 days, a bar a day, from the shop's approved Clear charges. */
describe('clearedByDay', () => {
  const now = Date.UTC(2026, 10, 18, 15);
  const day = (d: number) => Date.UTC(2026, 10, d) / 864e5;
  test('a bar a day, oldest first, today last; days outside the window are dropped', async () => {
    const asked: unknown[][] = [];
    const charges = {
      query: async (_sql: string, params: unknown[]) => {
        asked.push(params);
        return { rows: [{ merchant: '0xa', day: day(18), cents: 1250 }, { merchant: '0xa', day: day(5), cents: 990 }, { merchant: '0xb', day: day(4), cents: 100 }, { merchant: '0xb', day: day(3), cents: 7 }] };
      },
    };
    const r = await clearedByDay(charges as never, ['0xa', '0xb'], now, 14);
    expect(r['0xa']).toHaveLength(14);
    expect(r['0xa'][13]).toBe(12.5);
    expect(r['0xa'][0]).toBe(9.9);
    expect(r['0xb']).toBeUndefined();
    expect(asked[0][1]).toBe('2026-11-05T00:00:00.000Z');
  });
  test('no shops, no query', async () => {
    let n = 0;
    expect(await clearedByDay({ query: async () => ((n += 1), { rows: [] }) } as never, [], now, 14)).toEqual({});
    expect(n).toBe(0);
  });
});
