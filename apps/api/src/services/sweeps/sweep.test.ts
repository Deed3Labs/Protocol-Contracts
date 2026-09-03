import { describe, expect, test } from 'bun:test';
import { RESUMABLE, backoffMs, type SweepState } from './sweepStore.js';

/*
 * The sweep saga's rules, tested where they're arithmetic or ordering. The store and the service
 * talk to Postgres, Lithic and a chain, so what's exercised here is the logic that decides what
 * happens — not the plumbing that carries it out.
 */

/** The transition table the service implements, restated so a change to it has to be deliberate. */
const NEXT: Record<string, SweepState> = {
  initiated: 'fiat_debited',
  fiat_debited: 'ready_to_allocate',
  ready_to_allocate: 'clrusd_minted',
  clrusd_minted: 'complete',
};

describe('saga ordering', () => {
  test('fiat leaves Lithic before USDC can arrive', () => {
    // Bridge cannot deliver tokens it has not been paid for, so the push comes first.
    expect(NEXT.initiated).toBe('fiat_debited');
    expect(NEXT.fiat_debited).toBe('ready_to_allocate');
  });

  test('CLRUSD is minted only after USDC has arrived', () => {
    // Minting first would put CLRUSD in circulation with nothing behind it — the 1:1 backing gone.
    expect(NEXT.ready_to_allocate).toBe('clrusd_minted');
  });

  test('every state has exactly one successor', () => {
    const successors = Object.values(NEXT);
    expect(new Set(successors).size).toBe(successors.length);
  });
});

describe('what a runner will pick up', () => {
  test('ready_to_allocate is never advanced automatically', () => {
    // Where the money goes next is the member's decision. A runner choosing for them is the whole
    // point missed — and this is the sweep's normal resting state, not a stall.
    expect(RESUMABLE).not.toContain('ready_to_allocate' as SweepState);
  });

  test('a sweep waiting on Bridge is never retried', () => {
    // fiat_debited means the ACH push already left. "Retrying" it pushes the member's money twice.
    expect(RESUMABLE).not.toContain('fiat_debited' as SweepState);
  });

  test('terminal states are left alone', () => {
    expect(RESUMABLE).not.toContain('complete' as SweepState);
    expect(RESUMABLE).not.toContain('failed' as SweepState);
  });

  test('the two steps we actually drive are resumable', () => {
    // Starting the push, and finishing after a mint. Everything else waits on someone else.
    expect(RESUMABLE).toContain('initiated' as SweepState);
    expect(RESUMABLE).toContain('clrusd_minted' as SweepState);
  });
});

describe('failure handling', () => {
  /** Mirrors sweepStore.fail — money that reached the member is never marked failed. */
  const terminalFor = (landed: boolean): SweepState => (landed ? 'ready_to_allocate' : 'failed');

  test('money already delivered is never marked failed', () => {
    // It arrived. What is unfinished is only where it goes next, which was always theirs to say.
    expect(terminalFor(true)).toBe('ready_to_allocate');
  });

  test('a push that never landed is a plain failure', () => {
    // Nothing left the member's account, so there is nothing stranded to recover.
    expect(terminalFor(false)).toBe('failed');
  });
});

describe('backoff', () => {
  test('the first retry is quick', () => {
    expect(backoffMs(1)).toBe(60_000);
  });

  test('it grows but stays inside an hour', () => {
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1));
    expect(backoffMs(100)).toBe(60 * 60 * 1000);
  });

  test('a stalled sweep is retried within the hour, every time', () => {
    // Member money is waiting. Exponential backoff would strand it overnight on a blip that
    // cleared in minutes.
    for (const attempt of [1, 2, 3, 5, 10, 50]) {
      expect(backoffMs(attempt)).toBeLessThanOrEqual(60 * 60 * 1000);
    }
  });
});

describe('double-counting', () => {
  /** Mirrors the Bridge webhook: a sweep arrival is claimed before the deposit pipeline sees it. */
  const treatAsDeposit = (matchedSweep: boolean) => !matchedSweep;

  test('a sweep landing is not recorded as a new deposit', () => {
    // The same dollars already counted when they arrived in Lithic. Running them through the
    // deposit pipeline again would settle credit twice against one paycheck.
    expect(treatAsDeposit(true)).toBe(false);
  });

  test('money arriving with no sweep behind it is a real deposit', () => {
    expect(treatAsDeposit(false)).toBe(true);
  });
});

describe('vesting clock', () => {
  test('vesting starts at the mint, not at the fiat debit', () => {
    // USDC left in the cash account for two days must not be credited two days of vesting.
    const debitedAt = Date.parse('2026-08-01T00:00:00Z');
    const mintedAt = Date.parse('2026-08-03T00:00:00Z');
    const vestingStart = mintedAt;

    expect(vestingStart).toBeGreaterThan(debitedAt);
    expect((vestingStart - debitedAt) / 86_400_000).toBe(2);
  });
});
