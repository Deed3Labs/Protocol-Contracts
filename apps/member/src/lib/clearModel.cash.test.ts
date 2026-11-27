import { describe, expect, test } from 'bun:test';
import {
  availableToSpend,
  cashTotal,
  hasUnspendableCash,
  sweepActivityRows,
  sweepsAwaitingMember,
  sweepsInFlight,
  unallocatedFromSweeps,
  type SweepView,
} from './clearModel';

/*
 * The two-part cash account, and the rule that keeps it honest: everything in it is the member's,
 * but only part of it can settle a card.
 */

const noCredit = { limit: 0, used: 0, tiers: [] } as unknown as Parameters<typeof availableToSpend>[1];

describe('the cash account has two parts', () => {
  test('the balance is both of them', () => {
    expect(cashTotal({ spendable: 400, readyToAllocate: 250 })).toBe(650);
  });

  test('only the on-chain part triggers the unspendable marking', () => {
    expect(hasUnspendableCash({ readyToAllocate: 250 })).toBe(true);
    expect(hasUnspendableCash({ readyToAllocate: 0 })).toBe(false);
  });

  test('a negative part never reduces the total below its other half', () => {
    expect(cashTotal({ spendable: 400, readyToAllocate: -50 })).toBe(400);
  });
});

describe('unspendable cash never becomes spendable', () => {
  test('available to spend counts the spendable part only', () => {
    // $400 spendable, $250 in USDC. Offering $650 would get the member declined at a checkout
    // while looking at a number that said they had it.
    expect(availableToSpend(400, noCredit)).toBe(400);
  });

  test('the total would overstate what the card can do', () => {
    const account = { spendable: 400, readyToAllocate: 250 };
    expect(cashTotal(account)).toBeGreaterThan(availableToSpend(account.spendable, noCredit));
  });
});

const sweeps: SweepView[] = [
  { id: 'a', amountCents: 50_000, state: 'fiat_debited', createdAt: '2026-08-10T12:00:00Z' },
  { id: 'b', amountCents: 20_000, state: 'ready_to_allocate', createdAt: '2026-08-09T12:00:00Z' },
  { id: 'c', amountCents: 10_000, state: 'complete', createdAt: '2026-08-01T12:00:00Z' },
  { id: 'd', amountCents: 30_000, state: 'initiated', createdAt: '2026-08-11T12:00:00Z' },
];

describe('sweeps in the UI', () => {
  test('in-flight means it left cash and has not landed', () => {
    expect(sweepsInFlight(sweeps).map((s) => s.id)).toEqual(['a', 'd']);
  });

  test('awaiting the member is the resting state, not a failure', () => {
    expect(sweepsAwaitingMember(sweeps).map((s) => s.id)).toEqual(['b']);
  });

  test('a completed sweep is neither — it is already in the ESA', () => {
    const ids = [...sweepsInFlight(sweeps), ...sweepsAwaitingMember(sweeps)].map((s) => s.id);
    expect(ids).not.toContain('c');
  });

  test('unallocated dollars come only from money that has actually arrived', () => {
    // $200 landed and unplaced. The $500 still in ACH is not theirs to move yet.
    expect(unallocatedFromSweeps(sweeps)).toBe(200);
  });
});

describe('in-flight sweeps show as pending activity', () => {
  const rows = sweepActivityRows(sweeps);

  test('one row per in-flight sweep', () => {
    expect(rows).toHaveLength(2);
  });

  test('tagged pending, so the source chip reads Pending', () => {
    expect(rows.every((r) => r.source === 'pending')).toBe(true);
  });

  test('negative, because the money left the cash account', () => {
    // Money that vanishes from one place without appearing anywhere else reads as lost.
    expect(rows.every((r) => r.amount < 0)).toBe(true);
    expect(rows.find((r) => r.id === 'sweep-a')?.amount).toBe(-500);
  });

  test('a landed sweep is no longer pending', () => {
    expect(rows.map((r) => r.id)).not.toContain('sweep-b');
  });
});
