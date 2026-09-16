import { describe, expect, test } from 'bun:test';
import { categoriesFrom, cycleSpendFrom, type SpendRow } from './activityCycle';
import type { CardTransaction } from '@/utils/apiClient';

const START = Date.parse('2026-10-01T00:00:00Z');
const at = (day: number) => new Date(START + day * 86_400_000).toISOString();

const card = (id: string, day: number, cents: number, draws: [string, number][], mcc: string | null): CardTransaction => ({
  id,
  name: id,
  at: at(day),
  amountCents: cents,
  mcc,
  city: null,
  state: null,
  draws: draws.map(([source, amountCents]) => ({ source, amountCents })),
  cardToken: 'tok',
});

const cards = [
  card('groceries', 2, 11_844, [['cash', 11_844]], '5411'),
  card('fuel', 3, 5_210, [['cash', 1_000], ['asset', 4_210]], '5541'),
  // Before the cycle opened, so it belongs to the last one.
  card('old', -4, 20_000, [['cash', 20_000]], '5411'),
];

const rows: SpendRow[] = [
  { ts: START + 86_400_000, amount: -40, internal: false },
  { ts: START + 86_400_000, amount: 2_000, internal: false },
  // A move to the member's own savings is not spending.
  { ts: START + 86_400_000, amount: -500, internal: true },
  { ts: START - 86_400_000, amount: -99, internal: false },
];

describe('what the cycle was made of', () => {
  const spend = cycleSpendFrom(cards, rows, { startMs: START, daysLeft: 6, carryCost: 17.4 });

  test('the split comes from the card draws, and everything else is cash', () => {
    expect(spend).toEqual({ spent: 210.54, daysLeft: 6, fromCash: 168.44, fromCredit: 42.1, carryCost: 17.4 });
  });

  test('nothing spent is zero, not a missing hero', () => {
    expect(cycleSpendFrom([], [], { startMs: START, daysLeft: 6, carryCost: 0 })).toEqual({
      spent: 0,
      daysLeft: 6,
      fromCash: 0,
      fromCredit: 0,
      carryCost: 0,
    });
  });

  test('with no cycle to measure against, everything loaded counts', () => {
    // The 12 mo card purchase before the window and the older $99 row join the total.
    expect(cycleSpendFrom(cards, rows, { startMs: 0, daysLeft: 0, carryCost: 0 })?.spent).toBe(509.54);
  });
});

describe('where it went', () => {
  test('card spending is grouped by its merchant category and the rest is the catch-all', () => {
    expect(categoriesFrom(cards, rows, START)).toEqual([
      { label: 'Groceries', amount: 118.44 },
      { label: 'Fuel', amount: 52.1 },
      { label: 'Everything else', amount: 40 },
    ]);
  });

  test('a single group still stands, because the cell always does', () => {
    expect(categoriesFrom([cards[0]], [], START)).toEqual([{ label: 'Groceries', amount: 118.44 }]);
  });
});
