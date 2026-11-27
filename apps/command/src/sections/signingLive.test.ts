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

describe('stage names', () => {
  test('the card fee (CF) and Clear Lending’s routes (RT) have names of their own', () => {
    expect(SGL.stageOf('CF')).toEqual(['CF', 'Card credit fee']);
    expect(SGL.stageOf('RT')).toEqual(['RT', 'Lending routes']);
  });
});

describe('where each step stands now (the API’s live check)', () => {
  const steps = () => [{ id: 'A', status: 'waiting', why: 'old' }, { id: 'B', status: 'ready', why: '' }, { id: 'C', status: 'done', why: '' }] as any[];
  const live = {
    stepsSha256: 'sha',
    checkedAt: 0,
    nextCheckAt: 0,
    block: 1,
    blockTime: 1,
    safes: { '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50': { address: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50', owners: ['0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA'], threshold: 2, nonce: 21, others: [], link: 'x' } },
    steps: {
      A: { status: 'ready', by: 'dry-run', queued: { safeTxHash: '0x1', nonce: 21, signed: [], required: 2, behind: [], link: 'l' } },
      B: { status: 'waiting', why: 'The timelock’s 7 days end later.', opensAt: '2026-11-28T00:22:06.000Z', by: 'timelock' },
    },
  } as any;
  test('the statuses go on the steps only when they’re for this plan', () => {
    const s = steps();
    expect(SGL.applyLive(s, live, 'other')).toBe(false);
    expect(s[0].status).toBe('waiting');
    expect(SGL.applyLive(s, live, 'sha')).toBe(true);
    expect(s[0]).toMatchObject({ status: 'ready', why: '', queued: { nonce: 21 } });
    expect(s[1]).toMatchObject({ status: 'waiting', why: 'The timelock’s 7 days end later.', opensAt: '2026-11-28T00:22:06.000Z' });
    expect(s[2].status).toBe('done');
  });
  test('who owns a Safe, whatever the case of the address', () => {
    expect(SGL.ownsSafe(live, '0x52e6102b7c22eec7a68b11dd71fac7d6d9aecf50', '0x895d44d10d1b7b4f5f38e2ae2322539cf93f7aaa')).toBe(true);
    expect(SGL.ownsSafe(live, '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50', '0x0000000000000000000000000000000000000001')).toBe(false);
    expect(SGL.ownsSafe(live, '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50', null)).toBe(false);
  });
  test('“Ready for this wallet” counts Safe steps the account signs for, nested Safes too', () => {
    const T = '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50';
    const L = '0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d';
    const O = '0xfAFf1081F77bF528bA21eea590f251a755bCdf65';
    const me = '0x7ec1000000000000000000000000000000000001';
    const other = '0x0000000000000000000000000000000000000002';
    const safe = (address: string, owners: string[]) => ({ address, owners, threshold: 2, nonce: 0, others: [], link: 'x' });
    const lv = { ...live, safes: { [T]: safe(T, [me, other]), [L]: safe(L, [me]), [O]: safe(O, [L]) } } as any;
    const step = (signer: string, queued: any = null) => ({ kind: 'safe', who: signer.toLowerCase(), call: { signer }, queued });
    expect(SGL.isMine(step(T), lv, me)).toBe(true);
    expect(SGL.isMine(step(O), lv, me)).toBe(true);
    expect(SGL.isMine(step(T), lv, '0x0000000000000000000000000000000000000009')).toBe(false);
    expect(SGL.isMine(step(T), lv, null)).toBe(false);
    // signed by me, waiting on another owner: not mine; fully signed (to execute) or signed by others: mine
    expect(SGL.isMine(step(T, { signed: [me.toUpperCase().replace('0X', '0x')], required: 2 }), lv, me)).toBe(false);
    expect(SGL.isMine(step(T, { signed: [me, other], required: 2 }), lv, me)).toBe(true);
    expect(SGL.isMine(step(T, { signed: [other], required: 2 }), lv, me)).toBe(true);
    // wallet steps: the account the step names, whatever the case
    expect(SGL.isMine({ kind: 'wallet', who: me }, lv, me.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(SGL.isMine({ kind: 'wallet', who: other }, lv, me)).toBe(false);
    expect(SGL.safesSignedBy(lv, me)).toEqual([T, L, O].map((a) => a.toLowerCase()));
    expect(SGL.safesSignedBy(lv, other)).toEqual([T.toLowerCase()]);
  });
  test('when, in words', () => {
    const now = Date.parse('2026-11-26T18:00:00Z');
    expect(SGL.untilText('2026-11-28T00:22:06Z', now)).toBe('in 30 h 22 min');
    expect(SGL.untilText('2026-11-30T00:00:00Z', now)).toBe('in 3 d 6 h');
    expect(SGL.untilText('2026-11-26T18:20:00Z', now)).toBe('in 20 min');
    expect(SGL.untilText('2026-11-26T17:00:00Z', now)).toBe('now');
    expect(SGL.agoText(now - 30_000, now)).toBe('just now');
    expect(SGL.agoText(now - 4 * 60_000, now)).toBe('4 min ago');
  });
});
