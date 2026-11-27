import { describe, expect, test } from 'bun:test';
import { heldAmountOf } from './cardTransactionEvents.js';
import {
  drawUpTo,
  mergeDraws,
  releaseDraws,
  restoreDraws,
  type Draw,
  type TierAvailability,
} from './authDecision.js';

/*
 * The arithmetic of putting a draw back. Every case here is one where getting it wrong either keeps
 * a member's money after the charge is gone, or hands back money they are still spending.
 */

const empty: TierAvailability = {
  cashCents: 0,
  savingsCents: 0,
  assetCents: 0,
  incomeCents: 0,
  boostCents: 0,
};

describe('what a transaction holds', () => {
  test('an open authorization holds its pending amount', () => {
    expect(heldAmountOf({ status: 'PENDING', pending_amount: 500, settled_amount: 0 })).toBe(500);
  });

  test('a settled one holds what cleared, not what was authorized', () => {
    // The tip case: authorized $50, cleared $58.
    expect(heldAmountOf({ status: 'SETTLED', pending_amount: 0, settled_amount: 5_800 })).toBe(5_800);
  });

  test('a void holds nothing', () => {
    expect(heldAmountOf({ status: 'VOIDED', pending_amount: 0, settled_amount: 0 })).toBe(0);
  });

  test('a terminal status holds nothing even if the amounts still say otherwise', () => {
    // Belt and braces: a stale pending figure on an expired transaction must not keep a draw alive.
    expect(heldAmountOf({ status: 'EXPIRED', pending_amount: 500 })).toBe(0);
  });

  test('a partial clearing holds both halves', () => {
    expect(heldAmountOf({ status: 'PENDING', pending_amount: 200, settled_amount: 300 })).toBe(500);
  });

  /*
   * The sandbox serves a response with no `pending_amount` at all — these two payloads are copied
   * from the real $5 test transaction, pending and then voided. Adding the pair on this shape would
   * collapse a live $5 hold to zero and release a draw the member is still spending.
   */
  describe('the legacy shape, with no pending_amount', () => {
    test('a live authorization holds its amount, not zero', () => {
      expect(heldAmountOf({ status: 'PENDING', result: 'APPROVED', amount: 500, settled_amount: 0 })).toBe(500);
    });

    test('the same transaction once voided holds nothing', () => {
      expect(
        heldAmountOf({ status: 'VOIDED', result: 'APPROVED', amount: 0, settled_amount: 0 }),
      ).toBe(0);
    });
  });

  /*
   * The one that matters most. An unreadable payload is not a transaction worth nothing — treating
   * it as zero would release a live draw and give a member back money they are still spending.
   */
  test('a payload with no amounts at all is unknown, never zero', () => {
    expect(heldAmountOf({ status: 'PENDING' })).toBeNull();
    expect(heldAmountOf({})).toBeNull();
  });

  test('amounts arriving as strings are still amounts', () => {
    expect(heldAmountOf({ status: 'SETTLED', settled_amount: '500' })).toBe(500);
  });
});

describe('releasing a draw', () => {
  const drawn: Draw[] = [
    { source: 'cash', amountCents: 1_000 },
    { source: 'asset', amountCents: 2_000 },
    { source: 'boost', amountCents: 3_000 },
  ];

  test('retires the most expensive credit first', () => {
    // $30 back off a $60 charge: all of the 3% boost, none of the cheaper tiers.
    expect(releaseDraws(drawn, 3_000)).toEqual([{ source: 'boost', amountCents: 3_000 }]);
  });

  test('spills into the next-dearest tier once the dearest is clear', () => {
    expect(releaseDraws(drawn, 4_000)).toEqual([
      { source: 'boost', amountCents: 3_000 },
      { source: 'asset', amountCents: 1_000 },
    ]);
  });

  test('a full void gives back every tier and nothing more', () => {
    const back = releaseDraws(drawn, 6_000);
    expect(back.reduce((sum, d) => sum + d.amountCents, 0)).toBe(6_000);
  });

  test('never gives back more than a tier actually took', () => {
    // Asked for $100 against a $60 draw. Availability must not be invented out of the difference.
    const back = releaseDraws(drawn, 10_000);
    expect(back.reduce((sum, d) => sum + d.amountCents, 0)).toBe(6_000);
  });

  test('a release puts the snapshot back exactly where it was', () => {
    const before: TierAvailability = { ...empty, cashCents: 5_000, assetCents: 50_000, boostCents: 10_000 };
    const after = restoreDraws(
      { ...empty, cashCents: 4_000, assetCents: 48_000, boostCents: 7_000 },
      drawn,
    );
    expect(after).toEqual(before);
  });
});

describe('a clearing above its authorization', () => {
  test('draws the difference through the same waterfall', () => {
    const more = drawUpTo({ ...empty, cashCents: 1_000, assetCents: 50_000 }, 2_000);
    expect(more.draws).toEqual([
      { source: 'cash', amountCents: 1_000 },
      { source: 'asset', amountCents: 1_000 },
    ]);
    expect(more.shortfallCents).toBe(0);
  });

  /*
   * Money that has already moved gets no veto. `decide` refuses a purchase it cannot fund in full,
   * which is right at a till; a clearing is a fact, so the part no tier can cover is recorded rather
   * than dropped on the floor.
   */
  test('records what no tier could cover instead of discarding it', () => {
    const more = drawUpTo({ ...empty, cashCents: 500 }, 2_000);
    expect(more.draws).toEqual([{ source: 'cash', amountCents: 500 }]);
    expect(more.shortfallCents).toBe(1_500);
  });

  test('an unreadable tier has no room, never infinite room', () => {
    const broken = { ...empty, cashCents: NaN as unknown as number, assetCents: 5_000 };
    const more = drawUpTo(broken, 1_000);
    expect(more.draws).toEqual([{ source: 'asset', amountCents: 1_000 }]);
  });
});

describe('what we hold after an adjustment', () => {
  test('merging keeps one row per tier, in cost order', () => {
    const merged = mergeDraws(
      [
        { source: 'asset', amountCents: 2_000 },
        { source: 'cash', amountCents: 1_000 },
      ],
      [{ source: 'asset', amountCents: 500 }],
    );
    expect(merged).toEqual([
      { source: 'cash', amountCents: 1_000 },
      { source: 'asset', amountCents: 2_500 },
    ]);
  });

  test('a tier released to nothing drops out entirely', () => {
    const merged = mergeDraws(
      [{ source: 'boost', amountCents: 3_000 }],
      [{ source: 'boost', amountCents: -3_000 }],
    );
    expect(merged).toEqual([]);
  });
});
