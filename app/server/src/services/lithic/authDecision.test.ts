import { describe, expect, test } from 'bun:test';
import { decide, applyDraws, totalAvailable, type TierAvailability } from './authDecision.js';

/*
 * The waterfall decides real money, so these cover the cases that cost someone something if wrong:
 * the order tiers are drawn in, the boundary at exactly-enough, and the states that must decline.
 */

const empty: TierAvailability = {
  cashCents: 0,
  savingsCents: 0,
  assetCents: 0,
  incomeCents: 0,
  boostCents: 0,
};

/** The Home fixture, in cents: $0 cash, and the tiers with room left. */
const inUse: TierAvailability = {
  cashCents: 0,
  savingsCents: 0, // fully drawn — $3,000 of $3,000
  assetCents: 590_000, // $5,900 left of $8,300
  incomeCents: 100_000, // $1,000
  boostCents: 0, // not added
};

describe('draw order', () => {
  test('spends cash before touching credit', () => {
    const d = decide({ amountCents: 5_000, availability: { ...empty, cashCents: 10_000 } });
    expect(d.result).toBe('APPROVED');
    expect(d.draws).toEqual([{ source: 'cash', amountCents: 5_000 }]);
    expect(d.creditCents).toBe(0);
  });

  test('spills from cash into the cheapest tier, in order', () => {
    const d = decide({
      amountCents: 25_000,
      availability: { ...empty, cashCents: 10_000, savingsCents: 5_000, assetCents: 100_000 },
    });
    expect(d.draws).toEqual([
      { source: 'cash', amountCents: 10_000 },
      { source: 'savings', amountCents: 5_000 },
      { source: 'asset', amountCents: 10_000 },
    ]);
    // Only the credit tiers count as issuance — the cash portion settles from the member's own money.
    expect(d.creditCents).toBe(15_000);
  });

  test('skips exhausted tiers without disturbing the order', () => {
    const d = decide({ amountCents: 60_000, availability: inUse });
    expect(d.draws).toEqual([{ source: 'asset', amountCents: 60_000 }]);
  });

  test('reaches boost only after everything cheaper is gone', () => {
    const d = decide({
      amountCents: 200_000,
      availability: { ...empty, assetCents: 100_000, incomeCents: 50_000, boostCents: 75_000 },
    });
    expect(d.draws.map((x) => x.source)).toEqual(['asset', 'income', 'boost']);
    expect(d.draws.at(-1)).toEqual({ source: 'boost', amountCents: 50_000 });
  });
});

describe('boundaries', () => {
  test('approves an amount exactly equal to what is available', () => {
    const d = decide({ amountCents: 690_000, availability: inUse });
    expect(d.result).toBe('APPROVED');
    expect(totalAvailable(inUse)).toBe(690_000);
    expect(d.draws.reduce((s, x) => s + x.amountCents, 0)).toBe(690_000);
  });

  test('declines one cent over', () => {
    const d = decide({ amountCents: 690_001, availability: inUse });
    expect(d.result).toBe('INSUFFICIENT_FUNDS');
    expect(d.draws).toEqual([]);
  });

  test('declines the whole amount rather than approving part of it', () => {
    const d = decide({ amountCents: 100_000, availability: { ...empty, cashCents: 99_999 } });
    expect(d.result).toBe('INSUFFICIENT_FUNDS');
    expect(d.creditCents).toBe(0);
  });

  test('a zero-amount authorization is approved and draws nothing', () => {
    const d = decide({ amountCents: 0, availability: inUse });
    expect(d.result).toBe('APPROVED');
    expect(d.draws).toEqual([]);
  });
});

describe('declines', () => {
  test('a paused card declines before any balance is consulted', () => {
    const d = decide({ amountCents: 100, availability: inUse, cardPaused: true });
    expect(d.result).toBe('CARD_PAUSED');
    expect(d.draws).toEqual([]);
  });

  test('an empty member declines', () => {
    const d = decide({ amountCents: 1, availability: empty });
    expect(d.result).toBe('INSUFFICIENT_FUNDS');
  });

  test('negative availability is treated as zero, never as room', () => {
    const d = decide({ amountCents: 100, availability: { ...empty, cashCents: -5_000 } });
    expect(d.result).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('applyDraws', () => {
  test('decrements exactly what was drawn and nothing else', () => {
    const d = decide({
      amountCents: 25_000,
      availability: { ...empty, cashCents: 10_000, savingsCents: 5_000, assetCents: 100_000 },
    });
    const next = applyDraws(
      { ...empty, cashCents: 10_000, savingsCents: 5_000, assetCents: 100_000 },
      d.draws,
    );
    expect(next).toEqual({
      cashCents: 0,
      savingsCents: 0,
      assetCents: 90_000,
      incomeCents: 0,
      boostCents: 0,
    });
  });

  test('a second identical authorization would decline once room is gone', () => {
    const start: TierAvailability = { ...empty, cashCents: 10_000 };
    const first = decide({ amountCents: 10_000, availability: start });
    const after = applyDraws(start, first.draws);
    const second = decide({ amountCents: 10_000, availability: after });
    expect(first.result).toBe('APPROVED');
    expect(second.result).toBe('INSUFFICIENT_FUNDS');
  });
});
