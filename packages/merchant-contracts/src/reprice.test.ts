import { describe, expect, test } from 'bun:test';
import { suggestCosts } from './rewards';

const base = { cardSize: 10, pointsPer: 1, perAmountCents: 100, visitMinCents: 500 };
const rewards = [
  { id: 'agua', cost: 75 },
  { id: 'churros', cost: 150 },
  { id: 'plate', cost: 300 },
  { id: 'tray', cost: 600 },
];

describe('re-pricing rewards when Earn by changes', () => {
  test('to visits: the dearest takes a full card, the rest their share, at least one stamp', () => {
    expect(suggestCosts(rewards, { unit: 'dollars' }, { ...base, unit: 'visits' }).map((c) => c.to)).toEqual([1, 3, 5, 10]);
    expect(suggestCosts([{ id: 'a', cost: 1 }, { id: 'b', cost: 1000 }], { unit: 'dollars' }, { ...base, unit: 'visits', cardSize: 8 }).map((c) => c.to)).toEqual([1, 8]);
  });
  test('to dollars: a stamp is one visit at the new rate', () => {
    // $5 minimum at 1 point per $1: 5 points a stamp.
    expect(suggestCosts([{ id: 'a', cost: 4 }, { id: 'b', cost: 10 }], { unit: 'visits' }, { ...base, unit: 'dollars' }).map((c) => c.to)).toEqual([20, 50]);
    // No minimum: a $10 visit; 2 points per $1 makes 20 points a stamp.
    expect(suggestCosts([{ id: 'a', cost: 3 }], { unit: 'visits' }, { ...base, unit: 'dollars', visitMinCents: 0, pointsPer: 2 })[0]!.to).toBe(60);
  });
  test('the same unit on both sides changes nothing, and it reports what each was', () => {
    expect(suggestCosts(rewards, { unit: 'dollars' }, { ...base, unit: 'dollars' }).map((c) => c.to)).toEqual([75, 150, 300, 600]);
    expect(suggestCosts(rewards, { unit: 'dollars' }, { ...base, unit: 'visits' })[0]).toEqual({ id: 'agua', from: 75, to: 1 });
  });
});
