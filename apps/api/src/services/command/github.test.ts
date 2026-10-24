import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { getAddress } from 'viem';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { codeConfig, codeStatus, contractsOf, pollOnce, type GithubSource, type ListedCommit } from './github.js';
import { syncInventory } from './indexer.js';
import { TOTALS } from './levels.js';
import { contractsSection } from './sections.js';
import { seedCommand } from './seed.js';

/*
 * Phase 5c: the commits on dev that touch the contracts, polled from a stand-in GitHub, and the
 * changes Contracts draws from them: a contract's commits since its last release in flight, the
 * commits before a release what it shipped.
 */

const cfg = codeConfig({});
const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number, at: string, message: string, author = 'Isaiah Litt', email = 'kai@useclear.org'): ListedCommit => ({
  sha: sha(n),
  committedAt: new Date(`2026-10-${at}Z`).toISOString(),
  author,
  email,
  login: 'KyngKai909',
  message,
  url: `https://github.com/${cfg.repo}/commit/${sha(n)}`,
});

let history: ListedCommit[] = [];
const filesOf: Record<string, string[]> = {};
const asked: Array<{ since: string | null; page: number; etag: string | null }> = [];
let detailCalls = 0;
let left = 5000;
const etagOf = (since: string | null) => `"${history.length}:${since}"`;
const src: GithubSource = {
  authorized: true,
  list: async (_c, since, page, etag) => {
    asked.push({ since, page, etag });
    const all = history.filter((h) => !since || h.committedAt >= since).sort((a, b) => b.committedAt.localeCompare(a.committedAt));
    if (etag && etag === etagOf(since)) return { notModified: true, remaining: left };
    const slice = all.slice((page - 1) * 2, page * 2);
    return { notModified: false, etag: etagOf(since), commits: slice, more: all.length > page * 2, remaining: left };
  },
  files: async (_r, s) => {
    detailCalls++;
    return { files: filesOf[s] ?? [], remaining: --left };
  },
};

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('reading a commit’s files', () => {
  test('each Solidity file under the path is a contract, by name; mocks, tests and interfaces aren’t', () => {
    expect(
      contractsOf(
        ['contracts/peripherals/LendingPool.sol', 'contracts/mocks/MockUSDC.sol', 'contracts/interfaces/ILendingPool.sol', 'contracts/core/ClearUSDUpgradeable.sol', 'docs/LendingPool.sol', 'contracts/peripherals/README.md'],
        'contracts',
      ),
    ).toEqual(['ClearUSDUpgradeable', 'LendingPool']);
  });
});

describe('the poller', () => {
  test('the first run reads every page, then each commit’s files; the PR comes from a squash merge’s message', async () => {
    history = [commit(1, '01T10:00:00', 'Pool v2 (#700)'), commit(2, '05T10:00:00', 'Issuer tiers (#710)'), commit(3, '06T10:00:00', 'Docs only')];
    filesOf[sha(1)] = ['contracts/peripherals/LendingPool.sol'];
    filesOf[sha(2)] = ['contracts/peripherals/RevolvingIssuer.sol', 'contracts/libraries/CarryIndex.sol'];
    filesOf[sha(3)] = ['contracts/mocks/MockUSDC.sol'];
    const r = await pollOnce(db, src, cfg);
    expect([r.listed, r.added, r.filled, r.waiting]).toEqual([3, 3, 3, 0]);
    expect(asked.map((a) => a.page)).toEqual([1, 2]);
    const { rows } = await db.query<{ sha: string; pr: number | null; contracts: string[] }>('SELECT sha, pr, contracts FROM command.code_commits ORDER BY committed_at');
    expect(rows.map((x) => [x.pr, x.contracts])).toEqual([
      [700, ['LendingPool']],
      [710, ['CarryIndex', 'RevolvingIssuer']],
      [null, []],
    ]);
  });

  test('a quiet run is one ask, answered unchanged, and reads nothing else', async () => {
    // new commits move where it asks from, and an ETag only holds for the same ask: the next run settles it
    expect((await pollOnce(db, src, cfg)).added).toBe(0);
    asked.length = 0;
    detailCalls = 0;
    const r = await pollOnce(db, src, cfg);
    expect(r.notModified).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0].etag).toBeTruthy();
    // it asks from a week before the newest commit, so a late-landing older one is still seen
    expect(asked[0].since).toBe(new Date(Date.parse('2026-10-06T10:00:00Z') - 7 * 24 * 3600e3).toISOString());
    expect(detailCalls).toBe(0);
  });

  test('a new commit: only its files are asked for', async () => {
    history.push(commit(4, '20T10:00:00', 'Pool queue fix (#740)', 'Someone Else', 'dev@example.com'));
    filesOf[sha(4)] = ['contracts/peripherals/LendingPool.sol'];
    asked.length = 0;
    detailCalls = 0;
    const r = await pollOnce(db, src, cfg);
    expect([r.added, r.filled]).toEqual([1, 1]);
    expect(detailCalls).toBe(1);
  });

  test('running low on rate limit stops reading files; the next run carries on', async () => {
    history.push(commit(5, '21T10:00:00', 'a'), commit(6, '21T11:00:00', 'b'), commit(7, '21T12:00:00', 'c'));
    left = 6;
    const first = await pollOnce(db, src, cfg);
    expect([first.added, first.filled, first.waiting]).toEqual([3, 2, 1]);
    left = 5000;
    const second = await pollOnce(db, src, cfg);
    expect([second.filled, second.waiting]).toEqual([1, 0]);
    expect(await codeStatus(db, cfg)).toMatchObject({ commits: 7, waitingForFiles: 0, error: null });
  });
});

describe('Contracts’ changes, live', () => {
  const C = chain.contracts as Record<string, { address: string }>;
  const env = process.env.PROVIDER_CONTRACTS;
  let n = 0;
  const put = (contract: string, event: string, args: Record<string, string>, when: string, block?: number) =>
    db.query(
      `INSERT INTO command.chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, address, contract, event, args, topics, data)
       VALUES (84532, $1, '0x', $2, $3, $4, $5, $6, $7, $8, '{}', '0x')`,
      [block ?? ++n, new Date(`2026-10-${when}Z`).toISOString(), `0x${(++n).toString(16).padStart(64, '0')}`, n, C[contract].address.toLowerCase(), contract, event, JSON.stringify(args)],
    );
  beforeAll(async () => {
    await seedCommand(db);
    await syncInventory(db);
    // LendingPool released v1.0 on 2 Oct (commit 1 shipped in it); commit 4 since then is in flight
    await put('LendingPool', 'Upgraded', { implementation: getAddress(`0x${'1'.repeat(40)}`) }, '02T09:00:00');
    // RevolvingIssuer: v1.0 long ago, v1.1 on 10 Oct with commit 2
    await put('RevolvingIssuer', 'Upgraded', { implementation: getAddress(`0x${'2'.repeat(40)}`) }, '01T00:00:00');
    await put('RevolvingIssuer', 'Upgraded', { implementation: getAddress(`0x${'3'.repeat(40)}`) }, '10T09:00:00');
    // the newest event anchors deploy times: block 1,000,000 at 22 Oct 12:00
    await put('PayoutPool', 'Funded', { from: getAddress(`0x${'4'.repeat(40)}`), amount: '1' }, '22T12:00:00', 1_000_000);
    // AccessManager has no proxy: deployed 21,600 blocks (12 hours) before that
    await db.query(`UPDATE command.chain_contracts SET deploy_block = 978400 WHERE name = 'AccessManager'`);
    await db.query(`INSERT INTO command.people (email, name) VALUES ('kai@useclear.org', 'Kai') ON CONFLICT (email) DO UPDATE SET name = 'Kai'`);
    process.env.PROVIDER_CONTRACTS = 'live';
  });
  afterAll(() => {
    if (env == null) delete process.env.PROVIDER_CONTRACTS;
    else process.env.PROVIDER_CONTRACTS = env;
  });
  const read = () => contractsSection(db, { level: TOTALS, reveal: false, now: new Date('2026-10-23T17:00:00Z') }) as Promise<any>;

  test('commits since a release are a change in flight: the next version, a draft', async () => {
    const c = await read();
    const lp = c.CH.find((x: any) => x.id === 'code:LendingPool');
    expect(lp).toMatchObject({ t: 'LendingPool v1.1', c: 'LendingPool', stage: 0, state: '1 commit on dev · not released', short: 'Pool queue fix (#740)', by: 'Someone Else' });
    expect(lp.ev).toEqual([
      ['seg', 'open', Date.parse('2026-10-20T10:00:00Z'), Date.parse('2026-10-23T17:00:00Z')],
      ['draft', Date.parse('2026-10-20T10:00:00Z')],
    ]);
    // the table's own changes are still there, before GitHub's
    expect(c.CH.findIndex((x: any) => x.id === 'code:LendingPool')).toBeGreaterThan(0);
  });

  test('each release in the last 30 days is a change done, by whoever wrote its commits', async () => {
    const c = await read();
    const ri = c.CH_DONE.find((x: any) => x.id === 'rel:RevolvingIssuer:v1.1');
    // the author is Command's name for their email
    expect(ri).toMatchObject({ t: 'RevolvingIssuer v1.1', state: 'Live 10 Oct', by: 'Kai', d: '1 commit: Issuer tiers (#710)' });
    expect(ri.ev).toEqual([['seg', 'done', Date.parse('2026-10-05T10:00:00Z'), Date.parse('2026-10-10T09:00:00Z')], ['draft', Date.parse('2026-10-05T10:00:00Z')], ['live', Date.parse('2026-10-10T09:00:00Z')]]);
    expect(c.CH_DONE.find((x: any) => x.id === 'rel:LendingPool:v1.0')).toMatchObject({ by: 'Kai', d: '1 commit: Pool v2 (#700)' });
    // a release with nothing found behind it still shows, by nobody we know
    expect(c.CH_DONE.find((x: any) => x.id === 'rel:RevolvingIssuer:v1.0')).toMatchObject({ by: '—', ev: [['live', Date.parse('2026-10-01T00:00:00Z')]] });
    // newest first
    const lives = c.CH_DONE.filter((x: any) => String(x.id).startsWith('rel:')).map((x: any) => x.ev.at(-1)[1]);
    expect(lives).toEqual([...lives].sort((a: number, b: number) => b - a));
    // the Releases pane finds who made the last release by its title
    expect(c.CH_DONE.some((x: any) => x.t === `RevolvingIssuer ${c.RELEASES.ri.at(-1)[0]}`)).toBe(true);
  });

  test('a contract with no proxy released once, when it was deployed', async () => {
    const c = await read();
    expect(c.CH_DONE.find((x: any) => x.id === 'rel:AccessManager:v1.0')).toMatchObject({ state: 'Live 22 Oct', ev: [['live', Date.parse('2026-10-22T00:00:00Z')]] });
  });
});
