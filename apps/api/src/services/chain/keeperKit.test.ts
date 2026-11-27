import { describe, expect, test } from 'bun:test';
import { CHAIN_ERRORS } from './chainErrors';
import { classifySimulationError, envCount, isRevert, keeperMode, withKeeperSendLock } from './keeperKit';

const W = '0x00000000000000000000000000000000000000a1';

describe('the keepers’ switches', () => {
  test('off unless _ENABLED is set; _DRY_RUN with it simulates only', () => {
    expect(keeperMode('X', {})).toBe('off');
    expect(keeperMode('X', { X_ENABLED: '1' })).toBe('live');
    expect(keeperMode('X', { X_ENABLED: 'on', X_DRY_RUN: 'true' })).toBe('dry_run');
    expect(keeperMode('X', { X_DRY_RUN: '1' })).toBe('off');
    expect(keeperMode('X', { X_ENABLED: 'maybe' })).toBe('off');
  });

  test('a keeper that ran before the switches stays on unless set to 0', () => {
    expect(keeperMode('X', {}, true)).toBe('live');
    expect(keeperMode('X', { X_ENABLED: '0' }, true)).toBe('off');
    expect(keeperMode('X', { X_ENABLED: 'false' }, true)).toBe('off');
  });

  test('counts: a positive integer or the default', () => {
    expect(envCount('N', 25, {})).toBe(25);
    expect(envCount('N', 25, { N: '7' })).toBe(7);
    expect(envCount('N', 25, { N: '-1' })).toBe(25);
    expect(envCount('N', 25, { N: 'x' })).toBe(25);
  });
});

describe('a simulation’s error', () => {
  test('the contract’s own "not now" is refused, with a sentence', () => {
    const sim = classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult('PoolShareEnforcerNothingNeeded', [W]) });
    expect(sim.kind).toBe('refused');
    if (sim.kind === 'refused') expect(sim.sentence).not.toContain('0x');
  });

  test('any other revert is a failure', () => {
    expect(classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult('LendingPoolInsufficientCash', [1n, 2n]) }).kind).toBe('failed');
    expect(classifySimulationError({ code: 'CALL_EXCEPTION', shortMessage: 'missing revert data' }).kind).toBe('failed');
  });

  test('an unreachable RPC is thrown, never read as an answer', () => {
    const outage = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    expect(isRevert(outage)).toBe(false);
    expect(() => classifySimulationError(outage)).toThrow('timeout');
  });
});

describe('one keeper send at a time', () => {
  test('sends queue behind each other, and a failure does not jam the queue', async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number, fail = false) =>
      withKeeperSendLock(async () => {
        order.push(`start ${label}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${label}`);
        if (fail) throw new Error(label);
        return label;
      });
    const results = await Promise.allSettled([slow('a', 20, true), slow('b', 1), slow('c', 1)]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });
});
