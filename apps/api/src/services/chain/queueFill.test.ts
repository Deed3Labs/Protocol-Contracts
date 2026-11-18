import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import { classifySimulationError, type CallRunner } from './keeperKit';
import { QUEUE_POOL_ABI, queueFillMinutes, queueFillMode, runQueueFill, type QueueFillDeps, type QueueState } from './queueFill';

/*
 * The queue keeper against a stand-in Yield Pool. It reads first and sends only when shares are
 * queued, the vault has cash, the pool is not suspended and no loss charge is pending, and only when
 * the simulation fills at least one request.
 */

const POOL = '0x00000000000000000000000000000000000000c1';
const iface = new ethers.Interface(QUEUE_POOL_ABI);
const now = 1_800_000_000;

let state: QueueState;
let wouldFill: number;
let refusal: string | null;
let sent: number;
let simulated: number;
let alerts: string[];

const runner: CallRunner = {
  from: '0x00000000000000000000000000000000000000ee',
  simulate: async () => {
    simulated += 1;
    if (refusal) return classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult(refusal, []) });
    return { kind: 'ok', returnData: iface.encodeFunctionResult('fillQueue', [wouldFill]) };
  },
  send: async () => {
    sent += 1;
    const l = iface.encodeEventLog('QueueFilled', [0n, 10n, 10_000_000n, 9_900_000n, 0n]);
    return { hash: '0xabc', status: 1, logs: [{ topics: l.topics, data: l.data }] };
  },
};

const deps = (over: Partial<QueueFillDeps> = {}): QueueFillDeps => ({
  pool: POOL,
  read: async () => state,
  runner,
  mode: 'live',
  alert: async (a) => void alerts.push(a.subject),
  now,
  ...over,
});

beforeEach(() => {
  state = { queuedShares: 10n, vaultCash: 50_000_000n, suspended: false, chargePending: false };
  wouldFill = 1;
  refusal = null;
  sent = 0;
  simulated = 0;
  alerts = [];
});

describe('the queue keeper', () => {
  test('fills when there is something queued and cash for it, and says what it paid', async () => {
    const run = await runQueueFill(deps());
    expect(run).toMatchObject({ outcome: 'sent', filled: 1, paid: 9_900_000n, txHash: '0xabc' });
    expect(sent).toBe(1);
  });

  test('an empty queue or an empty vault: not even simulated', async () => {
    state.queuedShares = 0n;
    expect((await runQueueFill(deps())).outcome).toBe('idle');
    state.queuedShares = 10n;
    state.vaultCash = 0n;
    expect((await runQueueFill(deps())).outcome).toBe('idle');
    expect(simulated).toBe(0);
  });

  test('suspended, or a loss charge pending: left alone', async () => {
    state.suspended = true;
    expect((await runQueueFill(deps())).outcome).toBe('blocked');
    state.suspended = false;
    state.chargePending = true;
    expect((await runQueueFill(deps())).outcome).toBe('blocked');
    expect(sent).toBe(0);
  });

  test('a simulation that would fill nothing is not sent', async () => {
    wouldFill = 0;
    expect((await runQueueFill(deps())).outcome).toBe('nothing_fillable');
    expect(sent).toBe(0);
  });

  test('the pool’s own refusal is not due, not an alert', async () => {
    refusal = 'LendingPoolSuspended';
    const run = await runQueueFill(deps());
    expect(run.outcome).toBe('not_due');
    expect(run.reason).toContain('suspended');
    expect(alerts).toEqual([]);
  });

  test('dry run: says what it would fill, sends nothing', async () => {
    wouldFill = 3;
    const run = await runQueueFill(deps({ mode: 'dry_run' }));
    expect(run).toMatchObject({ outcome: 'would_send', filled: 3 });
    expect(sent).toBe(0);
    expect(alerts).toEqual(['Queue keeper (dry run): fillQueue would fill 3 request(s)']);
  });

  test('a read that fails is alerted', async () => {
    const run = await runQueueFill(deps({ read: async () => Promise.reject(new Error('timeout')) }));
    expect(run.outcome).toBe('failed');
    expect(alerts).toEqual(['Queue keeper: fillQueue not sent']);
  });

  test('off unless switched on; every 15 minutes by default', () => {
    expect(queueFillMode({})).toBe('off');
    expect(queueFillMode({ QUEUE_FILL_KEEPER_ENABLED: '1' })).toBe('live');
    expect(queueFillMode({ QUEUE_FILL_KEEPER_ENABLED: '1', QUEUE_FILL_KEEPER_DRY_RUN: 'yes' })).toBe('dry_run');
    expect(queueFillMinutes({})).toBe(15);
    expect(queueFillMinutes({ QUEUE_FILL_KEEPER_MINUTES: '5' })).toBe(5);
  });

  test('the deployed LendingPool has each function and event, selector for selector', () => {
    const record = new URL('../../../../../deployments/base-sepolia/LendingPool.json', import.meta.url);
    if (!existsSync(record)) return;
    const theirs = new ethers.Interface((JSON.parse(readFileSync(record, 'utf8')) as { abi: ethers.InterfaceAbi }).abi);
    iface.forEachFunction((f) => expect(`${f.name} ${theirs.getFunction(f.name)?.selector}`).toBe(`${f.name} ${f.selector}`));
    iface.forEachEvent((e) => expect(theirs.getEvent(e.name)?.topicHash).toBe(e.topicHash));
  });

  test('registered at startup', () => {
    const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    expect(index).toContain('startQueueFillKeeper()');
  });
});
