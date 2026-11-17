import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { dueFor, KEEPER_ABI, runCycleKeeper, type KeeperDeps, type KeeperReader } from './cycleKeeper';

/*
 * The cycle keeper against a stand-in RevolvingIssuer. Its reads and its one write are injected,
 * so nothing here mocks a module (the `ethers` mock elsewhere in this directory leaks between files).
 *
 * The policy is the point: sync a member once their cycle is ready to be judged, never before, never
 * twice for one cycle, oldest first, bounded, and say what happened.
 */

const DAY = 86_400;
const CYCLE = 30 * DAY;
const CURE = 15 * DAY;
const now = 1_800_000_000;
const iface = new ethers.Interface(KEEPER_ABI);

type Member = {
  issuedAt: number;
  expiration: number;
  graceLength: number;
  paused: boolean;
  compliant: boolean;
  missedInRow: number;
  cureNoticeAt: number;
};

let chain: Map<string, Member>;
let synced: string[];
let notices: { wallet: string; title: string }[];
let alerts: { key: string; subject: string }[];
let failing: Set<string>;

const reader: KeeperReader = {
  creditPeriods: async (w) => {
    const m = chain.get(w)!;
    return [BigInt(m.issuedAt), BigInt(m.expiration), BigInt(m.graceLength), m.paused];
  },
  inCompliance: async (w) => chain.get(w)!.compliant,
  cycleOf: async (w) => ({ missedInRow: chain.get(w)!.missedInRow, cureNoticeAt: BigInt(chain.get(w)!.cureNoticeAt) }),
  creditTerms: async () => ({ cureWindow: BigInt(CURE) }),
};

/** What `judgeCycle` does, near enough for the keeper: roll on clean or a first miss, notice on a second. */
function judge(wallet: string) {
  const m = chain.get(wallet)!;
  const logs: { topics: string[]; data: string }[] = [];
  const emit = (name: string, args: unknown[]) => {
    const log = iface.encodeEventLog(name, args);
    logs.push({ topics: log.topics, data: log.data });
  };
  if (m.compliant) {
    m.missedInRow = 0;
    emit('CycleJudged', [wallet, true, 0, 1, false]);
  } else if (m.missedInRow === 0) {
    m.missedInRow = 1;
    emit('UnsecuredLimitHalved', [wallet, 250_000_000n, 0n]);
    emit('CycleJudged', [wallet, false, 1, 0, false]);
  } else {
    m.missedInRow = 2;
    m.cureNoticeAt = now;
    emit('CureNotice', [wallet, now, now + CURE]);
    emit('CycleJudged', [wallet, false, 2, 0, false]);
    return logs; // the period stays expired, frozen
  }
  m.issuedAt = now;
  m.expiration = now + CYCLE;
  return logs;
}

function deps(over: Partial<KeeperDeps> = {}): KeeperDeps {
  return {
    reader,
    writer: {
      syncCreditPeriod: async (wallet: string) => {
        if (failing.has(wallet)) throw new Error('insufficient funds for gas');
        synced.push(wallet);
        const logs = judge(wallet);
        return { hash: `0x${wallet.slice(2).padStart(64, '0')}`, wait: async () => ({ logs }) };
      },
    },
    wallets: async () => [...chain.keys()],
    notify: async (n) => notices.push({ wallet: n.wallet, title: n.title }),
    alert: async (a) => alerts.push({ key: a.key, subject: a.subject }),
    now,
    ...over,
  };
}

const W = (n: number) => `0x${String(n).padStart(40, '0')}`;

function member(wallet: string, m: Partial<Member>) {
  chain.set(wallet, {
    issuedAt: now - CYCLE - 5 * DAY,
    expiration: now - 5 * DAY,
    graceLength: 3 * DAY,
    paused: false,
    compliant: false,
    missedInRow: 0,
    cureNoticeAt: 0,
    ...m,
  });
}

beforeEach(() => {
  chain = new Map();
  synced = [];
  notices = [];
  alerts = [];
  failing = new Set();
});

describe('when a cycle is ready to be judged', () => {
  test('grace ended: synced (judged Clean or missed)', async () => {
    member(W(1), {});
    expect(await dueFor(reader, W(1), now, CURE)).toMatchObject({ because: 'grace_ended' });
  });

  test('expired and already rebalanced: synced now, a Clean Cycle without waiting out the grace', async () => {
    member(W(1), { expiration: now - DAY, graceLength: 5 * DAY, compliant: true });
    expect(await dueFor(reader, W(1), now, CURE)).toMatchObject({ because: 'clean' });
  });

  test('inside the grace with a balance, still running, paused, or no line: left alone', async () => {
    member(W(1), { expiration: now - DAY, graceLength: 5 * DAY, compliant: false });
    member(W(2), { expiration: now + DAY });
    member(W(3), { paused: true });
    member(W(4), { issuedAt: 0, expiration: 0 });
    for (const w of [W(1), W(2), W(3), W(4)]) expect(await dueFor(reader, w, now, CURE)).toBeNull();
  });

  test('a cure notice waits for its window, then is synced to record default', async () => {
    member(W(1), { missedInRow: 2, cureNoticeAt: now - 10 * DAY });
    expect(await dueFor(reader, W(1), now, CURE)).toBeNull();
    member(W(2), { missedInRow: 2, cureNoticeAt: now - 16 * DAY });
    expect(await dueFor(reader, W(2), now, CURE)).toMatchObject({ because: 'cure_window_passed' });
  });
});

describe('a pass', () => {
  test('judges what is due, says what happened, and tells the member about a miss', async () => {
    member(W(1), { compliant: true });
    member(W(2), {});
    member(W(3), { expiration: now + DAY });
    const run = await runCycleKeeper(deps());
    expect(synced.sort()).toEqual([W(1), W(2)]);
    expect(run.results.find((r) => r.wallet === W(1))).toMatchObject({ action: 'judged', clean: true });
    expect(run.results.find((r) => r.wallet === W(2))).toMatchObject({ action: 'judged', clean: false, halved: true, missedInRow: 1 });
    expect(notices).toEqual([{ wallet: W(2), title: 'Your cycle closed with a balance' }]);
  });

  test('a second miss is a cure notice, with the date default can begin', async () => {
    member(W(1), { missedInRow: 1 });
    const run = await runCycleKeeper(deps());
    expect(run.results[0]).toMatchObject({ cureNotice: true, missedInRow: 2 });
    expect(notices[0].title).toBe('Cure notice: two cycles missed');
  });

  test('idempotent: a rerun sends nothing for a cycle already judged', async () => {
    member(W(1), { compliant: true });
    member(W(2), {});
    await runCycleKeeper(deps());
    synced = [];
    const again = await runCycleKeeper(deps());
    expect(synced).toEqual([]);
    expect(again.due).toBe(0);
  });

  test('bounded per run, oldest due first; the rest waits for the next run', async () => {
    member(W(1), { expiration: now - 2 * DAY - 3 * DAY });
    member(W(2), { expiration: now - 9 * DAY - 3 * DAY });
    member(W(3), { expiration: now - 5 * DAY - 3 * DAY });
    const run = await runCycleKeeper(deps({ maxPerRun: 2 }));
    expect(synced).toEqual([W(2), W(3)]);
    expect(run.deferred).toBe(1);
  });

  test('a failure is logged and alerted, and does not stop the rest', async () => {
    member(W(1), {});
    member(W(2), {});
    failing.add(W(1));
    const run = await runCycleKeeper(deps());
    expect(synced).toEqual([W(2)]);
    expect(run.results.find((r) => r.wallet === W(1))).toMatchObject({ action: 'failed' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toContain('1 member(s) not synced');
  });
});

describe('wiring', () => {
  const job = readFileSync(new URL('../../jobs/cycleKeeper.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');

  test('registered at startup, hourly, and only on an issuer that judges its own cycles', () => {
    expect(index).toContain('startCycleKeeper()');
    expect(job).toContain('setInterval(() => void tick(), HOUR_MS)');
    expect(job).toContain('await issuerJudgesCycles()');
  });

  test('syncCreditPeriod needs no role, only gas: the README says so', () => {
    expect(readme).toMatch(/syncCreditPeriod[^\n]*\|[^\n]*no role/i);
  });
});
