import { describe, expect, test } from 'bun:test';
import type { CreditState } from '@/utils/apiClient';
import { cycleStartOf } from './creditFigures';

const credit = (over: Partial<CreditState> = {}): CreditState =>
  ({ wallet: '0x', tiers: [], plans: [], cycle: null, savingsEncumberedCents: null, term: null, source: 'chain', complete: true, ...over }) as CreditState;

describe('the credit cycle’s start', () => {
  test('the cycle start, in ms; none readable is 0', () => {
    expect(cycleStartOf(credit({ cycle: { issuedAt: 1_790_000_000, expiration: 0 } as never }))).toBe(1_790_000_000_000);
    expect(cycleStartOf(credit({ complete: false, cycle: { issuedAt: 1_790_000_000, expiration: 0 } as never }))).toBe(0);
    expect(cycleStartOf(null)).toBe(0);
  });
});
