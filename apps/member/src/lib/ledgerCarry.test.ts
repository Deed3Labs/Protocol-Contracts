import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cycleShortfall, cycleStatus, mustClear, type Credit } from './clearModel';
import { toCredit } from './creditMapping';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

const bare: Credit = { tiers: [], carryCost: 0, carryFreeUnder: 0 };
const drawn = (used: number): Credit => ({
  ...bare,
  tiers: [{ key: 'income', label: 'Income-backed', rate: '1.5%', used, limit: 1000, added: true }],
});

/*
 * Carry a closed plan leaves on the ledger. A refund returns what the member paid and not the carry
 * they owed for holding the money, so it is real, and the chain reads the same balance to decide
 * whether their line is clear -- three cents of it stops a cycle renewing and freezes the line.
 */
describe('carry a closed plan left behind', () => {
  test('a line holding only that is not clear, whatever the tiers say', () => {
    expect(cycleStatus({ ...bare, ledgerCarry: 0.03 })).not.toBe('clear');
    expect(cycleStatus(bare)).toBe('clear');
  });

  test('it is what must clear, on top of any unsecured draw', () => {
    expect(mustClear({ ...bare, ledgerCarry: 0.03 })).toBe(0.03);
    expect(mustClear({ ...drawn(700), ledgerCarry: 0.03 })).toBe(700.03);
    expect(mustClear(drawn(700))).toBe(700);
  });

  test('a deposit that covers a draw has to cover this too', () => {
    // 700 coming in against 700 drawn used to leave the shortfall at zero with carry still owed.
    expect(cycleShortfall({ ...drawn(700), ledgerCarry: 0.03 }, 700)).toBeCloseTo(0.03, 5);
    expect(cycleShortfall(drawn(700), 700)).toBe(0);
  });

  test('a secured-only line with carry on it is not reported as owing nothing', () => {
    const savings: Credit = {
      ...bare,
      tiers: [{ key: 'savings', label: 'Savings', rate: 'free', used: 500, limit: 3000, added: true }],
      ledgerCarry: 0.03,
    };
    expect(cycleStatus(savings)).not.toBe('secured');
  });

  test('the mapping keeps the figure as well as charging it as carry', () => {
    const credit = toCredit([], bare, 3);
    expect(credit.ledgerCarry).toBeCloseTo(0.03, 5);
    expect(credit.carryCost).toBeCloseTo(0.03, 5);
  });
});

describe('what the cycle card says about it', () => {
  const card = read('components/clear/CycleCard.tsx');

  test('it says where the money came from, since no purchase of theirs explains it', () => {
    expect(card).toContain("lead = onlyLedgerCarry ? 'Carry from a plan you closed'");
    expect(card).toContain('clear it to keep the line open');
  });

  test('never "nothing due" over it, and the action is Repay rather than Repay early', () => {
    expect(card).toMatch(/action = onlyLedgerCarry\s*\?\s*\{ label: 'Repay', primary: true/);
    expect(card).toMatch(/detail = onlyLedgerCarry[\s\S]{0,140}: `Carrying \$\{money\(toClear, \{ cents: true \}\)\} unsecured · nothing due`/);
  });
});
