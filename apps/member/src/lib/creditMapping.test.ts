import { describe, expect, test } from 'bun:test';
import { toCredit, toCreditTiers, toCycle, toLimitBacking } from './creditMapping.js';
import type { CreditTierRow } from '../utils/apiClient.js';
import { HOME_DAY_ONE } from '../data/clearPlaceholder.js';

/*
 * Mapping the contracts' credit line onto the one a member reads.
 *
 * Every case here is one where getting it wrong puts a number on somebody's screen that is not
 * true, rather than one that merely looks odd.
 */

const tier = (over: Partial<CreditTierRow>): CreditTierRow => ({
  kind: 'SAVINGS',
  limitCents: 0,
  usedCents: 0,
  rateBps: 0,
  principalCents: 0,
  carryCents: 0,
  collateralValueCents: 0,
  haircutBps: 10_000,
  active: true,
  ...over,
});

describe('tiers', () => {
  test('collapses several chain kinds onto one row a member recognises', () => {
    // Bonds and pool shares are separate collateral kinds with separate haircuts, and both read as
    // "Assets". A member holding both should see the total, not whichever was mapped last.
    const tiers = toCreditTiers([
      tier({ kind: 'BOND', limitCents: 100_00, usedCents: 20_00, rateBps: 65 }),
      tier({ kind: 'POOL_SHARE', limitCents: 50_00, usedCents: 10_00, rateBps: 75 }),
    ]);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].key).toBe('asset');
    expect(tiers[0].limit).toBe(150);
    expect(tiers[0].used).toBe(30);
  });

  test('quotes the dearest rate of a collapsed row, not the cheapest', () => {
    // It is what the next dollar drawn on that row actually costs. Quoting the cheaper of two
    // would understate what the member is about to pay.
    const [assets] = toCreditTiers([
      tier({ kind: 'BOND', limitCents: 100_00, rateBps: 65 }),
      tier({ kind: 'POOL_SHARE', limitCents: 50_00, rateBps: 75 }),
    ]);
    expect(assets.rate).toBe('0.75% / cycle');
  });

  test('drops a kind it cannot name rather than inventing a label', () => {
    // A tier nobody has named is a number no part of the product can explain.
    expect(toCreditTiers([tier({ kind: 'SOMETHING_NEW', limitCents: 999_00 })])).toHaveLength(0);
  });

  test('marks a tier that lends nothing as not added', () => {
    // Boost is opt-in. Counting an offer toward the limit shows a ceiling the member cannot reach.
    const [boost] = toCreditTiers([tier({ kind: 'BOOST', limitCents: 0, rateBps: 300 })]);
    expect(boost.added).toBe(false);
  });
});

describe('carry', () => {
  test('sums what the tiers report rather than deriving it from used minus principal', () => {
    // The issuer computes carry against the tier's index. Subtracting two rounded figures gives a
    // third with both errors in it, on a number the member is charged.
    const credit = toCredit(
      [
        tier({ kind: 'SAVINGS', usedCents: 100_00, principalCents: 100_00, carryCents: 0 }),
        tier({ kind: 'INCOME', usedCents: 50_37, principalCents: 50_00, carryCents: 37 }),
      ],
      { tiers: [], carryCost: 999, carryFreeUnder: 0 },
    );
    expect(credit.carryCost).toBeCloseTo(0.37, 5);
  });
});

describe('the cycle', () => {
  const base = { issuedAt: 0, expiration: 0, graceLength: 0, paused: false };
  const fallback = { lengthDays: 30, daysLeft: 12, clearsOn: 'placeholder', rebalanceBy: 'x' };

  test('keeps the placeholder when no line has ever been opened', () => {
    // The mapping answers with zeroes for an unknown member, and a cycle of zero days ending on
    // the epoch is worse than the placeholder it would replace.
    expect(toCycle(base, fallback)).toBe(fallback);
    expect(toCycle(null, fallback)).toBe(fallback);
  });

  test('never reports negative days left on an expired period', () => {
    const now = Math.floor(Date.now() / 1000);
    const cycle = toCycle(
      { ...base, issuedAt: now - 60 * 86_400, expiration: now - 5 * 86_400, graceLength: 0 },
      fallback,
    );
    // A negative count would read as the member being owed time.
    expect(cycle.daysLeft).toBe(0);
    // Opened 60 days ago and expired 5 days ago, so the period itself ran 55.
    expect(cycle.lengthDays).toBe(55);
  });

  test('rebalanceBy is the grace expiry, not the cycle end', () => {
    const now = Math.floor(Date.now() / 1000);
    const cycle = toCycle(
      { ...base, issuedAt: now, expiration: now + 30 * 86_400, graceLength: 12 * 86_400 },
      fallback,
    );
    // The cycle is when the balance should clear; grace is how long the limit survives after.
    expect(cycle.clearsOn).not.toBe(cycle.rebalanceBy);
  });
});

describe('limit backing', () => {
  test('splits secured rows from unsecured ones', () => {
    const backing = toLimitBacking(
      [
        tier({ kind: 'SAVINGS', limitCents: 300_000, collateralValueCents: 300_000 }),
        tier({ kind: 'INCOME', limitCents: 200_000, rateBps: 150, haircutBps: 0 }),
      ],
      { assetBacked: [], unsecured: [] },
    );
    expect(backing.assetBacked).toHaveLength(1);
    expect(backing.unsecured).toHaveLength(1);
  });

  test('shows an unsecured row its rate and no haircut of nothing', () => {
    const { unsecured } = toLimitBacking(
      [tier({ kind: 'BOOST', limitCents: 50_000, rateBps: 300, haircutBps: 0 })],
      { assetBacked: [], unsecured: [] },
    );
    expect(unsecured[0].detail).toBe('3% / cycle');
    expect(unsecured[0].detail).not.toContain('0%');
  });

  test('offers a tier that lends nothing rather than showing it as a zero', () => {
    const { unsecured } = toLimitBacking(
      [tier({ kind: 'BOOST', limitCents: 0, rateBps: 300 })],
      { assetBacked: [], unsecured: [] },
    );
    expect(unsecured[0].notAdded).toBe(true);
  });
});

describe('a member who has never opened a line', () => {
  const fallback = { lengthDays: 30, daysLeft: 0, clearsOn: '', rebalanceBy: '' };

  test('falls through rather than inventing a cycle', () => {
    // Substituting a full cycle here made a member with a real line and one with none look
    // identical on screen. The state should not occur -- every member gets a line at signup -- so
    // when it does, it should be visible rather than smoothed over.
    const cycle = toCycle(
      { issuedAt: 0, expiration: 0, graceLength: 0, paused: false, networkCycleSeconds: 30 * 86_400 },
      fallback,
    );
    expect(cycle).toBe(fallback);
    expect(cycle.clearsOn).toBe('');
  });

  test('a real period reads differently from the fallback, which is the point', () => {
    const now = Math.floor(Date.now() / 1000);
    const cycle = toCycle(
      {
        issuedAt: now,
        expiration: now + 30 * 86_400,
        graceLength: 30 * 86_400,
        paused: false,
        networkCycleSeconds: 30 * 86_400,
      },
      fallback,
    );
    // A date where there was none is the signal that a line was actually opened.
    expect(cycle.clearsOn).not.toBe('');
    expect(cycle.daysLeft).toBe(30);
  });
});

/**
 * Carry a closed plan left behind had no home on any screen: the Term plans shelf lists only open
 * plans, and this mapping summed only the tier rows. A refund closes a plan over whatever carry had
 * accrued, so it made a real obligation invisible.
 */
describe('carry left by a closed plan is still charged, so it is still shown', () => {
  const tiers = [
    { kind: 'ASSET', limitCents: 50_000, usedCents: 10_000, carryCents: 250, active: true, ratePerCycleBps: 75 },
  ] as unknown as CreditTierRow[];

  test('it is added to the carry the tiers already report', () => {
    const withOrphan = toCredit(tiers, HOME_DAY_ONE.credit, 578);
    const without = toCredit(tiers, HOME_DAY_ONE.credit, 0);
    expect(withOrphan.carryCost).toBeCloseTo(without.carryCost + 5.78, 6);
  });

  test('it shows even for a member with no tiers at all', () => {
    // The case that made this necessary: a refunded plan and nothing else. Returning the fallback
    // here is what hid it, because the fallback carries a zero.
    expect(toCredit([], HOME_DAY_ONE.credit, 578).carryCost).toBeCloseTo(5.78, 6);
  });

  test('a member owing nothing still gets the untouched fallback', () => {
    expect(toCredit([], HOME_DAY_ONE.credit, 0)).toBe(HOME_DAY_ONE.credit);
  });
});
