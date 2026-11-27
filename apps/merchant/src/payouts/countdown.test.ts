import { describe, expect, test } from 'bun:test';
import type { PayoutPosition } from '../data/apiClient';
import { fromPosition, stillOwedCents } from './model';

const base: PayoutPosition = {
  owedCents: 9250,
  cashAccountCents: 3455,
  releasedReadyCents: 100,
  scheduledCents: 9150,
  readyToWithdrawCents: 3555,
  nextPayoutOn: null,
  clearsBalanceCents: 0,
  toBankCents: 9250,
  availableTodayCents: 100,
  paid: [],
};
const now = new Date('2026-10-15T19:00:00-07:00');

describe('net-30 on Payouts', () => {
  test('nothing withdrawn: nothing is counting, so the card says the terms', () => {
    const m = fromPosition(base, null, now);
    expect(m.daysLeft).toBeNull();
    expect(m.owedCents).toBe(9250);
  });

  test('a queued withdrawal counts down to its due day and stays in what is owed', () => {
    const m = fromPosition({ ...base, owedCents: 100, queuedCents: 9150, scheduledCents: 9150, releasesOn: '2026-11-14T19:00:00-07:00' }, null, now);
    expect(m.daysLeft).toBe(30);
    expect(m.owedCents).toBe(9250);
    expect(fromPosition({ ...base, queuedCents: 9150, releasesOn: '2026-10-25T12:00:00-07:00' }, null, now).daysLeft).toBe(10);
  });

  test('a scheduled payout day, when there is one, still wins', () => {
    expect(fromPosition({ ...base, nextPayoutOn: '2026-10-18T12:00:00-07:00', releasesOn: '2026-11-14T19:00:00-07:00' }, null, now).daysLeft).toBe(3);
  });

  test('an API older than queued money reads as nothing queued', () => {
    expect(stillOwedCents({ owedCents: 500 })).toBe(500);
  });
});
