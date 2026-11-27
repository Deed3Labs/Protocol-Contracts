import { describe, expect, test } from 'bun:test';
import type { MemberCharge } from '@/utils/apiClient';
import { chargeActivityRows, chargeLabel, groupChargesByDay, latestCharges, viewCharges, waitingSummary } from './memberCharges';
import { mergedActivityRows } from './activityMapping';
import { destinationFor } from './notificationsAdapter';

const at = (d: number, h = 12) => new Date(2026, 8, d, h).toISOString();
const c = (code: string, over: Partial<MemberCharge>): MemberCharge => ({
  code, merchantName: 'MiMi Crack', amountCents: 5000, status: 'pending', paidNow: false, splitInto: null,
  createdAt: at(27), resolvedAt: null, expiresAt: at(28), payingNow: false, ...over,
});

const waiting = c('W1', {});
const paying = c('P1', { status: 'resolving', payingNow: true });
const paidNow = c('N1', { status: 'approved', paidNow: true, resolvedAt: at(26) });
const overTime = c('O1', { status: 'approved', splitInto: 4, resolvedAt: at(25), merchantName: 'Mike’s Tire', amountCents: 94000 });
const declined = c('D1', { status: 'declined', resolvedAt: at(24) });
const expired = c('E1', { status: 'expired', expiresAt: at(23) });
const refunded = c('R1', { status: 'refunded', splitInto: 2, resolvedAt: at(22) });
const all = [declined, overTime, waiting, expired, paidNow, paying, refunded];

describe('shop charges, as the member sees them', () => {
  test('each says what became of it', () => {
    expect(all.map(chargeLabel)).toEqual(['Declined', 'Over time · 4 payments', 'Waiting on you', 'Expired', 'Paid now', 'Paying now', 'Refunded']);
    expect(chargeLabel(c('X', { status: 'approved', splitInto: 1 }))).toBe('Next cycle');
    expect(chargeLabel(c('X', { status: 'cancelled' }))).toBe('Cancelled by the shop');
  });

  test('filters, search by shop, amount or code, and sorts', () => {
    expect(viewCharges(all, { filter: 'waiting' }).map((x) => x.code)).toEqual(['W1', 'P1']);
    expect(viewCharges(all, { filter: 'approved' }).map((x) => x.code)).toEqual(['N1', 'O1']);
    expect(viewCharges(all, { filter: 'notCharged' }).map((x) => x.code)).toEqual(['D1', 'E1']);
    expect(viewCharges(all, { query: 'mike' }).map((x) => x.code)).toEqual(['O1']);
    expect(viewCharges(all, { query: '$940' }).map((x) => x.code)).toEqual(['O1']);
    expect(viewCharges(all, { query: 'r1' }).map((x) => x.code)).toEqual(['R1']);
    expect(viewCharges(all, { sort: 'largest' })[0]!.code).toBe('O1');
    expect(viewCharges(all, { sort: 'oldest' })[0]!.code).toBe('R1');
  });

  test('Send leads with what waits on them; the hero adds it up', () => {
    // Waiting on them first, then newest: the one paying now (today), then yesterday's paid-now.
    expect(latestCharges(all, 3).map((x) => x.code)).toEqual(['W1', 'P1', 'N1']);
    expect(waitingSummary(all)).toEqual({ count: 1, cents: 5000 });
  });

  test('grouped by day, newest first', () => {
    const groups = groupChargesByDay(viewCharges(all, {}), new Date(2026, 8, 27, 18));
    expect(groups[0]!.day).toBe('Today');
    expect(groups[1]!.day).toBe('Yesterday');
  });
});

describe('shop charges in Activity', () => {
  test('the ones Activity had no row for: waiting opens it, over time is spending, never charged is struck', () => {
    const rows = chargeActivityRows(all).map((r) => r.row);
    // Paid now is already a row (folded from its transfers), so it isn't listed again.
    expect(rows.map((r) => r.chargeCode)).toEqual(['D1', 'O1', 'W1', 'E1', 'P1', 'R1']);
    const byCode = Object.fromEntries(rows.map((r) => [r.chargeCode, r]));
    expect(byCode.W1).toMatchObject({ pending: true, pendingLabel: 'Waiting', tagLabel: 'Waiting on you' });
    expect(byCode.O1).toMatchObject({ amount: -940, tagLabel: 'Over time · 4 payments' });
    expect(byCode.O1!.pending).toBeUndefined();
    expect(byCode.D1).toMatchObject({ reversed: true, reversedLabel: 'Declined' });
    expect(byCode.E1).toMatchObject({ reversed: true, reversedLabel: 'Expired' });
  });

  test('merged with everything else, newest first', () => {
    const rows = mergedActivityRows([], [], undefined, [], [], [waiting, declined]);
    expect(rows.map((r) => r.chargeCode)).toEqual(['W1', 'D1']);
  });
});

describe('a charge alert opens the charge', () => {
  test('not Send', () => {
    expect(destinationFor('request', { chargeCode: '55DCQ9PR' })).toEqual({ label: 'Review charge', to: '/c/55DCQ9PR' });
    expect(destinationFor('request', null)).toEqual({ label: 'Open Send', to: '/send' });
  });
});
