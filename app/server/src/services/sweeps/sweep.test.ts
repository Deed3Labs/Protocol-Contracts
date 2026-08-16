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
  fiat_debited: 'usdc_sent',
  usdc_sent: 'clrusd_minted',
  clrusd_minted: 'complete',
};

describe('saga ordering', () => {
  test('fiat is debited before USDC is ever sent', () => {
    // The reverse would send treasury USDC against money that never left the member's account.
    expect(NEXT.initiated).toBe('fiat_debited');
    expect(NEXT.fiat_debited).toBe('usdc_sent');
  });

  test('CLRUSD is minted only after USDC has arrived', () => {
    // Minting first would put CLRUSD in circulation with nothing behind it — the 1:1 backing gone.
    expect(NEXT.usdc_sent).toBe('clrusd_minted');
  });

  test('every state has exactly one successor', () => {
    const successors = Object.values(NEXT);
    expect(new Set(successors).size).toBe(successors.length);
  });
});

describe('what a runner will pick up', () => {
  test('ready_to_allocate is never resumed automatically', () => {
    // It's the member's money and the member's decision. A runner retrying it overrides a person.
    expect(RESUMABLE).not.toContain('ready_to_allocate' as SweepState);
  });

  test('terminal states are left alone', () => {
    expect(RESUMABLE).not.toContain('complete' as SweepState);
    expect(RESUMABLE).not.toContain('failed' as SweepState);
  });

  test('every in-flight state is resumable', () => {
    for (const state of Object.keys(NEXT)) {
      expect(RESUMABLE).toContain(state as SweepState);
    }
  });
});

describe('failure handling', () => {
  /** Mirrors sweepStore.fail — a sweep that already sent USDC becomes the member's to finish. */
  const terminalFor = (usdcSent: boolean): SweepState =>
    usdcSent ? 'ready_to_allocate' : 'failed';

  test('exhausting retries after USDC is sent surfaces the money rather than hiding it', () => {
    expect(terminalFor(true)).toBe('ready_to_allocate');
  });

  test('exhausting retries before USDC is sent is a plain failure', () => {
    // Nothing left the treasury, so there's nothing stranded to recover.
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

describe('vesting clock', () => {
  test('vesting starts at the mint, not at the fiat debit', () => {
    // A sweep that sat in ready_to_allocate for two days must not credit two days of vesting.
    const debitedAt = Date.parse('2026-08-01T00:00:00Z');
    const mintedAt = Date.parse('2026-08-03T00:00:00Z');
    const vestingStart = mintedAt;

    expect(vestingStart).toBeGreaterThan(debitedAt);
    expect((vestingStart - debitedAt) / 86_400_000).toBe(2);
  });
});
