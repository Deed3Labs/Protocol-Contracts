import { describe, expect, it } from 'bun:test';
import { splitQuote } from './split';
import { planSchedule, unitsToCents } from './planTerms';

/**
 * The figures both apps must agree on.
 *
 * These live here, not in either app, because that is what makes the guarantee enforceable: if the
 * merchant app and the member app ever disagree on a number for the same charge, this package is
 * wrong, and this file is what says so. A merchant reads the per-cycle figure off the counter
 * screen to a customer who is looking at the same figure on their phone. They have to match to the
 * cent, so they are asserted to the cent.
 */
const AMOUNT = 940;
const RATE = 0.02;

describe('the reference charge: $940 at 2% per cycle', () => {
  it('in full — carry $18.80, total $958.80', () => {
    const q = splitQuote(AMOUNT, 1, RATE);
    expect(q.carry).toBeCloseTo(18.8, 10);
    expect(q.total).toBeCloseTo(958.8, 10);
  });

  // Levelled (section 12.9): one payment a cycle, A·r / (1 − (1 + r)^−n). Rounded to the cent the
  // member is billed, as the screens show them.
  const cents = (n: number) => Number(n.toFixed(2));

  it('in 2 — $484.15 per cycle, carry $28.29, total $968.29', () => {
    const q = splitQuote(AMOUNT, 2, RATE);
    expect(cents(q.perCycle)).toBe(484.15);
    expect(cents(q.carry)).toBe(28.29);
    expect(cents(q.total)).toBe(968.29);
  });

  it('in 4 — $246.87 per cycle, carry $47.47, total $987.47 (section 12.9)', () => {
    const q = splitQuote(AMOUNT, 4, RATE);
    expect(cents(q.perCycle)).toBe(246.87);
    expect(cents(q.carry)).toBe(47.47);
    expect(cents(q.total)).toBe(987.47);
  });

  it('in 12 — $88.89 per cycle, carry $126.63, total $1,066.63', () => {
    const q = splitQuote(AMOUNT, 12, RATE);
    expect(cents(q.perCycle)).toBe(88.89);
    expect(cents(q.carry)).toBe(126.63);
    expect(cents(q.total)).toBe(1066.63);
  });

  it('agrees with the chain’s own schedule (planSchedule, TermIssuerBase._fixSchedule) to the cent', () => {
    for (const n of [1, 2, 4, 6, 12]) {
      const chain = planSchedule({ principal: 940_000_000n, ratePerCycleBps: 200, installments: n, installmentLengthSeconds: 30 * 86_400 });
      expect(cents(splitQuote(AMOUNT, n, RATE).perCycle)).toBe(unitsToCents(chain.payment) / 100);
    }
  });
});

describe('how the figures hang together', () => {
  it('carry accrues on the declining balance, not the opening one', () => {
    // Flat interest on the full amount for 4 cycles would be 940 * 0.02 * 4 = $75.20. Because the
    // balance declines as it is paid down, the real carry is materially less.
    const flat = AMOUNT * RATE * 4;
    expect(splitQuote(AMOUNT, 4, RATE).carry).toBeLessThan(flat);
  });

  it('payments are levelled — one figure per cycle, not a different one each time', () => {
    const q = splitQuote(AMOUNT, 12, RATE);
    expect(q.perCycle * q.splitInto).toBeCloseTo(q.total, 10);
  });

  it('the first cycle carries the whole balance once', () => {
    expect(splitQuote(AMOUNT, 4, RATE).carryThisCycle).toBeCloseTo(AMOUNT * RATE, 10);
  });

  it('principal is the amount split evenly; carry is everything on top', () => {
    const q = splitQuote(AMOUNT, 4, RATE);
    expect(q.principalPerCycle).toBeCloseTo(AMOUNT / 4, 10);
    expect(q.total - q.carry).toBeCloseTo(AMOUNT, 10);
  });

  it('a longer plan costs more carry, never less', () => {
    const carries = [1, 2, 4, 12].map((n) => splitQuote(AMOUNT, n, RATE).carry);
    for (let i = 1; i < carries.length; i++) expect(carries[i]).toBeGreaterThan(carries[i - 1]);
  });

  it('at zero rate the plan costs exactly the amount', () => {
    const q = splitQuote(AMOUNT, 4, 0);
    expect(q.carry).toBe(0);
    expect(q.total).toBe(AMOUNT);
    expect(q.perCycle).toBeCloseTo(AMOUNT / 4, 10);
  });

  it('treats a nonsensical split as paying in full rather than dividing by zero', () => {
    expect(splitQuote(AMOUNT, 0, RATE).splitInto).toBe(1);
    expect(splitQuote(AMOUNT, -3, RATE).splitInto).toBe(1);
  });
});
