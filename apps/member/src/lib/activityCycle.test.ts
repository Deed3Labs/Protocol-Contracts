import { describe, expect, test } from 'bun:test';
import { categoriesFrom, cycleSpendFrom, groupsFromMerchants, merchantsFrom, type SpendRow } from './activityCycle';
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
  { name: 'Diego R.', ts: START + 86_400_000, amount: -40, internal: false },
  { name: 'Payroll deposit', ts: START + 86_400_000, amount: 2_000, internal: false },
  // A move to the member's own savings is not spending.
  { name: 'To savings', ts: START + 86_400_000, amount: -500, internal: true },
  { name: 'Older send', ts: START - 86_400_000, amount: -99, internal: false },
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

describe('changing the groups', () => {
  const merchants = merchantsFrom(cards, rows, START);

  test('a merchant carries its payments, its total and the group it starts in', () => {
    expect(merchants).toEqual([
      { name: 'groceries', group: 'Groceries', payments: 1, amount: 118.44 },
      { name: 'fuel', group: 'Fuel', payments: 1, amount: 52.1 },
      { name: 'Diego R.', group: 'Everything else', payments: 1, amount: 40 },
    ]);
  });

  test('a group the member moved into stays on the list however small', () => {
    expect(groupsFromMerchants(merchants, { diegor: 'Warehouse' }).map((g) => g.label)).toEqual([
      'Groceries',
      'Fuel',
      'Warehouse',
    ]);
  });

  test('a move is retroactive: the groups are rebuilt from the merchants', () => {
    expect(groupsFromMerchants(merchants, { diegor: 'Groceries' })).toEqual([
      { label: 'Groceries', amount: 158.44 },
      { label: 'Fuel', amount: 52.1 },
    ]);
  });
});

/*
 * A voided charge is money the member has back. The row keeps its figure so they can reconcile it
 * against what they remember, but every total has to stop counting it — otherwise the page tells
 * them they spent more on groceries than they did, and the category bar is the one place that is
 * hard to argue with.
 */
describe('a charge that was given back', () => {
  const voided: CardTransaction = {
    ...card('refunded', 2, 9_000, [], '5411'),
    heldCents: 0,
    reversed: true,
  };
  const withVoid = [...cards, voided];

  test('adds nothing to its category', () => {
    const before = categoriesFrom(cards, rows, START).find((g) => g.label === 'Groceries');
    const after = categoriesFrom(withVoid, rows, START).find((g) => g.label === 'Groceries');
    expect(after?.amount).toBe(before?.amount as number);
  });

  test('adds nothing to the merchant it was made at', () => {
    const merchant = merchantsFrom(withVoid, rows, START).find((m) => m.name === 'refunded');
    expect(merchant?.amount).toBe(0);
  });

  test('adds nothing to the cycle, because reconciling emptied its draws', () => {
    expect(cycleSpendFrom(withVoid, rows, { startMs: START, daysLeft: 6, carryCost: 17.4 })).toEqual(
      cycleSpendFrom(cards, rows, { startMs: START, daysLeft: 6, carryCost: 17.4 }),
    );
  });

  test('a partly cleared charge counts what it actually held', () => {
    const tip: CardTransaction = { ...card('diner', 2, 5_000, [['cash', 5_800]], '5812'), heldCents: 5_800 };
    const merchant = merchantsFrom([tip], rows, START).find((m) => m.name === 'diner');
    expect(merchant?.amount).toBe(58);
  });
});
