import { describe, expect, test } from 'bun:test';
import type { MerchantCharge } from '@/data/apiClient';
import { filterRows, LATE_ROWS, raisedToday, REFERENCE_ROWS, rowFromApi, sections, shareLine, sortRows } from './model';

/** The reference's own figures, from docs/merchant-reference/clear-merchant-charges.html. */
describe('the list', () => {
  test('Raised today is $2,250.00, 40% approved so far', () => {
    const t = raisedToday(REFERENCE_ROWS);
    expect([t.totalCents, t.ok.cents, t.wait.cents, t.exp.n]).toEqual([225000, 90000, 135000, 0]);
    expect(shareLine(t)).toBe('40% approved so far');
  });

  test('late in the day it says paid, with the valve stems at $38.79', () => {
    const t = raisedToday(LATE_ROWS);
    expect(t.ok.cents).toBe(189931);
    expect(shareLine(t)).toBe('58% paid so far');
  });

  test('Waiting first, then one group a day', () => {
    const rows = sortRows(filterRows(REFERENCE_ROWS, { when: 'both', status: 'all', method: 'any', by: 'anyone' }), 'newest');
    const g = sections(rows, false).map((s) => [s.label, s.n ?? null, s.cents, s.expired]);
    expect(g).toEqual([
      ['Waiting', 2, 135000, 0],
      ['Confirmed today', 3, 90000, 0],
      ['Yesterday', null, 124000, 1],
    ]);
  });

  test('This month counts 31', () => {
    expect(filterRows(REFERENCE_ROWS, { when: 'month', status: 'all', method: 'any', by: 'anyone' })).toHaveLength(31);
  });
});

describe('a charge from the API', () => {
  const now = new Date(2026, 8, 22, 14, 28).getTime();
  const base: MerchantCharge = {
    code: 'ABC123',
    amount: 410,
    state: 'waiting',
    splitInto: null,
    paidNow: false,
    memberName: 'Nina P.',
    raisedBy: 'Jen R.',
    raisedByStaffId: 's_jen',
    createdAt: new Date(2026, 8, 22, 14, 26).toISOString(),
    expiresAt: new Date(2026, 8, 23, 14, 26).toISOString(),
    openedAt: null,
    resolvedAt: null,
  };

  test('waiting says when it was sent', () => {
    const r = rowFromApi(base, now);
    expect([r.name, r.amountCents, r.state, r.time, r.by, r.note, r.day]).toEqual(['Nina P.', 41000, 'waiting', '2:26pm', 'Jen', 'sent 2 minutes ago', 0]);
  });

  test('confirmed says the plan; expired says for how long it waited', () => {
    expect(rowFromApi({ ...base, state: 'approved', splitInto: 4 }, now).note).toBe('4 payments');
    expect(rowFromApi({ ...base, state: 'approved', paidNow: true }, now).note).toBe('paid now');
    // One payment is a plan too: cleared at the end of the cycle, with its carry.
    expect(rowFromApi({ ...base, state: 'approved', splitInto: 1 }, now).note).toBe('next cycle');
    expect(rowFromApi({ ...base, state: 'expired' }, now).note).toBe('not approved in 24 hours');
  });
});
