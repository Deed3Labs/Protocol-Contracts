import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { diskFiles, githubFiles, newestRunLog, parsePlan, parseRunLog, readSigning, signingReader, type PlanFiles } from './signing.js';

/* Build → Signing (brief update 2, section 6): the committed plan as-is, else the newest plan run's log. No network. */

const DIR = new URL('../../../../../deployments/base-sepolia/', import.meta.url).pathname;
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const step = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  stage: 'Day 7',
  title: `Run ${id}`,
  explanation: 'x',
  kind: 'safe',
  signer: A(1),
  signerLabel: 'the Safe',
  chainId: 84532,
  to: A(2),
  toLabel: 'Earn timelock',
  value: '0',
  data: '0x1234',
  functionSignature: 'executeBatch(address[],uint256[],bytes[],bytes32,bytes32)',
  args: [],
  dependsOn: [],
  status: 'waiting',
  reason: 'Not yet.',
  ...o,
});
const planOf = (steps: unknown[], o: Record<string, unknown> = {}) => {
  const sha = createHash('sha256').update(JSON.stringify(steps)).digest('hex');
  return JSON.stringify(
    {
      format: 'clear-signing-plan/1',
      generatedAt: '2026-11-18T06:04:25.694Z',
      network: 'base-sepolia',
      chainId: 84532,
      block: 60299909,
      blockTime: '2026-11-18T06:04:10.000Z',
      stepsSha256: sha,
      notes: [],
      steps,
      ...o,
    },
    null,
    2,
  );
};
const LOG = `Warning: Unused function parameter.
   --> contracts/peripherals/Liquidator.sol:267:72:
    |
Signing plan for base-sepolia (chain 84532) at block 60137297, 2026-11-17T21:02:08.000Z. Sends nothing.

DONE    C1d-1                      the vault's admin (VAULT_ADMIN, the deployer) -> ESADepositVault (the savings vault).upgradeToAndCall
WAITING E8x-earn-execute           [Safe] Clear Lending Safe (its owners sign in the Safe app) -> Earn timelock.executeBatch
        Not yet: the Earn timelock's 7 days end at 2026-11-24T18:35:48.000Z.
READY   E8-holderdirections-propose treasury signer 1 -> CollateralAgent.proposeChange
0 ready, 1 waiting, 1 done. steps sha256 70ef78b0
`;

const files = (map: Record<string, string>, version: string | null = 'abc'): PlanFiles => ({
  version: async () => version,
  read: async (p) => map[p] ?? null,
  list: async (d) =>
    Object.keys(map)
      .filter((p) => p.startsWith(`${d}/`))
      .map((p) => p.slice(d.length + 1)),
});

describe('the plan', () => {
  test('goes out exactly as the file has it, its steps in their own key order, so the browser’s fingerprint check holds', async () => {
    const steps = [step('E8x-earn-execute'), step('C1d-1', { status: 'done', kind: 'wallet' })];
    const text = planOf(steps);
    const s = await readSigning(files({ 'deployments/base-sepolia/signing-plan.json': text }), 'base-sepolia', 5);
    expect([s.source, s.file, s.commit, s.readAt]).toEqual(['plan', 'deployments/base-sepolia/signing-plan.json', 'abc', 5]);
    expect(JSON.stringify(s.plan)).toBe(JSON.stringify(JSON.parse(text)));
    expect(createHash('sha256').update(JSON.stringify(s.plan!.steps)).digest('hex')).toBe(s.plan!.stepsSha256);
  });

  test('is refused as tools/signing-page refuses it: another format, another chain, a malformed step, a changed step', () => {
    const steps = [step('A')];
    expect(parsePlan('nope')).toEqual({ error: 'signing-plan.json isn’t JSON' });
    expect('error' in parsePlan(planOf(steps, { format: 'other/1' }))).toBe(true);
    expect(parsePlan(planOf(steps, { chainId: 8453 }))).toEqual({ error: 'the plan is for chain 8453, not Base Sepolia' });
    expect(parsePlan(planOf([step('A', { to: 'nowhere' })]))).toEqual({ error: 'step A is malformed' });
    const changed = JSON.parse(planOf(steps));
    changed.steps[0].data = '0xdead';
    expect((parsePlan(JSON.stringify(changed)) as { error: string }).error).toMatch(/fingerprint/);
  });

  test('a plan that fails its checks gives way to the run log, saying why', async () => {
    const bad = JSON.parse(planOf([step('A')]));
    bad.steps[0].title = 'edited';
    const s = await readSigning(files({ 'deployments/base-sepolia/signing-plan.json': JSON.stringify(bad), 'deployments/base-sepolia/run-log/Z1-signing-plan-end.log': LOG }), 'base-sepolia', 1);
    expect([s.source, s.plan, s.problem]).toEqual(['run-log', null, 'the plan’s steps don’t match its fingerprint (stepsSha256): it was changed after the script wrote it']);
  });

  test('the committed plan, when it’s there, passes its own checks', () => {
    if (!existsSync(`${DIR}signing-plan.json`)) return;
    const r = parsePlan(readFileSync(`${DIR}signing-plan.json`, 'utf8'));
    expect('plan' in r ? r.plan.steps.length : r.error).toBeGreaterThan(0);
  });
});

describe('until a plan is committed, the newest plan run’s log', () => {
  test('each step’s id, status and why it waits, and nothing else', () => {
    const l = parseRunLog(LOG, 'x.log');
    expect(l).toEqual({
      file: 'x.log',
      block: 60137297,
      at: Date.parse('2026-11-17T21:02:08.000Z'),
      steps: [
        { id: 'C1d-1', status: 'done' },
        { id: 'E8x-earn-execute', status: 'waiting', why: "Not yet: the Earn timelock's 7 days end at 2026-11-24T18:35:48.000Z." },
        { id: 'E8-holderdirections-propose', status: 'ready' },
      ],
    });
  });

  test('the newest is the one that read the latest block, whatever its name', () => {
    const older = LOG.replace('60137297', '60082935');
    expect(
      newestRunLog([
        ['Z1.log', older],
        ['E7b.log', LOG],
        ['00-compile.log', 'nothing here'],
      ])!.file,
    ).toBe('E7b.log');
  });

  test('the repo’s own logs: the end of day 0 is 48 done and the three day-7 runs waiting', async () => {
    // as before the plan was committed: the logs alone
    const disk = diskFiles(DIR);
    const s = await readSigning({ ...disk, read: (p, v) => (p.endsWith('/signing-plan.json') ? Promise.resolve(null) : disk.read(p, v)) }, 'base-sepolia', 1, null);
    expect([s.source, s.file]).toEqual(['run-log', 'deployments/base-sepolia/run-log/Z1-signing-plan-end.log']);
    const by = (st: string) => s.runLog!.steps.filter((x) => x.status === st).map((x) => x.id);
    expect([s.runLog!.steps.length, by('done').length]).toEqual([51, 48]);
    expect(by('waiting')).toEqual(['E8x-earn-execute', 'I3x-vault-execute', 'ASx-assurance-execute']);
    expect(s.runLog!.steps.find((x) => x.id === 'I3x-vault-execute')!.why).toMatch(/^Not yet: the vault timelock's 7 days end at 2026-11-24T21:00:10/);
  });

  test('nothing at all: none', async () => {
    expect(await readSigning(files({}), 'base-sepolia', 1)).toEqual({ source: 'none', plan: null, readAt: 1, commit: 'abc' });
  });
});

describe('read from GitHub in production', () => {
  const steps = [step('A')];
  const answers = (calls: string[], head: () => string, plan: string | null = planOf(steps)) =>
    (async (url: string) => {
      calls.push(url);
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: head() }));
      if (url.includes('signing-plan.json')) return plan == null ? new Response('', { status: 404 }) : new Response(plan);
      if (url.includes('/run-log?'))
        return new Response(
          JSON.stringify([
            { name: 'Z1-signing-plan-end.log', type: 'file' },
            { name: '00-compile.log', type: 'file' },
          ]),
        );
      if (url.includes('Z1-signing-plan-end.log')) return new Response(LOG);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

  test('the branch the Code tab follows, at its head; read again only when the head moves, checked once a minute', async () => {
    const calls: string[] = [];
    let sha = 'aaa';
    let t = 0;
    const r = signingReader(
      { GITHUB_TOKEN: '' },
      answers(calls, () => sha),
      () => t,
    );
    expect((await r.read()).commit).toBe('aaa');
    expect(calls).toEqual([
      'https://api.github.com/repos/Deed3Labs/Protocol-Contracts/commits/dev',
      'https://api.github.com/repos/Deed3Labs/Protocol-Contracts/contents/deployments/base-sepolia/signing-plan.json?ref=aaa',
    ]);
    sha = 'bbb';
    t = 30_000;
    await r.read();
    expect(calls).toHaveLength(2);
    t = 61_000;
    expect((await r.read()).commit).toBe('bbb');
    expect(calls).toHaveLength(4);
  });

  test('no plan on the branch: the run-log folder, and only the plan runs’ logs in it', async () => {
    const calls: string[] = [];
    const s = await readSigning(
      githubFiles(
        { COMMAND_GITHUB_REPO: 'o/r', COMMAND_GITHUB_BRANCH: 'main', GITHUB_TOKEN: 't' },
        answers(calls, () => 'ccc', null),
      ),
      'base-sepolia',
      1,
    );
    expect([s.source, s.file, s.commit]).toEqual(['run-log', 'deployments/base-sepolia/run-log/Z1-signing-plan-end.log', 'ccc']);
    expect(calls.some((u) => u.includes('00-compile.log'))).toBe(false);
    expect(calls[0]).toBe('https://api.github.com/repos/o/r/commits/main');
  });

  test('a token GitHub refuses: the public repo’s plan, without it, read again every five minutes', async () => {
    const calls: string[] = [];
    const auth: Array<string | undefined> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push(url);
      auth.push((init.headers as Record<string, string>).Authorization);
      if (url.startsWith('https://api.github.com/')) return new Response('{"message":"Bad credentials"}', { status: 401 });
      if (url === 'https://raw.githubusercontent.com/Deed3Labs/Protocol-Contracts/dev/deployments/base-sepolia/signing-plan.json') return new Response(planOf(steps));
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    let t = 0;
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (m: string) => void warned.push(m);
    try {
      const r = signingReader({ GITHUB_TOKEN: 'expired' }, f, () => t);
      const first = await r.read();
      expect([first.source, first.plan?.steps.length, first.commit]).toEqual(['plan', 1, undefined]);
      // the API once, refused; then only the public file, with no token sent to it
      expect(calls).toEqual(['https://api.github.com/repos/Deed3Labs/Protocol-Contracts/commits/dev', 'https://raw.githubusercontent.com/Deed3Labs/Protocol-Contracts/dev/deployments/base-sepolia/signing-plan.json']);
      expect(auth[1]).toBeUndefined();
      t = 4 * 60_000;
      await r.read();
      expect(calls).toHaveLength(2);
      t = 5 * 60_000 + 1;
      await r.read();
      expect(calls).toHaveLength(3);
      expect(calls[2]).toContain('raw.githubusercontent.com');
      expect(warned).toHaveLength(1);
    } finally {
      console.warn = warn;
    }
  });

  test('the token, when set, is the GitHub poller’s, sent as a bearer token and nothing else', async () => {
    const seen: Array<Record<string, string>> = [];
    const f = (async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ sha: 'x' }));
    }) as unknown as typeof fetch;
    await githubFiles({ GITHUB_TOKEN: 'tok' }, f).head();
    expect(seen[0].Authorization).toBe('Bearer tok');
    await githubFiles({}, f).head();
    expect(seen[1].Authorization).toBeUndefined();
  });
});
