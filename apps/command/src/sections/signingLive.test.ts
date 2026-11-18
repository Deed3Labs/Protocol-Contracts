import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as SGL from './signingLive';

/* Build → Signing sends from Command (Kai, 17 Nov): only a plan that passes the signing page's checks, only on
   Base Sepolia, only from the account a step names, and only the plan's own call. */

const PLAN = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../../deployments/base-sepolia/signing-plan.json'), 'utf8'));
const copy = () => JSON.parse(JSON.stringify(PLAN));

describe('the plan’s checks', () => {
  test('the committed plan passes', async () => {
    const r = await SGL.verifyPlan(copy());
    expect('plan' in r).toBe(true);
  });
  test('a step changed after the script wrote it is refused', async () => {
    const p = copy();
    const s = p.steps.find((x: any) => x.data);
    s.data = s.data.slice(0, -2) + (s.data.endsWith('00') ? '01' : '00');
    expect(await SGL.verifyPlan(p)).toEqual({ error: expect.stringContaining('fingerprint') });
  });
  test('another chain is refused, the local test chain too', async () => {
    for (const id of [1, 8453, 31337]) {
      const p = copy();
      p.chainId = id;
      expect(await SGL.verifyPlan(p)).toEqual({ error: expect.stringContaining('Refused') });
    }
  });
});

describe('the steps as the tab draws them', () => {
  test('stages in the rollout’s order, Day 7 last; every signer an account', async () => {
    const g = SGL.sgFromPlan(copy(), 'signing-plan.json', () => null);
    expect(g.stages.at(-1)![0]).toBe('D7');
    expect(g.steps).toHaveLength(PLAN.steps.length);
    for (const s of g.steps) expect(g.accts[s.who]).toBeDefined();
  });
  test('a step waiting on time stays waiting when the steps before it are done', () => {
    const g = SGL.sgFromPlan(copy(), 'f', () => null);
    const byId = Object.fromEntries(g.steps.map((s) => [s.id, s]));
    const w = g.steps.filter((s) => SGL.stateOf(s, {}, byId) === 'waiting');
    expect(w.map((s) => s.id).sort()).toEqual(PLAN.steps.filter((s: any) => s.status === 'waiting').map((s: any) => s.id).sort());
  });
});

describe('sending', () => {
  const eth = (account: string, chain = SGL.BASE_SEPOLIA) => {
    const calls: any[] = [];
    (globalThis as any).ethereum = {
      calls,
      request: async ({ method, params }: any) => {
        calls.push({ method, params });
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return '0x' + chain.toString(16);
        if (method === 'eth_sendTransaction') return '0xabc';
        return null;
      },
    };
    return calls;
  };
  afterEach(() => {
    delete (globalThis as any).ethereum;
    SGL.W.account = null;
    SGL.W.chain = null;
  });
  const step = () => ({ ...PLAN.steps.find((s: any) => s.kind === 'wallet' && s.data), status: 'ready' });

  test('the step’s own account sends exactly the plan’s call', async () => {
    const s = step();
    const calls = eth(s.signer);
    await SGL.connect();
    expect(await SGL.send(s)).toBe('0xabc');
    expect(calls.find((c) => c.method === 'eth_sendTransaction').params).toEqual([{ from: s.signer, to: s.to, data: s.data, value: '0x0' }]);
  });
  test('another account sends nothing', async () => {
    const s = step();
    const calls = eth('0x000000000000000000000000000000000000dEaD');
    await SGL.connect();
    expect(await SGL.send(s)).toBeNull();
    expect(calls.some((c) => c.method === 'eth_sendTransaction')).toBe(false);
  });
  test('another network sends nothing', async () => {
    const s = step();
    const calls = eth(s.signer, 8453);
    SGL.W.account = s.signer.toLowerCase();
    SGL.W.chain = 8453;
    expect(await SGL.send(s)).toBeNull();
    expect(calls.some((c) => c.method === 'eth_sendTransaction')).toBe(false);
  });
  test('a Safe step is never sent from a wallet', async () => {
    const s = { ...PLAN.steps.find((x: any) => x.kind === 'safe' && x.data) };
    const calls = eth(s.signer);
    await SGL.connect();
    expect(await SGL.send(s)).toBeNull();
    expect(calls.some((c) => c.method === 'eth_sendTransaction')).toBe(false);
  });
});
