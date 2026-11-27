import { describe, expect, test } from 'bun:test';
import { merchantFeesThisMonth } from './sections.js';

/* Money → Pools → Yield pool, "Where member payments go": the merchant fees on this month's financed sales, from the
   charges themselves (amount less the shop's payout), never a rate written into the page. */

describe('merchantFeesThisMonth', () => {
  test('sums this month’s financed charges and what the shops gave up on them', async () => {
    const asked: Array<{ sql: string; params: unknown[] }> = [];
    const charges = {
      query: async (sql: string, params: unknown[] = []) => {
        asked.push({ sql, params });
        return { rows: [{ financed: '1068920', fees: '26723', n: '14' }] };
      },
    };
    const r = await merchantFeesThisMonth(charges as never, new Date('2026-11-18T12:00:00Z'));
    expect(r).toEqual({ financed: 10689.2, fees: 267.23, count: 14 });
    // the month, in UTC; only charges that went through on a plan, not paid now
    expect(asked[0].params).toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
    expect(asked[0].sql).toContain("status = 'approved' AND plan_id IS NOT NULL AND coalesce(paid_now, false) = false");
    expect(asked[0].sql).toContain('sum(amount_cents - payout_cents)');
  });

  test('nothing financed is zeros, not a gap', async () => {
    const charges = { query: async () => ({ rows: [{ financed: 0, fees: 0, n: 0 }] }) };
    expect(await merchantFeesThisMonth(charges as never, new Date('2026-11-18T12:00:00Z'))).toEqual({ financed: 0, fees: 0, count: 0 });
  });
});

describe('unsecuredOf', () => {
  test('counts what’s drawn in tiers no pledge backs, and the term plans', async () => {
    const { unsecuredOf } = await import('./sections.js');
    const rates = { tiers: [{ name: 'Savings', out: 500 }, { name: 'Bond', out: 120 }, { name: 'Pool share', out: 80 }, { name: 'Income', out: 260.5 }, { name: 'Boost', out: 124 }, { name: 'WORKOUT', out: 10 }], term: { out: 300 } };
    expect(unsecuredOf(rates, 1394.5)).toBe(694.5);
  });
  test('with the issuers unread, all of it counts', async () => {
    const { unsecuredOf } = await import('./sections.js');
    expect(unsecuredOf(null, 812.25)).toBe(812.25);
  });
});
