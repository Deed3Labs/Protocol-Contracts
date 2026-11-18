import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { CHAIN_ERRORS, describeOnboardingRefusal } from './chainErrors';
import { classifySimulationError, type CallRunner, type ChainCall, type Simulation } from './keeperKit';
import { encodeStateCode } from './stateCode';
import { openLineWith, type OpenLineResult } from './creditLineService';
import {
  NOT_ENABLED_BACKOFF_S,
  onboardingMode,
  runCreditOnboarding,
  stateAttesterKey,
  summarize,
  type OnboardingDeps,
  type Readiness,
} from './creditOnboarding';

const REGISTRY = '0x00000000000000000000000000000000000000e1';
const ISSUER = '0x00000000000000000000000000000000000000e2';
const ATTESTER = '0x8801A480Cd6a2Ab40964d3895d5BED8fCfa51edd';
const iface = new ethers.Interface(['function attestStateCode(address member, bytes32 stateCode)', 'function openLine(address member, uint256[] capacities, uint8 cycleEndDay)']);
const wallet = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const NOW = 1_800_000_000;

/** An error as the RPC returns it, sorted the way the live runner sorts it. */
const simOf = (name: string, args: unknown[]): Simulation =>
  classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult(name, args) }, describeOnboardingRefusal);
const missingRole = (): Simulation => {
  const data = ethers.id('Error(string)').slice(0, 10) +
    ethers.AbiCoder.defaultAbiCoder().encode(['string'], [`AccessControl: account ${ATTESTER.toLowerCase()} is missing role ${ethers.id('STATE_ATTESTER_ROLE')}`]).slice(2);
  return classifySimulationError({ data }, describeOnboardingRefusal);
};

interface Member {
  line?: boolean;
  onChain?: string; // two-letter code attested
  verified?: boolean;
  profile?: string | null;
  unreadable?: boolean;
  /** What openLine answers (default: opens). */
  open?: OpenLineResult;
}

function harness(members: Record<string, Member>, options: { mode?: 'dry_run' | 'live'; readiness?: Readiness; max?: number; attestSim?: Simulation } = {}) {
  const sent: ChainCall[] = [];
  const simulated: ChainCall[] = [];
  const opened: Array<{ wallet: string; dryRun: boolean }> = [];
  const alerts: Array<{ key: string; subject: string; body: string }> = [];
  const lookups = { verified: 0, profile: 0 };
  const attester: CallRunner = {
    from: ATTESTER,
    simulate: async (call) => {
      simulated.push(call);
      return options.attestSim ?? { kind: 'ok', returnData: '0x' };
    },
    send: async (call) => {
      sent.push(call);
      const [member, code] = iface.decodeFunctionData('attestStateCode', call.data);
      members[String(member).toLowerCase()].onChain = ethers.decodeBytes32String(code);
      return { hash: `0xa${sent.length}`, logs: [], status: 1 };
    },
  };
  const deps: OnboardingDeps = {
    registry: REGISTRY,
    reader: {
      creditPeriods: async (m) => [members[m].line ? 1n : 0n, 0n, 0n, false],
      stateCodeOf: async (m) => (members[m].onChain ? ethers.encodeBytes32String(members[m].onChain!) : ethers.ZeroHash),
    },
    attester,
    attestReadiness: async () => options.readiness ?? { ready: true },
    openLine: async (w, dryRun) => {
      opened.push({ wallet: w, dryRun });
      if (dryRun) return { opened: false, reason: 'dry_run', wouldOpen: true };
      const answer = members[w].open ?? { opened: true, txHash: '0xb1' };
      if (answer.opened) members[w].line = true;
      return answer;
    },
    verified: async (w) => {
      lookups.verified += 1;
      return Boolean(members[w].verified);
    },
    addressState: async (w) => {
      lookups.profile += 1;
      return { addressState: members[w].profile ?? null, unreadable: members[w].unreadable };
    },
    wallets: async () => Object.keys(members),
    alert: async (input) => {
      alerts.push(input);
    },
    mode: options.mode ?? 'live',
    now: NOW,
    maxPerRun: options.max,
    backoff: new Map(),
  };
  return { deps, sent, simulated, opened, alerts, lookups };
}

describe('the switches and the key', () => {
  test('off unless CREDIT_ONBOARDING_ENABLED=1; dry run with it', () => {
    expect(onboardingMode({})).toBe('off');
    expect(onboardingMode({ CREDIT_ONBOARDING_ENABLED: '1' })).toBe('live');
    expect(onboardingMode({ CREDIT_ONBOARDING_ENABLED: '1', CREDIT_ONBOARDING_DRY_RUN: '1' })).toBe('dry_run');
  });

  test('the attester is its own key if set, else the credit operator', () => {
    expect(stateAttesterKey({ CREDIT_OPERATOR_PRIVATE_KEY: 'ab' })).toBe('0xab');
    expect(stateAttesterKey({ STATE_ATTESTER_PRIVATE_KEY: '0xcd', CREDIT_OPERATOR_PRIVATE_KEY: 'ab' })).toBe('0xcd');
    expect(stateAttesterKey({})).toBeNull();
  });
});

describe('until the role is granted, the job stands down quietly', () => {
  test('no attestation, no identity or profile reads, no alert; one summary line says why', async () => {
    const members = { [wallet(1)]: { verified: true, profile: 'CA' }, [wallet(2)]: { line: true } };
    const h = harness(members, { readiness: { ready: false, why: `the attester ${ATTESTER} does not hold STATE_ATTESTER_ROLE yet` } });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results.map((r) => [r.action, r.wait])).toEqual([['waiting', 'awaiting_role'], ['has_line', undefined]]);
    expect(h.simulated).toHaveLength(0);
    expect(h.opened).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
    expect(h.lookups).toEqual({ verified: 0, profile: 0 });
    const line = summarize(run, 'live');
    expect(line).toContain('1 awaiting the attester role');
    expect(line).toContain('Attestations paused: the attester');
    expect(line.split('\n')).toHaveLength(1);
  });

  test('a member already attested still gets their line', async () => {
    const h = harness({ [wallet(1)]: { onChain: 'CA' } }, { readiness: { ready: false, why: 'no role' } });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results[0].action).toBe('opened');
    expect(h.sent).toHaveLength(0);
  });
});

describe('attest, then open', () => {
  test('a verified member: the profile’s state, as deploy 25 encodes it, then the line', async () => {
    const w = wallet(1);
    const h = harness({ [w]: { verified: true, profile: 'New York' } });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results[0]).toMatchObject({ action: 'opened', attested: true, txHashes: ['0xa1', '0xb1'] });
    expect(h.sent[0].to).toBe(REGISTRY);
    const [member, code] = iface.decodeFunctionData('attestStateCode', h.sent[0].data);
    expect(String(member).toLowerCase()).toBe(w);
    expect(code).toBe(encodeStateCode('NY'));
    expect(h.simulated[0]).toEqual(h.sent[0]); // simulated before it was sent
    expect(h.opened).toEqual([{ wallet: w, dryRun: false }]);
  });

  test('never for a member whose identity is not verified, or whose state is missing or not a state', async () => {
    const h = harness({
      [wallet(1)]: { verified: false, profile: 'CA' },
      [wallet(2)]: { verified: true, profile: null },
      [wallet(3)]: { verified: true, profile: 'Calif.' },
      [wallet(4)]: { verified: true, unreadable: true },
    });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results.map((r) => r.wait)).toEqual(['not_verified', 'no_state', 'unrecognized_state', 'profile_unreadable']);
    expect(h.simulated).toHaveLength(0);
    expect(h.opened).toHaveLength(0);
    const line = summarize(run, 'live');
    expect(line).toContain('1 identity not verified, 1 no state on profile, 1 state on profile not a US state, 1 profile unreadable here');
  });

  test('an attested state that differs from the profile is never overwritten: ops are told once, the line opens', async () => {
    const w = wallet(1);
    const members = { [w]: { onChain: 'CA', verified: true, profile: 'Texas', open: { opened: false, reason: 'state_not_confirmed' } as OpenLineResult } };
    const h = harness(members);
    await runCreditOnboarding(h.deps);
    await runCreditOnboarding(h.deps);
    expect(h.sent).toHaveLength(0);
    expect(h.opened).toHaveLength(2);
    const mismatch = h.alerts.filter((a) => a.key.includes('state-mismatch'));
    expect(mismatch).toHaveLength(1);
    // The wallet, but never where they live.
    expect(mismatch[0].body).not.toMatch(/\bCA\b|\bTX\b|Texas|California/);
  });

  test('the revolving product off in their state: recorded, then left alone for a day', async () => {
    const w = wallet(1);
    const members = { [w]: { onChain: 'NY', open: { opened: false, reason: 'state_not_enabled' } as OpenLineResult } };
    const h = harness(members);
    expect((await runCreditOnboarding(h.deps)).results[0].wait).toBe('state_not_enabled');
    expect((await runCreditOnboarding(h.deps)).results[0].wait).toBe('backing_off');
    expect(h.opened).toHaveLength(1);
    h.deps.now = NOW + NOT_ENABLED_BACKOFF_S + 1;
    await runCreditOnboarding(h.deps);
    expect(h.opened).toHaveLength(2);
    expect(h.alerts).toHaveLength(0);
  });

  test('a second run repeats nothing: the chain says the line is there', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' } });
    await runCreditOnboarding(h.deps);
    const again = await runCreditOnboarding(h.deps);
    expect(again.results[0].action).toBe('has_line');
    expect(h.sent).toHaveLength(1);
    expect(h.opened).toHaveLength(1);
  });

  test('bounded per run: the rest wait for the next', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' }, [wallet(2)]: { verified: true, profile: 'CA' }, [wallet(3)]: { line: true } }, { max: 1 });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results.map((r) => r.action)).toEqual(['opened', 'deferred', 'has_line']);
  });
});

describe('simulate first; refusals are sentences, failures are alerted', () => {
  test('the role missing at send time is a refusal, not a failure', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' } }, { attestSim: missingRole() });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results[0]).toMatchObject({ action: 'waiting', wait: 'refused' });
    expect(run.results[0].reason).toContain('STATE_ATTESTER_ROLE');
    expect(h.sent).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  test('deployed builds strip revert strings: an empty revert with the role gone is a pause, not a failure', async () => {
    const empty = classifySimulationError({ code: 'CALL_EXCEPTION', shortMessage: 'missing revert data' }, describeOnboardingRefusal);
    expect(empty.kind).toBe('failed');
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' } }, { attestSim: empty });
    let reads = 0;
    h.deps.attestReadiness = async () => (reads++ === 0 ? { ready: true } : { ready: false, why: 'role revoked' });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results[0]).toMatchObject({ action: 'waiting', wait: 'awaiting_role', reason: 'role revoked' });
    expect(h.alerts).toHaveLength(0);
  });

  test('any other revert is a failure: nothing sent, one alert for the hour', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' } }, { attestSim: simOf('NetworkRegistryInvalidStateCode', []) });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results[0].action).toBe('failed');
    expect(h.sent).toHaveLength(0);
    expect(h.alerts.map((a) => a.key)).toEqual([`credit-onboarding:failures:${new Date(NOW * 1000).toISOString().slice(0, 13)}`]);
  });

  test('dry run: simulates, sends nothing, and the alert is counts only', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' }, [wallet(2)]: { onChain: 'CA' } }, { mode: 'dry_run' });
    const run = await runCreditOnboarding(h.deps);
    expect(run.results.map((r) => [r.action, r.wouldAttest ?? false])).toEqual([['would_send', true], ['would_send', false]]);
    expect(h.sent).toHaveLength(0);
    expect(h.simulated).toHaveLength(1);
    expect(h.opened).toEqual([{ wallet: wallet(2), dryRun: true }]);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].subject).toBe('Credit onboarding (dry run): would attest 1 state(s) and open 1 line(s)');
    expect(h.alerts[0].body).not.toContain('0x');
    expect(summarize(run, 'dry_run')).toContain('2 would be sent (1 attestation(s))');
  });

  test('the registry the issuer reads must be the one attested on: otherwise paused, and alerted', async () => {
    const h = harness({ [wallet(1)]: { verified: true, profile: 'CA' } }, { readiness: { ready: false, why: 'registry mismatch', alert: true } });
    await runCreditOnboarding(h.deps);
    expect(h.sent).toHaveLength(0);
    expect(h.alerts[0].subject).toBe('Credit onboarding: attestations paused');
  });
});

describe('openLine through the operator: simulated, the state gate read as a reason', () => {
  const MEMBER = wallet(9);
  const open = (sim: Simulation, tiers = 6n, line = false) => {
    const sent: ChainCall[] = [];
    const deps = {
      issuer: ISSUER,
      reader: { creditPeriods: async () => [line ? 5n : 0n, 0n, 0n, false] as const, tierCount: async () => tiers },
      runner: {
        from: ATTESTER,
        simulate: async () => sim,
        send: async (call: ChainCall) => {
          sent.push(call);
          return { hash: '0xc1', logs: [], status: 1 };
        },
      },
    };
    return { deps, sent };
  };

  test('no attested state, and a state with the product off, are the two reasons callers act on', async () => {
    const none = open(simOf('RevolvingIssuerStateNotEnabled', [MEMBER, ethers.ZeroHash]));
    expect((await openLineWith(none.deps, MEMBER)).reason).toBe('state_not_confirmed');
    const ny = open(simOf('RevolvingIssuerStateNotEnabled', [MEMBER, encodeStateCode('NY')]));
    const r = await openLineWith(ny.deps, MEMBER);
    expect(r.reason).toBe('state_not_enabled');
    expect(r.detail).not.toContain('NY');
    expect(none.sent.length + ny.sent.length).toBe(0);
  });

  test('one zero capacity per tier and the default cycle day; a dry run sends nothing', async () => {
    const ok = open({ kind: 'ok', returnData: '0x' });
    expect(await openLineWith(ok.deps, MEMBER, { dryRun: true })).toEqual({ opened: false, reason: 'dry_run', wouldOpen: true });
    expect(ok.sent).toHaveLength(0);
    expect(await openLineWith(ok.deps, MEMBER)).toEqual({ opened: true, txHash: '0xc1' });
    const [member, capacities, day] = iface.decodeFunctionData('openLine', ok.sent[0].data);
    expect([String(member).toLowerCase(), capacities.length, Number(day)]).toEqual([MEMBER, 6, 0]);
  });

  test('a member with a line is left alone', async () => {
    const has = open({ kind: 'ok', returnData: '0x' }, 6n, true);
    expect(await openLineWith(has.deps, MEMBER)).toEqual({ opened: false, reason: 'already has a line' });
    expect(has.sent).toHaveLength(0);
  });
});
