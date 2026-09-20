import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forgetRemembered, hasRemembered, walletKey } from './rememberedState';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

// A small in-memory localStorage, so the device half can be exercised without a browser.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
const local = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: local };

describe('what a reopened app starts from', () => {
  beforeEach(() => forgetRemembered());

  test('a stored figure is found, and one older than 30 days is not', () => {
    local.setItem('clear:rem:v1:credit:0xabc', JSON.stringify({ v: { a: 1 }, at: Date.now() }));
    local.setItem('clear:rem:v1:credit:0xold', JSON.stringify({ v: { a: 1 }, at: Date.now() - 31 * 86_400_000 }));
    expect(hasRemembered('credit:0xabc')).toBe(true);
    expect(hasRemembered('credit:0xold')).toBe(false);
  });

  test('before the wallet has restored, keys fall back to the last wallet this device saw', () => {
    expect(walletKey('0xABC')).toBe('0xabc');
    expect(walletKey(undefined)).toBe('0xabc');
  });

  test('signing out forgets everything on the device, the last wallet included, and nothing else', () => {
    walletKey('0xabc');
    local.setItem('clear:rem:v1:pay:0xabc', JSON.stringify({ v: 1, at: Date.now() }));
    local.setItem('someone-else', 'kept');
    forgetRemembered();
    expect(hasRemembered('pay:0xabc')).toBe(false);
    expect(walletKey(undefined)).toBe('');
    expect(local.getItem('someone-else')).toBe('kept');
  });

  test('a corrupt entry is ignored, not thrown', () => {
    local.setItem('clear:rem:v1:earn:0xabc', '{not json');
    expect(hasRemembered('earn:0xabc')).toBe(false);
  });
});

describe('pages start from what they showed last, not from zeros', () => {
  test('Home, Activity, Card, Earn and Savings key their reads by wallet, with the cold-start fallback', () => {
    expect(read('pages/app/HomeRoute.tsx')).toContain('useRemembered<CreditState | null>(`credit:${walletKey(address)}`, null)');
    expect(read('pages/app/ActivityRoute.tsx')).toContain('useRemembered<CreditState | null>(`credit:${walletKey(address)}`, null)');
    expect(read('pages/app/CardRoute.tsx')).toContain('useRemembered<MemberCard[]>(`cards:${walletKey(address)}`, [])');
    expect(read('pages/app/EarnRoute.tsx')).toContain('useRemembered<EarnState | null>(`earn:${walletKey(address)}`, null)');
    expect(read('hooks/useSavingsData.ts')).toContain('useRemembered<PaySummary | null>(`pay:${walletKey(address)}`, null)');
    expect(read('hooks/useAutoRepay.ts')).toContain('useRemembered(`autorepay:${walletKey(address)}`, false)');
    expect(read('hooks/useCreditRepayments.ts')).toContain('`repayments:${walletKey(address)}`');
  });

  test('balances are remembered, and loading means nothing known rather than a fetch in flight', () => {
    const balances = read('hooks/useClearBalances.ts');
    expect(balances).toContain('`balances:${walletKey(address)}`');
    expect(balances).toContain('loading: !everLoaded && !lastKnown,');
  });

  test('the direct-deposit account and routing numbers never go to the device', () => {
    expect(read('pages/app/HomeRoute.tsx')).toMatch(/`home:lithic:\$\{walletKey\(address\)\}`,\s*null,[\s\S]{0,120}\{ device: false \}/);
  });

  test('a member signing out leaves nothing behind for the next', () => {
    expect(read('hooks/useLogout.ts')).toMatch(/clearStepUp\(\);[\s\S]{0,120}forgetRemembered\(\);/);
  });
});

describe('placeholders only while nothing is known', () => {
  test('pulling to refresh springs back and turns the figures into placeholders, with no spinner', () => {
    const pull = read('components/app-ui/PullToRefresh.tsx');
    expect(pull).toMatch(/setPullBoth\(0\);\s*refreshAllNow\(\);/);
    expect(pull).toContain("data-pending={refreshing ? '' : undefined}");
    expect(pull).not.toContain('Loader2');
  });

  test('the pool rate is a figure too, so it gets a placeholder', () => {
    expect(read('components/clear/YieldPoolCard.tsx')).toContain('<p className="c-apy">');
    expect(read('styles/clear-components.css')).toContain('[data-pending] .c-fig,[data-pending] .c-apy{width:fit-content;opacity:.55}');
  });

  test('each page marks itself pending until it has a figure or its first read has answered', () => {
    expect(read('pages/app/HomeRoute.tsx')).toContain('const pending = balancesLoading || (credit === null && !creditTried);');
    expect(read('pages/app/EarnRoute.tsx')).toContain('<PendingFigures pending={earn === null && !earnTried}>');
    expect(read('pages/app/CardRoute.tsx')).toContain('const pending = !loaded && !cardsTried;');
    expect(read('hooks/useSavingsData.ts')).toContain('pending: loading || (pay === null && !payTried),');
  });

  test('the card page shows a placeholder card, not the order-a-card screen, while pending', () => {
    const page = read('pages/app/CardPage.tsx');
    expect(page.indexOf('if (pending) {')).toBeLessThan(page.indexOf('if (!data.activated) {'));
  });

  test('figures keep their size as placeholders, and hold still for reduced motion', () => {
    const css = read('styles/clear-components.css');
    expect(css).toContain('[data-pending] .c-fig,[data-pending] .c-apy,.c-skel{');
    expect(css).toContain('@media (prefers-reduced-motion:reduce){[data-pending] .c-fig,[data-pending] .c-apy,.c-skel{animation:none}[data-pending] .c-det,[data-pending] .c-sub{animation:none}}');
  });

  test('Home while pending is the populated layout with placeholders, never day one or its setup steps', () => {
    const home = read('pages/app/HomePage.tsx');
    expect(home).toMatch(/const dayOne =\s*!pending &&/);
    expect(home).toContain('{!pending && <TaskStrip');
  });
});
