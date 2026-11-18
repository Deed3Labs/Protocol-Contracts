import { describe, expect, test } from 'bun:test';
import { decide, applyDraws, totalAvailable, type CreditFeeInput, type TierAvailability } from './authDecision.js';
import {
  CHAIN_MAX_TRUSTED_MS,
  cardFeeCapExcess,
  chainMaxCardCreditFee,
  feeDrawsLeft,
  liveFeeCents,
  creditFeeSettings,
  effectiveCreditFee,
  resetChainMaxCardCreditFee,
  setChainMaxCardCreditFee,
} from './cardCreditFee.js';

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

describe('malformed availability', () => {
  test('a non-finite balance declines instead of approving', () => {
    // NaN reaches here through a NULL column or a failed parse. Every comparison against it is
    // false, so without an explicit guard the amount check passes, the remainder check passes, and
    // an unfunded charge is approved — fail-open in the one place that must fail closed.
    const decision = decide({
      amountCents: 5_000,
      availability: {
        cashCents: Number.NaN,
        savingsCents: 0,
        assetCents: 0,
        incomeCents: 0,
        boostCents: 0,
      },
      cardPaused: false,
    });
    expect(decision.result).toBe('INSUFFICIENT_FUNDS');
    expect(decision.draws).toEqual([]);
  });

  test('a non-finite amount declines too', () => {
    const decision = decide({
      amountCents: Number.NaN,
      availability: {
        cashCents: 500_000,
        savingsCents: 0,
        assetCents: 0,
        incomeCents: 0,
        boostCents: 0,
      },
      cardPaused: false,
    });
    expect(decision.result).toBe('INSUFFICIENT_FUNDS');
  });
});

/*
 * The card credit fee (decision 55). The purchase's waterfall is untouched; the fee rides on top of a
 * purchase that drew on credit, from the credit tiers still with room, all or nothing. Every case
 * here is one that would put a charge on a member who should not have it, or approve one nobody can
 * fund.
 */
describe('card credit fee', () => {
  const on: CreditFeeInput = { cents: 30, tiers: ['savings', 'asset', 'income', 'boost'], minPurchaseCents: 0 };

  test('cash only: no fee, and nothing about the purchase changes', () => {
    const d = decide({ amountCents: 5_000, availability: { ...empty, cashCents: 10_000, assetCents: 50_000 }, creditFee: on });
    expect(d.result).toBe('APPROVED');
    expect(d.draws).toEqual([{ source: 'cash', amountCents: 5_000 }]);
    expect(d.feeCents).toBe(0);
    expect(d.feeDraws).toEqual([]);
  });

  test('credit only: one fee, drawn after the purchase from the tier still with room', () => {
    const d = decide({ amountCents: 60_000, availability: inUse, creditFee: on });
    expect(d.result).toBe('APPROVED');
    // The purchase is decided exactly as without a fee.
    expect(d.draws).toEqual([{ source: 'asset', amountCents: 60_000 }]);
    expect(d.creditCents).toBe(60_000);
    expect(d.feeCents).toBe(30);
    expect(d.feeDraws).toEqual([{ source: 'asset', amountCents: 30 }]);
  });

  test('part cash, part credit: the one flat fee, never from cash', () => {
    const d = decide({
      amountCents: 25_000,
      availability: { ...empty, cashCents: 10_000, savingsCents: 5_000, assetCents: 100_000 },
      creditFee: on,
    });
    expect(d.draws).toEqual([
      { source: 'cash', amountCents: 10_000 },
      { source: 'savings', amountCents: 5_000 },
      { source: 'asset', amountCents: 10_000 },
    ]);
    // creditCents stays the purchase's credit part; the fee is reported apart from it.
    expect(d.creditCents).toBe(15_000);
    expect(d.feeCents).toBe(30);
    expect(d.feeDraws).toEqual([{ source: 'asset', amountCents: 30 }]);
    expect(d.feeDraws.some((x) => x.source === 'cash')).toBe(false);
  });

  test('the fee spills across tiers cheapest first, after the purchase took its share', () => {
    const d = decide({
      amountCents: 1_000,
      availability: { ...empty, assetCents: 1_010, incomeCents: 0, boostCents: 500 },
      creditFee: on,
    });
    expect(d.draws).toEqual([{ source: 'asset', amountCents: 1_000 }]);
    expect(d.feeDraws).toEqual([
      { source: 'asset', amountCents: 10 },
      { source: 'boost', amountCents: 20 },
    ]);
  });

  test('no room for the fee: the whole purchase declines, all or nothing', () => {
    // $6,900 is exactly what the Home fixture can spend; the purchase fits, the fee does not.
    const d = decide({ amountCents: 690_000, availability: inUse, creditFee: on });
    expect(d.result).toBe('INSUFFICIENT_FUNDS');
    expect(d.draws).toEqual([]);
    expect(d.creditCents).toBe(0);
    expect(d.feeCents).toBe(0);
    // One cent less than the room for both is approved.
    const fits = decide({ amountCents: 689_970, availability: inUse, creditFee: on });
    expect(fits.result).toBe('APPROVED');
    expect(fits.feeCents).toBe(30);
  });

  test('the fee tiers can leave savings out: a savings-only purchase then carries none', () => {
    const noSavings: CreditFeeInput = { ...on, tiers: ['asset', 'income', 'boost'] };
    const savingsOnly = decide({ amountCents: 5_000, availability: { ...empty, savingsCents: 10_000, assetCents: 10_000 }, creditFee: noSavings });
    expect(savingsOnly.draws).toEqual([{ source: 'savings', amountCents: 5_000 }]);
    expect(savingsOnly.feeCents).toBe(0);
    // Spilling past savings into asset reaches a fee tier, so it does carry one.
    const spills = decide({ amountCents: 12_000, availability: { ...empty, savingsCents: 10_000, assetCents: 10_000 }, creditFee: noSavings });
    expect(spills.feeCents).toBe(30);
    expect(spills.feeDraws).toEqual([{ source: 'asset', amountCents: 30 }]);
    // With savings counted (the default), the savings-only purchase carries it.
    expect(decide({ amountCents: 5_000, availability: { ...empty, savingsCents: 10_000 }, creditFee: on }).feeCents).toBe(30);
  });

  test('a purchase under the minimum carries no fee; one at it does', () => {
    const min: CreditFeeInput = { ...on, minPurchaseCents: 1_000 };
    expect(decide({ amountCents: 999, availability: inUse, creditFee: min }).feeCents).toBe(0);
    expect(decide({ amountCents: 1_000, availability: inUse, creditFee: min }).feeCents).toBe(30);
  });

  test('fee off: no setting, a zero setting, or the chain refusing it', () => {
    expect(decide({ amountCents: 60_000, availability: inUse }).feeCents).toBe(0);
    expect(decide({ amountCents: 60_000, availability: inUse, creditFee: { ...on, cents: 0 } }).feeCents).toBe(0);
    const settings = { cents: 30, tiers: on.tiers, minPurchaseCents: 0 };
    // The chain's bound unread (or too old), zero (the default after the upgrade, and what a revert
    // on the contract before it reads as), or below the setting: off.
    for (const max of [null, 0n, 299_999n]) {
      const fee = effectiveCreditFee(settings, max);
      expect(fee.cents).toBe(0);
      expect(decide({ amountCents: 60_000, availability: inUse, creditFee: fee }).feeCents).toBe(0);
    }
    // Covered: on.
    expect(effectiveCreditFee(settings, 300_000n).cents).toBe(30);
    expect(effectiveCreditFee({ ...settings, cents: 0 }, 300_000n).cents).toBe(0);
  });

  test('the settings read off when they cannot be read, and default to every credit tier', () => {
    expect(creditFeeSettings({})).toEqual({ cents: 0, tiers: ['savings', 'asset', 'income', 'boost'], minPurchaseCents: 0 });
    expect(creditFeeSettings({ CARD_CREDIT_FEE_CENTS: 'thirty' }).cents).toBe(0);
    expect(creditFeeSettings({ CARD_CREDIT_FEE_CENTS: '-5' }).cents).toBe(0);
    expect(creditFeeSettings({ CARD_CREDIT_FEE_CENTS: '30' }).cents).toBe(30);
    expect(creditFeeSettings({ CARD_CREDIT_FEE_TIERS: 'asset, Boost,cash,bogus' }).tiers).toEqual(['asset', 'boost']);
    expect(creditFeeSettings({ CARD_CREDIT_FEE_MIN_PURCHASE_CENTS: '500' }).minPurchaseCents).toBe(500);
  });

  test('the cached chain bound is trusted only while fresh', () => {
    resetChainMaxCardCreditFee();
    expect(chainMaxCardCreditFee()).toBeNull();
    setChainMaxCardCreditFee(300_000n, 1_000);
    expect(chainMaxCardCreditFee(1_000 + CHAIN_MAX_TRUSTED_MS)).toBe(300_000n);
    expect(chainMaxCardCreditFee(1_001 + CHAIN_MAX_TRUSTED_MS)).toBeNull();
    resetChainMaxCardCreditFee();
  });

  test('NaN or null fee inputs still fail closed', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -30, null, undefined, '30']) {
      const fee = { ...on, cents: bad as unknown as number };
      const d = decide({ amountCents: 60_000, availability: inUse, creditFee: fee });
      // A fee setting that cannot be read declines a credit purchase rather than guess at it.
      expect(d.result).toBe('INSUFFICIENT_FUNDS');
      expect(d.feeCents).toBe(0);
      expect(d.draws).toEqual([]);
    }
    for (const bad of [Number.NaN, null]) {
      const badMin = decide({ amountCents: 60_000, availability: inUse, creditFee: { ...on, minPurchaseCents: bad as unknown as number } });
      expect(badMin.result).toBe('INSUFFICIENT_FUNDS');
    }
    // A NULL tier column behind the fee's room is no room, never infinite room.
    for (const bad of [Number.NaN, null]) {
      const noRoom = decide({
        amountCents: 1_000,
        availability: { ...empty, assetCents: 1_000, boostCents: bad as unknown as number },
        creditFee: on,
      });
      expect(noRoom.result).toBe('INSUFFICIENT_FUNDS');
    }
    // And the old guards still hold with a fee in force.
    expect(decide({ amountCents: Number.NaN, availability: inUse, creditFee: on }).result).toBe('INSUFFICIENT_FUNDS');
    expect(decide({ amountCents: 100, availability: { ...empty, cashCents: Number.NaN }, creditFee: on }).result).toBe('INSUFFICIENT_FUNDS');
    // A cash purchase never looks at the fee, so a broken fee setting cannot decline it.
    expect(decide({ amountCents: 100, availability: { ...empty, cashCents: 500 }, creditFee: { ...on, cents: Number.NaN } }).result).toBe('APPROVED');
  });

  test('a covered borrower (Military Lending Act, MB-04 §5.10) pays no fee, whatever the settings', () => {
    const d = decide({ amountCents: 60_000, availability: inUse, creditFee: on, coveredBorrower: true });
    expect(d).toMatchObject({ result: 'APPROVED', creditCents: 60_000, feeCents: 0, feeDraws: [] });
    // Not covered, or never checked (the default today): the fee applies.
    expect(decide({ amountCents: 60_000, availability: inUse, creditFee: on, coveredBorrower: false }).feeCents).toBe(30);
    expect(decide({ amountCents: 60_000, availability: inUse, creditFee: on }).feeCents).toBe(30);
  });

  test('what a fee still owes after part of it is credited back, and from which tiers', () => {
    expect(liveFeeCents(30, 'held')).toBe(30);
    expect(liveFeeCents(30, 'charged', 10)).toBe(20);
    expect(liveFeeCents(30, 'charged', 45)).toBe(0);
    for (const s of ['released', 'waived', 'returned', null]) expect(liveFeeCents(30, s)).toBe(0);
    // Credited back dearest tier first, so what is left sits on the cheapest.
    expect(
      feeDrawsLeft(
        [
          { source: 'asset', amountCents: 10 },
          { source: 'boost', amountCents: 20 },
        ],
        25,
      ),
    ).toEqual([{ source: 'asset', amountCents: 5 }]);
  });

  test('the CFL cap measure (MB-04 §5.4(f), counsel question MB-04 #52) credits nothing yet', () => {
    expect(
      cardFeeCapExcess({ wallet: '0x1', cycleStartMs: 0, cycleEndMs: 1, feesCents: 3_000, carryCents: 100_000, principalCents: 1 }),
    ).toBe(0);
  });

  test('a paused card and a decline carry no fee', () => {
    expect(decide({ amountCents: 100, availability: inUse, cardPaused: true, creditFee: on })).toMatchObject({ feeCents: 0, feeDraws: [] });
    expect(decide({ amountCents: 1, availability: empty, creditFee: on })).toMatchObject({ feeCents: 0, feeDraws: [] });
  });

  test('applying the purchase and its fee leaves exactly what neither used', () => {
    const start: TierAvailability = { ...empty, assetCents: 1_010, boostCents: 500 };
    const d = decide({ amountCents: 1_000, availability: start, creditFee: on });
    expect(applyDraws(start, [...d.draws, ...d.feeDraws])).toEqual({ ...empty, assetCents: 0, boostCents: 480 });
  });
});
