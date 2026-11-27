import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { runningLowFrom, tillFromSetup } from './model';

const none = { stripe: false, reader: false, items: false, team: [], cash: false, tips: false };

describe('set up the till', () => {
  test('rows follow the shop, and the team names who was added', () => {
    const rows = tillFromSetup({ ...none, items: true, team: ['Jen R.', 'Luis M.'] })!;
    expect(rows.map((r) => [r.key, !!r.done])).toEqual([
      ['stripe', false],
      ['reader', false],
      ['items', true],
      ['team', true],
      ['cash', false],
      ['tips', false],
    ]);
    expect(rows.find((r) => r.key === 'team')!.det).toBe('Jen and Luis, added');
    expect(tillFromSetup(none)!.find((r) => r.key === 'team')!.det).toBe('Counter staff and a manager');
  });

  test('gone once every step is done', () => {
    expect(tillFromSetup({ stripe: true, reader: true, items: true, team: ['Jen R.'], cash: true, tips: true })).toBeUndefined();
  });
});

describe('running low', () => {
  test('stocked items at or under their line, or out; services never', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const low = runningLowFrom(await api.catalog(), await api.reorders());
    expect(low.length).toBeGreaterThan(0);
    for (const i of low) expect(i.stock!.shelf).toBeLessThanOrEqual(i.stock!.reorderAt);
    expect(low.some((i) => i.kind === 'service')).toBe(false);
  });
});
