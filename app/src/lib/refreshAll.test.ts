import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
/*
 * Comments are stripped before matching. Several guards in this repo have passed by matching the
 * prose explaining the thing rather than the thing, including one that described the exact bug it
 * was supposed to catch.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
 * Reported from the demo, on mobile: after a savings deposit the credit limit and vesting credits
 * did not move, and pull-to-refresh did nothing about it.
 *
 * Both refresh channels worked. No trigger fired both. `clear:activity` reached balances,
 * transactions and linked wallets; the chain-stale signal reached credit, savings, home, earn and
 * card. Pull-to-refresh dispatched the first alone, and the socket -- the only thing that fired the
 * second -- is transient and cannot reach a backgrounded PWA. So on a phone there was no path to a
 * fresh credit limit short of a hard reload.
 */
describe('refreshAllNow', () => {
  test('fires both refresh channels, not just one', async () => {
    const win = new EventTarget() as EventTarget & { location: { search: string } };
    win.location = { search: '' };
    (globalThis as unknown as { window: unknown }).window = win;

    const { onChainStale } = await import('./chainStale');
    const { refreshAllNow } = await import('./refreshAll');

    let chainReads = 0;
    let activityEvents = 0;
    const stopChain = onChainStale(() => { chainReads += 1; });
    win.addEventListener('clear:activity', () => { activityEvents += 1; });

    refreshAllNow();

    // The chain half is what pull-to-refresh was missing: this is the assertion that would have failed.
    expect(chainReads).toBe(1);
    expect(activityEvents).toBe(1);
    stopChain();
  });

  test('reads once rather than scheduling a backoff', async () => {
    // Settled, not stale. A member watching a spinner is not served by three more reads over 15s.
    const fn = code('lib/refreshAll.ts');
    expect(fn).toContain('markChainSettled()');
    expect(fn).not.toContain('markChainStale');
  });
});

describe('every manual refresh trigger goes through it', () => {
  test('pull-to-refresh does not dispatch clear:activity on its own', () => {
    const src = code('components/app-ui/PullToRefresh.tsx');
    expect(src).toContain('refreshAllNow()');
    // The regression itself: dispatching the DOM half directly refreshes balances and leaves credit stale.
    expect(src).not.toMatch(/dispatchEvent\(\s*new Event\('clear:activity'\)\s*\)/);
  });

  test('resuming from the background re-reads, and the shell mounts it', () => {
    const hook = code('hooks/useRefreshOnResume.ts');
    expect(hook).toContain('refreshAllNow()');
    expect(hook).toContain("addEventListener('visibilitychange'");
    // A hook nothing calls is the failure mode this file exists to catch.
    expect(code('components/shell/AppShell.tsx')).toContain('useRefreshOnResume()');
  });
});

describe('a notification that says a figure moved, moves it', () => {
  test('credit notifications refresh, not just money ones', () => {
    /*
     * A savings deposit emits a `credit` notification. If that arrives and the limit beside it stays
     * stale, this is the original bug wearing a bell -- the member is now being *told* about a number
     * the screen is not showing.
     */
    const hook = code('hooks/useNotifications.ts');
    expect(hook).toMatch(/n\.kind === 'credit'[\s\S]{0,40}refreshAllNow\(\)/);
  });
});
