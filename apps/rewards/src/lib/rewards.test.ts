import { describe, expect, test } from 'bun:test';
import { earnPoints, type EarnRules } from '@clear/merchant-contracts';
import { scopeOf } from '../shell/scope';
import { shortName } from '../screens/parts';
import { FRAMES } from '../preview/frameList';
import { TABLE_6, SHOPS } from '../data/seed';

describe('the address decides the scope', () => {
  test('a shop’s own link is only that shop', () => {
    expect(scopeOf('/s/micasa')).toEqual({ mode: 'shop', slug: 'micasa', base: '/s/micasa' });
    expect(scopeOf('/s/micasa/rewards/rwd_agua')).toMatchObject({ mode: 'shop', slug: 'micasa' });
  });
  test('anything else is the hub; a shop inside it has its own base', () => {
    expect(scopeOf('/')).toEqual({ mode: 'hub', slug: null, base: '' });
    expect(scopeOf('/shops/la-bonita/you')).toEqual({ mode: 'hub', slug: 'la-bonita', base: '/shops/la-bonita' });
  });
});

describe('copy', () => {
  test('a shop’s everyday name', () => {
    expect(shortName('Mi Casa Tacos')).toBe('Mi Casa');
    expect(shortName('La Bonita Bakery')).toBe('La Bonita');
    expect(shortName('Mike’s Tire')).toBe('Mike’s Tire');
    expect(shortName('Peña Coffee')).toBe('Peña Coffee');
  });
});

describe('the preview seed keeps the spec’s figures', () => {
  test('section 3: $13.55 with the reward, $17.33 without (tax per line), 12 points', () => {
    expect(TABLE_6.lines.reduce((s, l) => s + l.lineCents, 0)).toBe(1600);
    expect(TABLE_6.withReward).toEqual({ discountCents: 350, taxCents: 105, totalCents: 1355, earnsPoints: 12 });
    expect(1600 - 350 + 105).toBe(1355);
    expect(TABLE_6.withoutReward.totalCents).toBe(1600 + 133);
    // Points count what's paid before tax, a point a dollar, on a Thursday: $12.50 and $16.00.
    const rules = { unit: 'dollars', pointsPer: 1, perAmountCents: 100, keepTheChange: true, clearMultiplier: 1, boosts: [], visitMinCents: 0 } as unknown as EarnRules;
    const earn = (netCents: number) => earnPoints({ rules, lines: [{ netCents, category: null }], at: { weekday: 3, time: '19:46' }, clearCents: 0, paidCents: netCents, carryCents: 0, stampedToday: false }).points;
    expect([earn(1250), earn(1600)]).toEqual([TABLE_6.withReward.earnsPoints, TABLE_6.withoutReward.earnsPoints]);
    expect(21240 - 1355).toBe(19885);
    expect(128 - 75 + 12).toBe(65);
  });
  test('every shop the spec draws is seeded, and every frame the app draws has a place', () => {
    expect(Object.keys(SHOPS).sort()).toEqual(['la-bonita', 'micasa', 'mikes-tire', 'pena-coffee', 'tia-beas']);
    expect(FRAMES.map((f) => f.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25]);
  });
});
