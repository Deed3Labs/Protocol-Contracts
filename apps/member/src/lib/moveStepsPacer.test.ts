import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stepPacer, stepsFor } from './moveSteps';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('the progress dots move', () => {
  test('each dot is shown in turn, never skipped, and waits its moment', async () => {
    const shown: number[] = [];
    let waits = 0;
    const pace = stepPacer((s) => shown.push(s), 450, async () => void waits++);
    await pace.to(2);
    expect(shown).toEqual([1, 2]);
    expect(waits).toBe(2);
    // Asking again for where it already is does nothing; the walk is one way.
    await pace.to(1);
    expect(shown).toEqual([1, 2]);
  });

  test('two calls at once share one walk (the confirm callback and the final await)', async () => {
    const shown: number[] = [];
    const pace = stepPacer((s) => shown.push(s), 0, async () => {});
    await Promise.all([pace.to(2), pace.to(2)]);
    expect(shown).toEqual([1, 2]);
  });

  test('a shown step reads: earlier done, this one in flight, later waiting', () => {
    expect(stepsFor(['a', 'b', 'c'], 1, 'processing').map((s) => s.state)).toEqual(['done', 'active', 'waiting']);
  });

  test('savings, pool and bond moves walk the dots before done', () => {
    const savings = read('hooks/useSavingsMove.ts');
    expect(savings).toContain('hash = await sponsored({ smartWalletClient: chainClient, ownerWallet: address, amount: amountStr, chainId, onConfirmed });');
    expect(savings).toMatch(/await pace\.to\(stepLabelsLength - 1\);\s*setTxHash\(hash\);\s*setProgress\(\{ status: 'done'/);
    expect(read('hooks/usePoolMove.ts')).toMatch(/await pace\.to\(2\);\s*setTxHash\(hash\);\s*setProgress\(\{ status: 'done', step: 3 \}\);/);
    expect(read('components/clear/ConnectedBuyBond.tsx')).toMatch(/await pace\.to\(2\);\s*setProgress\(\{ status: 'done', step: 3 \}\);/);
    // The deposit's last dot is in flight while the credits are recorded, not before the money moved.
    expect(read('lib/sendCalls.ts')).toMatch(/args\.onConfirmed\?\.\(\);\s*await recordGaslessSavings\(\{ action: 'deposit'/);
  });
});
