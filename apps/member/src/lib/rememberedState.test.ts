import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('pages start from what they showed last, not from zeros', () => {
  test('Home, Activity, Card and Earn keep their reads for the session, per wallet', () => {
    expect(read('pages/app/HomeRoute.tsx')).toContain("useRemembered<CreditState | null>(`credit:${address ?? ''}`, null)");
    expect(read('pages/app/ActivityRoute.tsx')).toContain("useRemembered<CreditState | null>(`credit:${address ?? ''}`, null)");
    expect(read('pages/app/CardRoute.tsx')).toContain("useRemembered<MemberCard[]>(`cards:${address ?? ''}`, [])");
    expect(read('pages/app/EarnRoute.tsx')).toContain("useRemembered<EarnState | null>(`earn:${address ?? ''}`, null)");
    expect(read('hooks/useCreditRepayments.ts')).toContain("useRemembered<CreditRepaymentEntry[]>(`repayments:${address ?? ''}`, [])");
  });

  test('a member signing out leaves nothing behind for the next', () => {
    expect(read('hooks/useLogout.ts')).toMatch(/clearStepUp\(\);[\s\S]{0,120}forgetRemembered\(\);/);
  });

  test('state starts from memory and every set is remembered', () => {
    const hook = read('lib/rememberedState.ts');
    expect(hook).toContain('useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial))');
    expect(hook).toContain('memory.set(key, resolved);');
  });

  test('Savings figures and the auto-repay switch are remembered too', () => {
    expect(read('hooks/useSavingsData.ts')).toContain("useRemembered<PaySummary | null>(`pay:${address ?? ''}`, null)");
    expect(read('hooks/useAutoRepay.ts')).toContain("useRemembered(`autorepay:${address ?? ''}`, false)");
  });
});
