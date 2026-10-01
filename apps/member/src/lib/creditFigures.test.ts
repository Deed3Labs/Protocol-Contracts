import { describe, expect, test } from 'bun:test';
import type { CreditState } from '@/utils/apiClient';
import { cycleStartOf, partnerCreditOf } from './creditFigures';

const credit = (over: Partial<CreditState> = {}): CreditState =>
  ({ wallet: '0x', tiers: [], plans: [], cycle: null, savingsEncumberedCents: null, term: null, source: 'chain', complete: true, ...over }) as CreditState;
const term = (available: number, suspended = false) => ({ limitCents: 100_000, usedCents: 100_000 - available, availableCents: available, carryOwedCents: 0, suspended });

describe('the figures under the member’s code', () => {
  test('At partners is what’s left of the term line (what a pay-over-time plan draws on)', () => {
    expect(partnerCreditOf(credit({ term: term(5_001_00) }))).toBe(5_001);
    expect(partnerCreditOf(credit({ term: term(0) }))).toBe(0);
  });
  test('paused after a default: nothing to split; not read yet: no figure rather than a zero', () => {
    expect(partnerCreditOf(credit({ term: term(5_000_00, true) }))).toBe(0);
    expect(partnerCreditOf(credit({ term: null }))).toBeUndefined();
    expect(partnerCreditOf(null)).toBeUndefined();
  });
  test('the cycle start, in ms; none readable is 0', () => {
    expect(cycleStartOf(credit({ cycle: { issuedAt: 1_790_000_000, expiration: 0 } as never }))).toBe(1_790_000_000_000);
    expect(cycleStartOf(credit({ complete: false, cycle: { issuedAt: 1_790_000_000, expiration: 0 } as never }))).toBe(0);
    expect(cycleStartOf(null)).toBe(0);
  });
});
