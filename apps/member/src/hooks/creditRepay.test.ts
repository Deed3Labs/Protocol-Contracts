import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
const hook = read('hooks/useCreditRepay.ts');
const dialog = read('components/clear/RepayDialog.tsx');
const calls = read('lib/sendCalls.ts');

describe('Repay repays on chain, in USDC, from the member’s wallet', () => {
  test('one sponsored batch: approve USDC to StableCredit, then repayCreditBalance — Face ID first', () => {
    expect(calls).toContain("functionName: 'repayCreditBalance', args: [args.ownerWallet as `0x${string}`, amt]");
    expect(calls).toMatch(/export async function scRepayCredit[\s\S]{0,700}return runBatch\(/);
    expect(calls).toMatch(/async function runBatch[\s\S]{0,200}await requireStepUp\(\)/);
  });

  test('never more than has settled on chain; the pending rest is named, not dropped', () => {
    expect(hook).toContain('const repay = Math.min(amount, owed);');
    expect(hook).toContain('pendingLeft: Math.max(0,');
  });

  test('the server records it from the transaction', () => {
    expect(hook).toContain('await recordCreditRepayment(address, hash)');
  });

  test('carrying a balance, the amount cannot go past the debt — nothing spills to a card it cannot reach', () => {
    expect(dialog).toContain('const capped = Math.min(Math.max(0, amount), source, carrying ? outstanding : Infinity);');
    expect(dialog).toContain('onClick={carrying ? () => void repay() : undefined}');
  });
});

describe('repay savings-backed credit from savings', () => {
  test('offered only when savings-backed credit is used; settles the savings tier and nothing else', () => {
    expect(dialog).toContain("{carrying && savingsUsed > 0 && (");
    expect(dialog).toContain("credit.tiers.filter((t) => t.key === 'savings').map((tier) => ({ tier, applied: capped }))");
  });

  test('one sponsored call to the Liquidator, against the savings tier, through the revolving issuer', () => {
    expect(calls).toContain("functionName: 'settleFromSavings', args: [c.revolvingIssuer, SAVINGS_TIER_ID, amt]");
    expect(calls).toContain('export const SAVINGS_TIER_ID = 0n;');
  });

  test('capped at what the savings tier owes on chain, and recorded by the server', () => {
    expect(hook).toContain("functionName: 'principalOf',");
    expect(hook.match(/await recordCreditRepayment\(address, hash\)/g)).toHaveLength(2);
  });
});
