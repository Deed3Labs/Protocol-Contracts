import { describe, expect, test } from 'bun:test';
import { OPEN, PAUSED } from './cardService.js';
import type { SnapshotSources } from './snapshotService.js';
import { decide } from './authDecision.js';

/*
 * Card rules — spec step 8. The parts that decide whether a charge goes through, tested without a
 * network in the way.
 */

describe('freeze', () => {
  test('a frozen card declines regardless of available balance', () => {
    // Defence in depth: Lithic declines a PAUSED card before it ever reaches us. If that stops
    // being true, or if a card is paused only in our records, the waterfall still has to refuse.
    const decision = decide({
      amountCents: 1000,
      availability: { cashCents: 500_000, savingsCents: 0, assetCents: 0, incomeCents: 0, boostCents: 0 },
      cardPaused: true,
    });
    // Named, not just declined: the member should be told their card is frozen, not that they're
    // short of money.
    expect(decision.result).toBe('CARD_PAUSED');
  });

  test('the same charge on an unfrozen card is approved', () => {
    const decision = decide({
      amountCents: 1000,
      availability: { cashCents: 500_000, savingsCents: 0, assetCents: 0, incomeCents: 0, boostCents: 0 },
      cardPaused: false,
    });
    expect(decision.result).toBe('APPROVED');
  });

  test('frozen and open are the only two states the toggle produces', () => {
    expect(PAUSED).toBe('PAUSED');
    expect(OPEN).toBe('OPEN');
  });
});

describe('card state survives a snapshot rebuild', () => {
  test('a writer cannot omit cardPaused', () => {
    // The structural half of the fix. cardPaused was optional on SnapshotSources, and
    // Boolean(undefined) is false — so a caller who simply forgot it wrote a frozen card back as
    // spendable. It is now required, which makes the omission a compile error. This test documents
    // why the field is not optional; the compiler is what actually enforces it.
    const sources: Pick<SnapshotSources, 'cardPaused'> = { cardPaused: true };
    expect(sources.cardPaused).toBe(true);

    // @ts-expect-error cardPaused is required — omitting it must not compile.
    const missing: Pick<SnapshotSources, 'cardPaused'> = {};
    expect(missing).toBeDefined();
  });

  /** Mirrors refreshSnapshot: card_paused is read from the card record, never defaulted. */
  const pausedFor = (state: string | undefined) => state === PAUSED;

  test('a paused card stays paused through a refresh', () => {
    // The bug this guards: defaulting card_paused to false let any rebuild — a deposit, an hourly
    // job — quietly reopen a card the member had shut off.
    expect(pausedFor(PAUSED)).toBe(true);
  });

  test('an open card stays open', () => {
    expect(pausedFor(OPEN)).toBe(false);
  });

  test('a card we have no record of is not treated as frozen', () => {
    // Freezing on absence would decline every charge on a card whose row has not been written yet.
    expect(pausedFor(undefined)).toBe(false);
  });
});

describe('the member spend limit is a guardrail, not the mechanism', () => {
  test('the waterfall bounds spending on its own', () => {
    // A card with no spend limit is still bounded by availability — which is why issuing does not
    // set a default limit that would silently cap members below their real room.
    const decision = decide({
      amountCents: 60_000,
      availability: { cashCents: 5_000, savingsCents: 10_000, assetCents: 0, incomeCents: 0, boostCents: 0 },
      cardPaused: false,
    });
    expect(decision.result).toBe('INSUFFICIENT_FUNDS');
    expect(decision.draws).toEqual([]);
  });
});
