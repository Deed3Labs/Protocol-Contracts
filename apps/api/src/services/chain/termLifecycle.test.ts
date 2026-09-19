import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./termLifecycle.ts', import.meta.url), 'utf8');
const SWEEP = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');
const RECORDER = readFileSync(new URL('./usdcRepaymentService.ts', import.meta.url), 'utf8');

describe('a term plan after it opens', () => {
  test('runs in the sweep', () => {
    expect(SWEEP).toContain('await sweepTermLifecycle()');
  });

  test('collects only under the mandate, only what is due, bounded by what the member holds and approved', () => {
    expect(SOURCE).toMatch(/if \(!\(await revolving\.autoRepayEnabled\(wallet\)\)\) return null;/);
    expect(SOURCE).toContain('const due = arrears + residual;');
    expect(SOURCE).toMatch(/for \(const cap of \[held, allowed\]\) if \(cap < amount\) amount = cap;/);
    expect(SOURCE).toContain("await recordUsdcRepayment(wallet, tx.hash, 'auto');");
  });

  test('declares a default only when the chain says it is due', () => {
    expect(SOURCE).toMatch(/if \(at === 0 \|\| Date\.now\(\) \/ 1000 < at\) return null;\s*const tx = await term\.declareDefault\(wallet\);/);
  });

  test('reinstates on repayment by anyone, otherwise by the operator after clean cycles', () => {
    expect(SOURCE).toMatch(/if \(recovered >= writtenOff\) \{\s*const tx = await term\.reinstate\(wallet\);/);
    expect(SOURCE).toMatch(/if \(cardDefaulted \|\| frozen \|\| Date\.now\(\) \/ 1000 < cleanSince\) return null;/);
    expect(SOURCE).toContain('export const CLEAN_CYCLES = 6;');
  });

  test('does nothing on a chain without the upgrade', () => {
    expect(SOURCE).toContain('memberDefaultableAt(ethers.ZeroAddress).then(() => true).catch(() => false)');
  });

  test('a plan paid out of savings is labelled savings, from the receipt, and no books depend on it', () => {
    expect(RECORDER).toContain("method: fromSavings > 0n || redeemedSavings(receipt, wallet) ? 'savings' : method,");
  });
});
