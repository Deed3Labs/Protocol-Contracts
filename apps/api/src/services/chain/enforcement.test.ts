import { beforeEach, describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import { existsSync, readFileSync } from 'node:fs';
import {
  enforcementDue,
  LIQUIDATOR_ABI,
  prepareHoldCall,
  runEnforcementKeeper,
  type EnforcementDeps,
  type EnforcementReader,
} from './enforcement';

/*
 * The enforcement keeper against a stand-in Liquidator, injected (no module mocks). Since Phase 2f it
 * only notices an Earn shortfall (`noticeShortfall(member)`), clears a notice whose gap closed, and
 * alerts ops when one is past its wait; never for a member under an active hold, and bounded.
 */

const LIQUIDATOR = '0x00000000000000000000000000000000000000d5';
const now = 1_800_000_000;
const WAIT = 72 * 3600;
const W = (n: number) => `0x${String(n).padStart(40, '0')}`;

type Member = { gap: bigint; noticedAt: number; hold: 'none' | 'active' | 'proposed' | 'lapsed' };
let chain: Map<string, Member>;
let sent: string[];
let alerts: string[];
let refuse: Map<string, string>;

const holdTuple = (m: Member) => {
  if (m.hold === 'none') return [{ proposer: ethers.ZeroAddress, reason: 0n, confirmed: false, setAt: 0n, lastSigner: ethers.ZeroAddress, until: 0n, clearProposer: ethers.ZeroAddress }, false];
  const confirmed = m.hold !== 'proposed';
  const until = m.hold === 'lapsed' ? now - 1 : now + 86_400;
  return [{ proposer: W(900), reason: 2n, confirmed, setAt: BigInt(now - 86_400), lastSigner: W(901), until: BigInt(until), clearProposer: ethers.ZeroAddress }, confirmed && until > now];
};

const reader: EnforcementReader = {
  holdOf: async (w) => holdTuple(chain.get(w)!),
  shortfallWait: async () => BigInt(WAIT),
  shortfallOf: async (w) => {
    const m = chain.get(w)!;
    return [m.gap, m.noticedAt === 0 ? 0n : BigInt(m.noticedAt + WAIT)];
  },
};

const tx = (label: string) => ({ hash: `0x${label}`, wait: async () => ({}) });
async function noticeShortfall(wallet: string) {
  const err = refuse.get(wallet);
  if (err) throw { data: CHAIN_ERRORS.encodeErrorResult(err, err === 'LiquidatorOnHold' ? [wallet, 2, now + 1] : [wallet]) };
  sent.push(wallet);
  const m = chain.get(wallet)!;
  m.noticedAt = m.gap > 0n ? now : 0;
  return tx('notice');
}

function deps(over: Partial<EnforcementDeps> = {}): EnforcementDeps {
  return {
    reader,
    writer: { noticeShortfall },
    wallets: async () => [...chain.keys()],
    alert: async (a) => alerts.push(a.subject),
    now,
    tried: new Map(),
    ...over,
  };
}

function member(w: string, m: Partial<Member>) {
  chain.set(w, { gap: 0n, noticedAt: 0, hold: 'none', ...m });
}

beforeEach(() => {
  chain = new Map();
  sent = [];
  alerts = [];
  refuse = new Map();
});

describe('the keeper calls only what the Phase 2f Liquidator has', () => {
  test('noticeShortfall(member) and shortfallOf; settleExcess, settleShortfall and earnGapOf are gone', () => {
    const iface = new ethers.Interface(LIQUIDATOR_ABI);
    expect(iface.getFunction('noticeShortfall')?.format()).toBe('noticeShortfall(address)');
    expect(iface.getFunction('shortfallOf')?.format()).toBe('shortfallOf(address)');
    for (const gone of ['settleExcess', 'settleShortfall', 'earnGapOf', 'liquidateShares', 'settleRealized']) {
      expect(iface.getFunction(gone)).toBeNull();
    }
    const source = new URL('../../../../../contracts/peripherals/Liquidator.sol', import.meta.url);
    if (!existsSync(source)) return;
    const sol = readFileSync(source, 'utf8');
    expect(sol).toContain('function noticeShortfall(address) external returns (uint256 gap)');
    expect(sol).toContain('function shortfallOf(address) external view returns (uint256 gap, uint256 dueAt)');
    expect(sol).not.toContain('function settleExcess(');
  });
});

describe('what is due, from chain', () => {
  test('a gap is noticed; a closed gap clears its notice; a matured one is due; inside the wait, nothing', async () => {
    member(W(1), { gap: 7n });
    member(W(2), { gap: 0n, noticedAt: now - 60 });
    member(W(3), { gap: 7n, noticedAt: now - WAIT });
    member(W(4), { gap: 7n, noticedAt: now - WAIT + 60 });
    member(W(5), {});
    expect((await enforcementDue(reader, W(1), now)).actions).toEqual(['noticeShortfall']);
    expect((await enforcementDue(reader, W(2), now)).actions).toEqual(['clearShortfall']);
    expect((await enforcementDue(reader, W(3), now)).actions).toEqual(['shortfallDue']);
    expect((await enforcementDue(reader, W(4), now)).actions).toEqual([]);
    expect((await enforcementDue(reader, W(5), now)).actions).toEqual([]);
  });

  test('an active hold stops all of it; a proposed or lapsed one does not', async () => {
    member(W(1), { gap: 7n, hold: 'active' });
    member(W(2), { gap: 7n, hold: 'proposed' });
    member(W(3), { gap: 7n, hold: 'lapsed' });
    expect(await enforcementDue(reader, W(1), now)).toEqual({ held: true, actions: [] });
    expect((await enforcementDue(reader, W(2), now)).actions).toEqual(['noticeShortfall']);
    expect((await enforcementDue(reader, W(3), now)).actions).toEqual(['noticeShortfall']);
  });
});

describe('a pass', () => {
  test('notices each gap once, skips the held member, and a rerun sends nothing', async () => {
    member(W(1), { gap: 5n });
    member(W(2), { gap: 7n });
    member(W(3), { gap: 5n, hold: 'active' });
    const d = deps();
    const run = await runEnforcementKeeper(d);
    expect(sent.sort()).toEqual([W(1), W(2)]);
    expect(run.held).toBe(1);
    sent = [];
    await runEnforcementKeeper(d);
    expect(sent).toEqual([]);
  });

  test('a shortfall past its wait is alerted, not settled here', async () => {
    member(W(1), { gap: 5n, noticedAt: now - WAIT - 1 });
    const run = await runEnforcementKeeper(deps());
    expect(sent).toEqual([]);
    expect(run.results).toEqual([{ wallet: W(1), action: 'shortfallDue', ok: true }]);
    expect(alerts).toEqual(['Enforcement: 1 Earn shortfall(s) past their wait']);
  });

  test('bounded per run', async () => {
    for (let i = 1; i <= 4; i++) member(W(i), { gap: 1n });
    const run = await runEnforcementKeeper(deps({ maxPerRun: 3 }));
    expect(sent).toHaveLength(3);
    expect(run.deferred).toBe(1);
  });

  test('a hold confirmed between the read and the call is not a failure; a real failure alerts', async () => {
    member(W(1), { gap: 5n });
    member(W(2), { gap: 5n });
    refuse.set(W(1), 'LiquidatorOnHold');
    refuse.set(W(2), 'LiquidatorNothingToSeize');
    const run = await runEnforcementKeeper(deps());
    expect(run.held).toBe(1);
    expect(run.results.find((r) => r.wallet === W(2))).toMatchObject({ ok: false });
    expect(alerts).toEqual(['Enforcement keeper: 1 call(s) failed']);
  });
});

describe('Liquidation Hold steps, prepared for the signer’s own wallet', () => {
  const iface = new ethers.Interface(LIQUIDATOR_ABI);

  test('propose: reason, days and a hash of the evidence (never the document)', () => {
    const r = prepareHoldCall({ action: 'propose', member: W(7), reason: 'DEATH', durationDays: 90, evidence: 'county record 2026-1142' }, LIQUIDATOR, 84532);
    if ('error' in r) throw new Error(r.error);
    const decoded = iface.parseTransaction({ data: r.data })!;
    expect(decoded.name).toBe('proposeHold');
    expect(decoded.args.map(String)).toEqual([ethers.getAddress(W(7)), '2', String(90 * 86_400), ethers.id('county record 2026-1142')]);
    expect(r.note).toContain('DIFFERENT HOLD_ROLE signer');
  });

  test('confirm, renew and clear say a second signer is needed', () => {
    for (const call of [
      { action: 'confirm', member: W(7) },
      { action: 'renew', member: W(7), untilUnix: now + 86_400 },
      { action: 'clear', member: W(7) },
    ] as const) {
      const r = prepareHoldCall(call, LIQUIDATOR, 84532);
      if ('error' in r) throw new Error(r.error);
      expect(r.note).toMatch(/different|two different/i);
      expect(r.to).toBe(ethers.getAddress(LIQUIDATOR));
    }
  });

  test('refuses what the contract would', () => {
    expect(prepareHoldCall({ action: 'propose', member: W(7), reason: 'NONE', durationDays: 9, evidence: 'x' }, LIQUIDATOR, 84532)).toHaveProperty('error');
    expect(prepareHoldCall({ action: 'propose', member: W(7), reason: 'DEATH', durationDays: 9, evidence: '' }, LIQUIDATOR, 84532)).toHaveProperty('error');
    expect(prepareHoldCall({ action: 'confirm', member: 'nobody' }, LIQUIDATOR, 84532)).toHaveProperty('error');
  });
});
