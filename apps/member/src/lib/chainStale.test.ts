import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/*
 * Reported from the demo: balances moved after a deposit and the credit limit did not, until the
 * member changed page.
 *
 * The mechanism existed and was wired to one third of the app: the savings move signalled, the
 * pool and bond moves did not, and Home was the only listener. So a pool deposit updated a cash
 * balance and left every figure derived from it — the limit, the position, the bond list — showing
 * what was true before.
 *
 * These tests are about coverage rather than behaviour, because that is what was wrong.
 */

const MOVERS = [
  'components/clear/ConnectedMoveMoney.tsx',
  'components/clear/ConnectedPoolMove.tsx',
  'components/clear/ConnectedBuyBond.tsx',
];

const READERS = ['pages/app/HomeRoute.tsx', 'pages/app/EarnRoute.tsx', 'pages/app/SavingsRoute.tsx'];

describe('everything that moves money says so', () => {
  for (const mover of MOVERS) {
    test(`${mover.split('/').pop()} signals`, () => {
      expect(read(mover)).toContain('markChainStale()');
    });
  }
});

/**
 * Which chain-derived reads each route makes, and therefore which have to refresh.
 *
 * Named per file rather than checked in the abstract, because "the file mentions onChainStale"
 * was the assertion that let this through the first time: HomeRoute listened for its credit read
 * and not for its equity read, the test saw the listener and passed, and the credits feeding the
 * savings card and the ELPA row stayed stale until a page change.
 */
const CHAIN_READS: Record<string, string[]> = {
  'pages/app/HomeRoute.tsx': ['getCredit(address)', 'getPaySummary(address)'],
  'pages/app/EarnRoute.tsx': ['getEarn(address)', 'getPaySummary(address)'],
  'pages/app/SavingsRoute.tsx': ['getPaySummary(address)'],
};

describe('everything that reads chain state listens', () => {
  for (const reader of READERS) {
    test(`${reader.split('/').pop()} re-reads`, () => {
      expect(read(reader)).toContain('onChainStale(');
    });
  }

  for (const [file, calls] of Object.entries(CHAIN_READS)) {
    test(`${file.split('/').pop()} refreshes every read it makes, not just one`, () => {
      const source = read(file);
      // Each call has to sit inside the `read` the listener re-runs. Anything outside it is a
      // figure that goes stale the moment somebody moves money.
      const readFn = source.slice(source.indexOf('const read = () => {'), source.indexOf('onChainStale('));
      expect(readFn.length).toBeGreaterThan(0);
      for (const call of calls) expect(readFn).toContain(call);
    });
  }

  test('and each one tears its listener down', () => {
    // A refetch firing into a component nobody is looking at is waste at best, and a state update
    // on something unmounted at worst.
    for (const reader of READERS) expect(read(reader)).toContain('stopListening()');
  });
});

describe('the signal itself', () => {
  test('is one module, not a string repeated across files', () => {
    // It drifted as a bare event name: one dispatcher, one listener, and no way to notice the
    // other four places that needed it.
    const stale = read('lib/chainStale.ts');
    expect(stale).toContain("const STALE = 'clear:chain-stale'");
    expect(stale).toContain("const SETTLED = 'clear:chain-settled'");
    for (const f of [...MOVERS, ...READERS]) {
      expect(read(f)).not.toContain("'clear:chain-stale'");
      expect(read(f)).not.toContain("'clear:chain-settled'");
      expect(read(f)).not.toContain("'clear:credit-stale'");
    }
  });

  test('refetches rather than predicting the figure', () => {
    // The server still has to pledge and push after the transfer lands, so for a few seconds the
    // old limit is the true one. Asserted as a property of the code rather than by scanning the
    // file, which contains a paragraph explaining the rule and matched a naive regex for it.
    const stale = read('lib/chainStale.ts');
    expect(stale).toContain('BACKOFF_MS');
    // It re-runs a caller's read and computes nothing: no figure to be wrong about.
    expect(stale).toContain('onChainStale(read: () => void)');
    expect(stale).toMatch(/for \(const delay of BACKOFF_MS\) timers\.push\(setTimeout\(/);
    expect(stale).toMatch(/read\(\);/);
  });

  test('and survives having no window', () => {
    const stale = read('lib/chainStale.ts');
    // Three entry points, three guards: two dispatchers and the subscriber.
    expect(stale.split("typeof window === 'undefined'").length - 1).toBe(3);
  });
});

/*
 * The two signals, and why the split matters.
 *
 * A backoff is a guess about when the server's writes finish. The server knows exactly, and the
 * app already holds a socket per wallet — so the guess became the fallback for a member whose
 * socket is not connected, and the exact answer does the work.
 *
 * It also fixes something the local event could never do: a `window` event does not leave the
 * window it was dispatched in, so a deposit made on a desktop left a phone showing old figures
 * until it was reopened. The server broadcasts to the wallet, not to the tab that asked.
 */
describe('hearing it from the server beats guessing', () => {
  test('a settled signal reads at once, with nothing scheduled', () => {
    const stale = read('lib/chainStale.ts');
    expect(stale).toMatch(/const onConfirmed = \(\) => \{[^}]*read\(\);/);
    // A backoff after a correct read would be three redundant reads.
    const confirmed = stale.slice(stale.indexOf('const onConfirmed'), stale.indexOf('window.addEventListener(STALE'));
    expect(confirmed).not.toContain('setTimeout');
  });

  test('the guess is still there for a member with no socket', () => {
    const stale = read('lib/chainStale.ts');
    expect(stale).toContain('const onGuess = ()');
    expect(stale).toContain('BACKOFF_MS');
  });

  test('the server announces after the writes, not before', () => {
    // The point is that the figures are already new when a device is told to read them.
    const service = readFileSync(
      join(SRC, '../../api/src/services/chain/savingsCollateralService.ts'), 'utf8',
    );
    expect(service).toMatch(/await announceChainChanged\(member, /);
    const sync = service.slice(service.indexOf('async function runSync'));
    expect(sync.indexOf('pushCapacities')).toBeLessThan(sync.indexOf('announceChainChanged'));
  });

  test('and it broadcasts to the wallet, not to one connection', () => {
    // This is what reaches a phone from a desktop.
    const service = readFileSync(
      join(SRC, '../../api/src/services/chain/savingsCollateralService.ts'), 'utf8',
    );
    expect(service).toContain("broadcastToAddress(wallet.toLowerCase(), 'chain:changed'");
  });

  test('the client turns it into the same local signal every page already hears', () => {
    // Moved out of the old T-Deed NotificationContext when that was deleted. It sat there only
    // because it was the one app-wide socket at the time; the Clear notifications provider is
    // app-wide and already holds one, so the bridge lives with it now.
    const hook = read('hooks/useNotifications.ts');
    expect(hook).toContain("socket.on('chain:changed', onChainChanged)");
    expect(hook).toContain('markChainSettled()');
    expect(hook).toContain("socket.off('chain:changed', onChainChanged)");
  });

  test('and that hook is the single shared instance, so one listener serves every page', () => {
    // As a per-caller hook this would attach the bridge once per surface, and a settled signal
    // would fan out into several identical refetches.
    const ctx = read('context/ClearNotificationsContext.tsx');
    expect(ctx).toContain('useNotificationsState()');
  });
});
