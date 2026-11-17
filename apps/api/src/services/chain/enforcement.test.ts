import { beforeEach, describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import {
  enforcementDue,
  LIQUIDATOR_ABI,
  prepareHoldCall,
  runEnforcementKeeper,
  SETTLE_COOLDOWN_SECONDS,
  type EnforcementDeps,
  type EnforcementReader,
} from './enforcement';

/*
 * The enforcement keeper against a stand-in Liquidator and RevolvingIssuer, injected (no module
 * mocks). It calls the permissionless section 12 paths only when the chain says they are due, never
 * for a member under an active hold, bounded, and not twice in a row for one member.
 */

const ISSUER = '0x00000000000000000000000000000000000000c4';
const LIQUIDATOR = '0x00000000000000000000000000000000000000d5';
const now = 1_800_000_000;
const WAIT = 72 * 3600;
const W = (n: number) => `0x${String(n).padStart(40, '0')}`;

type Member = { excess: bigint; gap: bigint; noticedAt: number; hold: 'none' | 'active' | 'proposed' | 'lapsed' };
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
  shortfallNoticedAt: async (w) => BigInt(chain.get(w)!.noticedAt),
  shortfallWait: async () => BigInt(WAIT),
  earnGapOf: async (w) => [chain.get(w)!.gap, 0n],
  unsecuredExcessOf: async (w) => chain.get(w)!.excess,
};

const tx = (label: string) => ({ hash: `0x${label}`, wait: async () => ({}) });
function call(action: 'settleExcess' | 'noticeShortfall' | 'settleShortfall') {
  return async (wallet: string) => {
    const err = refuse.get(`${action}:${wallet}`);
    if (err) throw { data: CHAIN_ERRORS.encodeErrorResult(err, err === 'LiquidatorOnHold' ? [wallet, 2, now + 1] : [wallet]) };
    sent.push(`${action}:${wallet}`);
    const m = chain.get(wallet)!;
    if (action === 'settleExcess') m.excess = 0n;
    if (action === 'noticeShortfall') m.noticedAt = now;
    if (action === 'settleShortfall') {
      m.gap = 0n;
      m.noticedAt = 0;
    }
    return tx(action);
  };
}

function deps(over: Partial<EnforcementDeps> = {}): EnforcementDeps {
  return {
    reader,
    writer: { settleExcess: call('settleExcess'), noticeShortfall: call('noticeShortfall'), settleShortfall: call('settleShortfall') },
    issuer: ISSUER,
    wallets: async () => [...chain.keys()],
    alert: async (a) => alerts.push(a.subject),
    now,
    tried: new Map(),
    ...over,
  };
}

function member(w: string, m: Partial<Member>) {
  chain.set(w, { excess: 0n, gap: 0n, noticedAt: 0, hold: 'none', ...m });
}

beforeEach(() => {
  chain = new Map();
  sent = [];
  alerts = [];
  refuse = new Map();
});

describe('what is due, from chain', () => {
  test('an excess is settled; a gap is noticed; a matured notice is settled', async () => {
    member(W(1), { excess: 5n });
    member(W(2), { gap: 7n });
    member(W(3), { gap: 7n, noticedAt: now - WAIT });
    member(W(4), { gap: 7n, noticedAt: now - WAIT + 60 });
    expect((await enforcementDue(reader, ISSUER, W(1), now, WAIT)).actions).toEqual(['settleExcess']);
    expect((await enforcementDue(reader, ISSUER, W(2), now, WAIT)).actions).toEqual(['noticeShortfall']);
    expect((await enforcementDue(reader, ISSUER, W(3), now, WAIT)).actions).toEqual(['settleShortfall']);
    // Still inside the 72-hour wait: nothing.
    expect((await enforcementDue(reader, ISSUER, W(4), now, WAIT)).actions).toEqual([]);
  });

  test('an active hold stops all of it; a proposed or lapsed one does not', async () => {
    member(W(1), { excess: 5n, gap: 7n, hold: 'active' });
    member(W(2), { excess: 5n, hold: 'proposed' });
    member(W(3), { excess: 5n, hold: 'lapsed' });
    expect(await enforcementDue(reader, ISSUER, W(1), now, WAIT)).toEqual({ held: true, actions: [] });
    expect((await enforcementDue(reader, ISSUER, W(2), now, WAIT)).actions).toEqual(['settleExcess']);
    expect((await enforcementDue(reader, ISSUER, W(3), now, WAIT)).actions).toEqual(['settleExcess']);
  });
});

describe('a pass', () => {
  test('calls each due path once, skips the held member, and a rerun sends nothing', async () => {
    member(W(1), { excess: 5n });
    member(W(2), { gap: 7n });
    member(W(3), { excess: 5n, hold: 'active' });
    const d = deps();
    const run = await runEnforcementKeeper(d);
    expect(sent.sort()).toEqual([`noticeShortfall:${W(2)}`, `settleExcess:${W(1)}`]);
    expect(run.held).toBe(1);
    sent = [];
    await runEnforcementKeeper(d);
    expect(sent).toEqual([]);
  });

  test('a settled member is not tried again within the cooldown, even if the excess still stands', async () => {
    member(W(1), { excess: 5n });
    const d = deps();
    await runEnforcementKeeper(d);
    chain.get(W(1))!.excess = 3n; // a pool withdrawal still queued
    sent = [];
    await runEnforcementKeeper(d);
    expect(sent).toEqual([]);
    await runEnforcementKeeper({ ...d, now: now + SETTLE_COOLDOWN_SECONDS });
    expect(sent).toEqual([`settleExcess:${W(1)}`]);
  });

  test('bounded per run', async () => {
    for (let i = 1; i <= 4; i++) member(W(i), { excess: 1n });
    const run = await runEnforcementKeeper(deps({ maxPerRun: 3 }));
    expect(sent).toHaveLength(3);
    expect(run.deferred).toBe(1);
  });

  test('a hold confirmed between the read and the call is not a failure; a real failure alerts', async () => {
    member(W(1), { excess: 5n });
    member(W(2), { excess: 5n });
    refuse.set(`settleExcess:${W(1)}`, 'LiquidatorOnHold');
    refuse.set(`settleExcess:${W(2)}`, 'LiquidatorNothingToSeize');
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
