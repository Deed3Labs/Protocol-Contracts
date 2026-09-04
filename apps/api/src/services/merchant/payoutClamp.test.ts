import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const STORE = readFileSync(new URL('./profileStore.ts', import.meta.url), 'utf8');

/**
 * `Math.max(0, owed - clawback)` swallowed a refund larger than what a merchant was currently
 * owed — exactly the case where they had already been paid for the sale being given back. The
 * co-op absorbed the difference and no record of it existed anywhere.
 */
describe('a clawback bigger than the pool is carried, not dropped', () => {
  test('the overdraw is computed rather than clamped away', () => {
    expect(STORE).toContain('const gross = owedCents - clawbackCents;');
    expect(STORE).toContain('const clawbackOwedCents = Math.max(0, -gross);');
  });

  test('it is reported beside what is owed', () => {
    expect(STORE).toContain('clawbackOwedCents,');
  });

  test('the empty-database shape carries it too, so a caller never reads undefined', () => {
    const fallback = STORE.slice(STORE.indexOf('if (!pool) {'), STORE.indexOf('const m = normalize'));
    expect(fallback).toContain('clawbackOwedCents: 0');
  });

  test('a payout itself still cannot go negative', () => {
    expect(STORE).toContain('const net = Math.max(0, gross);');
  });
});
