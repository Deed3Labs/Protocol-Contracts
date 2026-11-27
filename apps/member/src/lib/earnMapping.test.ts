import { describe, expect, test } from 'bun:test';
import { toBondTerms, toHeldBonds, toYieldPool } from './earnMapping.js';
import type { EarnBondRow } from '../utils/apiClient.js';

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

const bond = (over: Partial<EarnBondRow>): EarnBondRow => ({
  bondId: '1',
  faceCents: 100_000,
  paidCents: 93_690,
  worthTodayCents: 93_690,
  maturityUnix: now() + 365 * DAY,
  issuedAtUnix: now(),
  redeemed: false,
  ...over,
});

describe('held bonds', () => {
  test('reports the term as issued, not what is left of it', () => {
    // Deriving the term from months remaining would relabel a member's three-year bond as a
    // one-year bond two years in.
    const [held] = toHeldBonds([
      bond({ issuedAtUnix: now() - 730 * DAY, maturityUnix: now() + 365 * DAY }),
    ]);
    expect(held.months).toBe(37); // ~36 months issued, on 30-day months
    expect(held.monthsLeft).toBe(12);
  });

  test('shows what a bond is worth today rather than its face', () => {
    // worthToday is what the credit line lends against. Showing face would tell a member they
    // hold more than they can borrow against, on the screen offering to lend it to them.
    const [held] = toHeldBonds([bond({ faceCents: 100_000, worthTodayCents: 96_000 })]);
    expect(held.worthToday).toBe(960);
    expect(held.face).toBe(1000);
    expect(held.worthToday).toBeLessThan(held.face);
  });

  test('never reports negative months on a matured bond', () => {
    const [held] = toHeldBonds([bond({ maturityUnix: now() - 30 * DAY })]);
    expect(held.monthsLeft).toBe(0);
  });
});

describe('the pool', () => {
  const fallback = { apy: 6.8, lent: 1, capacity: 2, position: 3, earned: 42 };

  test('keeps the placeholder when the pool is not deployed', () => {
    // Not deployed is a different thing from a pool holding nothing.
    expect(toYieldPool(null, fallback)).toBe(fallback);
  });

  test('reads earned from the chain rather than the fallback', () => {
    // The pool knows what shares are worth and not what they cost, but it emitted both at the
    // time -- so cost basis comes from its own Deposit and Withdraw events.
    const pool = toYieldPool(
      {
        apyPercent: 7.1234,
        lentCents: 50_000,
        capacityCents: 100_000,
        positionCents: 25_000,
        earnedCents: 3_000,
      },
      fallback,
    );
    expect(pool.apy).toBe(7.12);
    expect(pool.position).toBe(250);
    expect(pool.earned).toBe(30);
    expect(pool.earned).not.toBe(fallback.earned);
  });
});

describe('terms', () => {
  test('carries the contract-quoted price through unrounded in cents', () => {
    const [term] = toBondTerms([
      { months: 12, priceCents: 93_690, faceCents: 100_000, ratePercent: 6.7312 },
    ]);
    expect(term.price).toBe(936.9);
    expect(term.rate).toBe(6.73);
  });
});

describe('pool earnings', () => {
  const fallback = { apy: 6.8, lent: 1, capacity: 2, position: 3, earned: 42 };

  test('reports the position above its cost basis', () => {
    const pool = toYieldPool(
      { apyPercent: 7, lentCents: 0, capacityCents: 0, positionCents: 26_000, earnedCents: 1_000 },
      fallback,
    );
    expect(pool.earned).toBe(10);
  });
});
