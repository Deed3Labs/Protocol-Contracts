import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import { classifySimulationError, type CallRunner, type ChainCall } from './keeperKit';
import {
  BOND_ABI,
  bondPledgeMode,
  ENFORCER_ABI,
  mayNeedWork,
  poolEnforceMode,
  POOL_ABI,
  runPledgeKeepers,
  type HolderState,
  type PledgeDeps,
  type PledgeReader,
} from './pledgeEnforcement';

/*
 * The pledge keepers against stand-in contracts, injected (no module mocks). What they must do: call
 * only what the PoolShareEnforcer and the Liquidator say is due, never for a member under a hold or a
 * pause, simulate first, treat the contracts' own refusals as "not due", alert every send, stay
 * bounded, and send nothing twice.
 */

const ENFORCER = '0x00000000000000000000000000000000000000e1';
const BONDS = '0x00000000000000000000000000000000000000b1';
const now = 1_800_000_000;
const W = (n: number) => `0x${String(n).padStart(40, '0')}`;
const enforcerIface = new ethers.Interface(ENFORCER_ABI);
const bondIface = new ethers.Interface(BOND_ABI);

type Holder = HolderState & {
  needShares: bigint;
  needValue: bigint;
  stillNeeded: bigint;
  requests: bigint[];
  bond: bigint | null;
  bondDue: boolean;
};

let chain: Map<string, Holder>;
let sent: string[];
let alerts: { key: string; subject: string; body: string }[];
let refuse: Map<string, string>;

const blank = (): Holder => ({
  blocked: false,
  defaultedDue: 0n,
  shortfallGap: 0n,
  shortfallDueAt: 0,
  queued: 0n,
  filledShares: 0n,
  filledPaid: 0n,
  settledShares: 0n,
  settledPaid: 0n,
  needShares: 0n,
  needValue: 0n,
  stillNeeded: 0n,
  requests: [],
  bond: null,
  bondDue: false,
});

const reader: PledgeReader = {
  holder: async (w) => ({ ...chain.get(w)! }),
  sharesNeeded: async (w) => {
    const h = chain.get(w)!;
    return { shares: h.blocked ? 0n : h.needShares, value: h.needValue, onDefault: h.defaultedDue > 0n };
  },
  sharesStillNeeded: async (w) => chain.get(w)!.stillNeeded,
  enforcementRequests: async () => new Map([...chain].filter(([, h]) => h.requests.length).map(([w, h]) => [w.toLowerCase(), h.requests])),
  nextBond: async (w) => ({ found: chain.get(w)!.bond != null, bondId: chain.get(w)!.bond ?? 0n }),
  pledgePaymentDue: async (w, id) => ({ due: chain.get(w)!.bondDue && chain.get(w)!.bond === id && !chain.get(w)!.blocked, onDefault: chain.get(w)!.defaultedDue > 0n }),
  bondValue: async () => 120_500_000n,
};

const log = (iface: ethers.Interface, name: string, args: unknown[]) => {
  const l = iface.encodeEventLog(name, args);
  return { topics: l.topics, data: l.data };
};

function decode(call: ChainCall): { name: string; wallet: string; arg?: bigint } {
  if (call.to === BONDS) {
    const p = bondIface.parseTransaction({ data: call.data })!;
    const id = BigInt(p.args[0]);
    const wallet = [...chain].find(([, h]) => h.bond === id)![0];
    return { name: p.name, wallet, arg: id };
  }
  const p = enforcerIface.parseTransaction({ data: call.data })!;
  return { name: p.name, wallet: String(p.args[0]).toLowerCase(), arg: p.args.length > 1 ? (p.args[1] as bigint) : undefined };
}

const runner: CallRunner = {
  from: '0x00000000000000000000000000000000000000ee',
  simulate: async (call) => {
    const { name, wallet } = decode(call);
    const err = refuse.get(`${name}:${wallet}`);
    if (err === 'boom') return classifySimulationError({ code: 'CALL_EXCEPTION', shortMessage: 'execution reverted', data: '0x12345678' });
    if (err) {
      const args = err === 'BondVaultEnforcementInForce' ? [] : err === 'BurnerBondNotPledgePayable' || err === 'PoolShareEnforcerNotExcess' ? [1n] : [wallet];
      return classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult(err, args) });
    }
    return { kind: 'ok', returnData: '0x' };
  },
  send: async (call) => {
    const { name, wallet, arg } = decode(call);
    const h = chain.get(wallet)!;
    sent.push(`${name}:${wallet}`);
    const hash = `0x${String(sent.length).padStart(64, '0')}`;
    if (name === 'settle') {
      const shares = h.filledShares - h.settledShares;
      const paid = h.filledPaid - h.settledPaid;
      h.settledShares = h.filledShares;
      h.settledPaid = h.filledPaid;
      return { hash, status: 1, logs: [log(enforcerIface, 'EnforcementSettled', [wallet, shares, paid, paid])] };
    }
    if (name === 'cancelExcess') {
      const back = h.queued - h.stillNeeded;
      h.queued = h.stillNeeded;
      h.requests = h.requests.filter((r) => r !== arg);
      return { hash, status: 1, logs: [log(enforcerIface, 'EnforcementCancelled', [wallet, arg, back])] };
    }
    if (name === 'enforce') {
      const shares = h.needShares;
      h.queued += shares;
      h.needShares = 0n;
      return { hash, status: 1, logs: [log(enforcerIface, 'EnforcementRequested', [wallet, 7n, shares, h.needValue, h.defaultedDue > 0n])] };
    }
    // payPledged
    h.bondDue = false;
    h.bond = null;
    return { hash, status: 1, logs: [log(bondIface, 'PledgePaid', [arg, wallet, 120_500_000n, 100_000_000n, 20_500_000n])] };
  },
};

function deps(over: Partial<PledgeDeps> = {}): PledgeDeps {
  return {
    enforcer: ENFORCER,
    bonds: BONDS,
    reader,
    runner,
    poolMode: 'live',
    bondMode: 'live',
    wallets: async () => [...chain.keys()],
    alert: async (a) => alerts.push(a),
    now,
    ...over,
  };
}

function holder(w: string, h: Partial<Holder>) {
  chain.set(w, { ...blank(), ...h });
}

beforeEach(() => {
  chain = new Map();
  sent = [];
  alerts = [];
  refuse = new Map();
});

describe('what may be due, from the cheap reads', () => {
  test('a default, a shortfall past its wait, something queued or something filled; nothing else', () => {
    expect(mayNeedWork(blank(), now)).toBe(false);
    expect(mayNeedWork({ ...blank(), shortfallGap: 5n, shortfallDueAt: now + 60 }, now)).toBe(false);
    expect(mayNeedWork({ ...blank(), shortfallGap: 5n, shortfallDueAt: now }, now)).toBe(true);
    expect(mayNeedWork({ ...blank(), defaultedDue: 1n }, now)).toBe(true);
    expect(mayNeedWork({ ...blank(), queued: 1n }, now)).toBe(true);
    expect(mayNeedWork({ ...blank(), filledShares: 2n, settledShares: 1n }, now)).toBe(true);
  });
});

describe('a pass', () => {
  test('a shortfall past its wait: enforce queues the shares the enforcer computes, and ops are told who, how much, which transaction', async () => {
    holder(W(1), { shortfallGap: 50_000_000n, shortfallDueAt: now - 60, needShares: 55_000_000n, needValue: 55_550_000n });
    const run = await runPledgeKeepers(deps());
    expect(sent).toEqual([`enforce:${W(1)}`]);
    expect(run.results[0]).toMatchObject({ action: 'enforce', outcome: 'sent' });
    expect(alerts[0].subject).toBe(`Enforcement: enforce sent for ${W(1)}`);
    expect(alerts[0].body).toContain('$55.55');
    expect(alerts[0].body).toContain(run.results[0].txHash!);
    sent = [];
    await runPledgeKeepers(deps());
    expect(sent).toEqual([]); // queued now: nothing more needed
  });

  test('once the queue has paid: settle hands it over; a rerun sends nothing', async () => {
    holder(W(1), { shortfallGap: 1n, shortfallDueAt: now - 60, queued: 0n, filledShares: 10n, filledPaid: 10_000_000n });
    await runPledgeKeepers(deps());
    expect(sent).toEqual([`settle:${W(1)}`]);
    expect(alerts[0].body).toContain('$10.00');
    sent = [];
    await runPledgeKeepers(deps());
    expect(sent).toEqual([]);
  });

  test('more queued than needed: cancelExcess gives it back, request by request', async () => {
    holder(W(1), { queued: 40n, stillNeeded: 10n, requests: [3n] });
    await runPledgeKeepers(deps());
    expect(sent).toEqual([`cancelExcess:${W(1)}`]);
    expect(alerts[0].body).toContain('given back to the Holder');
  });

  test('a default: the next pledged bond is paid when the Liquidator asks for it, one bond per run', async () => {
    holder(W(1), { defaultedDue: 300_000_000n, bond: 42n, bondDue: true });
    holder(W(2), { defaultedDue: 300_000_000n, bond: 43n, bondDue: false });
    await runPledgeKeepers(deps());
    expect(sent).toEqual([`payPledged:${W(1)}`]);
    expect(alerts[0].body).toContain('bond 42 paid at its Accreted Value $120.50');
  });

  test('a member under a Liquidation Hold or a pause is left wholly alone, even what would give shares back', async () => {
    holder(W(1), { blocked: true, defaultedDue: 1n, needShares: 5n, queued: 40n, stillNeeded: 0n, requests: [1n], filledShares: 3n, bond: 9n, bondDue: true });
    const run = await runPledgeKeepers(deps());
    expect(sent).toEqual([]);
    expect(run.held).toBe(1);
  });

  test('a refusal by the contract’s own rule is not due, not a failure; anything else is alerted', async () => {
    holder(W(1), { shortfallGap: 1n, shortfallDueAt: now - 60, needShares: 5n });
    holder(W(2), { defaultedDue: 1n, bond: 8n, bondDue: true });
    holder(W(3), { shortfallGap: 1n, shortfallDueAt: now - 60, needShares: 5n });
    refuse.set(`enforce:${W(1)}`, 'PoolShareEnforcerBlocked');
    refuse.set(`payPledged:${W(2)}`, 'BondVaultEnforcementInForce');
    refuse.set(`enforce:${W(3)}`, 'boom');
    const run = await runPledgeKeepers(deps());
    expect(sent).toEqual([]);
    expect(run.results.find((r) => r.wallet === W(1))).toMatchObject({ outcome: 'not_due' });
    expect(run.results.find((r) => r.wallet === W(2))?.reason).toContain('Enforcement Notice');
    expect(run.results.find((r) => r.wallet === W(3))).toMatchObject({ outcome: 'failed' });
    expect(alerts.map((a) => a.subject)).toEqual(['Pledge keepers: 1 call(s) failed']);
  });

  test('each switch covers its own calls: bonds off leaves payPledged alone; pool off leaves enforce alone', async () => {
    holder(W(1), { defaultedDue: 1n, needShares: 5n, bond: 4n, bondDue: true });
    await runPledgeKeepers(deps({ bondMode: 'off' }));
    expect(sent).toEqual([`enforce:${W(1)}`]);
    sent = [];
    holder(W(2), { defaultedDue: 1n, needShares: 5n, bond: 5n, bondDue: true });
    chain.delete(W(1));
    await runPledgeKeepers(deps({ poolMode: 'off' }));
    expect(sent).toEqual([`payPledged:${W(2)}`]);
  });

  test('dry run: simulates, logs and alerts what it would send, sends nothing', async () => {
    holder(W(1), { defaultedDue: 1n, needShares: 5n, needValue: 5_000_000n, bond: 4n, bondDue: true });
    const run = await runPledgeKeepers(deps({ poolMode: 'dry_run', bondMode: 'dry_run' }));
    expect(sent).toEqual([]);
    expect(run.results.map((r) => `${r.action}:${r.outcome}`)).toEqual(['enforce:would_send', 'payPledged:would_send']);
    expect(alerts.map((a) => a.subject)).toEqual([
      `Pledge keeper (dry run): would send enforce for ${W(1)}`,
      `Pledge keeper (dry run): would send payPledged for ${W(1)}`,
    ]);
  });

  test('bounded per run, defaults first and then shortfalls by when their wait ended', async () => {
    holder(W(1), { shortfallGap: 1n, shortfallDueAt: now - 60, needShares: 1n });
    holder(W(2), { shortfallGap: 1n, shortfallDueAt: now - 6000, needShares: 1n });
    holder(W(3), { defaultedDue: 1n, needShares: 1n });
    const run = await runPledgeKeepers(deps({ poolMaxPerRun: 2 }));
    expect(sent).toEqual([`enforce:${W(3)}`, `enforce:${W(2)}`]);
    expect(run.deferred).toBe(1);
  });

  test('both switches off: nothing is read or sent', async () => {
    holder(W(1), { defaultedDue: 1n, needShares: 1n });
    const run = await runPledgeKeepers(deps({ poolMode: 'off', bondMode: 'off' }));
    expect(run.checked).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('switches', () => {
  test('off unless set; dry run with it', () => {
    expect([poolEnforceMode({}), bondPledgeMode({})]).toEqual(['off', 'off']);
    expect(poolEnforceMode({ POOL_ENFORCE_KEEPER_ENABLED: '1', POOL_ENFORCE_KEEPER_DRY_RUN: '1' })).toBe('dry_run');
    expect(bondPledgeMode({ BOND_PLEDGE_KEEPER_ENABLED: 'true' })).toBe('live');
    expect(bondPledgeMode({ BOND_PLEDGE_KEEPER_DRY_RUN: '1' })).toBe('off');
  });
});

describe('the deployed contracts have what the keeper calls', () => {
  const records = new URL('../../../../../deployments/base-sepolia/', import.meta.url);
  const deployed = (name: string) => new ethers.Interface((JSON.parse(readFileSync(new URL(`${name}.json`, records), 'utf8')) as { abi: ethers.InterfaceAbi }).abi);

  test('PoolShareEnforcer, LendingPool and BurnerBond: each function and event, selector for selector', () => {
    if (!existsSync(new URL('PoolShareEnforcer.json', records))) return;
    for (const [record, abi] of [['PoolShareEnforcer', ENFORCER_ABI], ['LendingPool', POOL_ABI], ['BurnerBond', BOND_ABI]] as const) {
      const ours = new ethers.Interface(abi);
      const theirs = deployed(record);
      ours.forEachFunction((f) => expect(`${record}.${f.name} ${theirs.getFunction(f.name)?.selector}`).toBe(`${record}.${f.name} ${f.selector}`));
      ours.forEachEvent((e) => expect(`${record}.${e.name} ${theirs.getEvent(e.name)?.topicHash}`).toBe(`${record}.${e.name} ${e.topicHash}`));
    }
  });

  test('the refusals the keeper reads as "not due" are the contracts’ declarations', () => {
    const sol = new URL('../../../../../contracts/peripherals/', import.meta.url);
    if (!existsSync(sol)) return;
    const src = (f: string) => readFileSync(new URL(f, sol), 'utf8');
    for (const [file, decl] of [
      ['PoolShareEnforcer.sol', 'error PoolShareEnforcerBlocked(address holder);'],
      ['PoolShareEnforcer.sol', 'error PoolShareEnforcerNothingNeeded(address holder);'],
      ['PoolShareEnforcer.sol', 'error PoolShareEnforcerNothingToSettle(address holder);'],
      ['PoolShareEnforcer.sol', 'error PoolShareEnforcerNotExcess(uint256 requestId);'],
      ['BurnerBondBase.sol', 'error BurnerBondNotPledgePayable(uint256 bondId);'],
      ['BondVault.sol', 'error BondVaultEnforcementInForce();'],
      ['LendingPoolBase.sol', 'error LendingPoolSuspended();'],
      ['LendingPoolBase.sol', 'error LendingPoolChargePending();'],
      ['RevolvingIssuerBase.sol', 'error RevolvingIssuerNotInDefault(address member);'],
    ]) {
      expect(src(file)).toContain(decl);
      expect(CHAIN_ERRORS.getError(decl.replace(/^error (\w+).*$/, '$1'))).not.toBeNull();
    }
  });
});

describe('wiring', () => {
  const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
  const job = readFileSync(new URL('../../jobs/pledgeKeeper.ts', import.meta.url), 'utf8');
  test('registered at startup, hourly, and only once the Liquidator names the same enforcer, pool and bonds', () => {
    expect(index).toContain('startPledgeKeepers()');
    expect(job).toContain('setInterval(() => void tick(), HOUR_MS)');
    expect(job).toContain('await pledgeWiringProblem()');
  });
});
