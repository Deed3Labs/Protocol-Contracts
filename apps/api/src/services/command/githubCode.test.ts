import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { codeActivity, codeChanges, codeConfig, codeStatus, pollOnce, pollPulls, recordPullError, type GithubSource, type ListedCommit, type ListedPull } from './github.js';
import { syncInventory } from './indexer.js';
import { SEE, TOTALS } from './levels.js';
import { contractsSection } from './sections.js';
import { seedCommand } from './seed.js';

/*
 * The Code tab: commits on more than one branch (a commit on dev and main is one row with both),
 * the pull requests that touch the contracts, read with an ETag and a files budget, and the payload
 * Contracts sends, with no names at Totals.
 */

const cfg = codeConfig({});
const NOW = Date.parse('2026-10-23T17:00:00Z');
const at = (d: string) => new Date(`2026-${d}Z`).toISOString();
const sha = (n: number) => n.toString(16).padStart(40, 'a');
const commit = (n: number, when: string, message: string, login: string | null = 'KyngKai909', author = 'Isaiah Litt'): ListedCommit => ({
  sha: sha(n),
  committedAt: at(when),
  author,
  email: 'kai@useclear.org',
  login,
  message,
  url: `https://github.com/${cfg.repo}/commit/${sha(n)}`,
});
const pull = (number: number, state: ListedPull['state'], updated: string, o: Partial<ListedPull> = {}): ListedPull => ({
  number,
  title: `PR ${number}`,
  state,
  draft: false,
  login: 'KyngKai909',
  head: `feat/pr-${number}`,
  base: 'dev',
  headSha: sha(1000 + number),
  createdAt: at(updated),
  updatedAt: at(updated),
  mergedAt: state === 'merged' ? at(updated) : null,
  closedAt: state === 'open' ? null : at(updated),
  url: `https://github.com/${cfg.repo}/pull/${number}`,
  ...o,
});

// a stand-in GitHub: each branch's commits, the pull requests, and what was asked of it
const hist: Record<string, ListedCommit[]> = { dev: [], main: [] };
const filesOf: Record<string, string[]> = {};
let prs: ListedPull[] = [];
let prVersion = 0;
const prFiles: Record<number, string[]> = {};
const asked: Array<{ branch: string; page: number; etag: string | null }> = [];
const prAsked: Array<{ page: number; etag: string | null }> = [];
const commitFileCalls: string[] = [];
const prFileCalls: number[] = [];
let left = 5000;
const src: GithubSource = {
  authorized: true,
  list: async (c, since, page, etag) => {
    asked.push({ branch: c.branch, page, etag });
    const all = (hist[c.branch] ?? []).filter((h) => !since || h.committedAt >= since).sort((a, b) => b.committedAt.localeCompare(a.committedAt));
    const tag = `"${c.branch}:${all.length}:${since}"`;
    if (etag && etag === tag) return { notModified: true, remaining: left };
    return { notModified: false, etag: tag, commits: all.slice((page - 1) * 2, page * 2), more: all.length > page * 2, remaining: left };
  },
  files: async (_r, s) => {
    commitFileCalls.push(s);
    return { files: filesOf[s] ?? [], remaining: --left };
  },
  pulls: async (_r, page, etag) => {
    prAsked.push({ page, etag });
    const tag = `"pulls:${prVersion}"`;
    if (etag && etag === tag) return { notModified: true, remaining: left };
    const all = [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { notModified: false, etag: tag, pulls: all.slice((page - 1) * 2, page * 2), more: all.length > page * 2, remaining: left };
  },
  pullFiles: async (_r, n) => {
    prFileCalls.push(n);
    return { files: prFiles[n] ?? [], remaining: --left, requests: 1 };
  },
};
const reset = () => {
  asked.length = 0;
  prAsked.length = 0;
  commitFileCalls.length = 0;
  prFileCalls.length = 0;
};

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('which branches', () => {
  test('dev and main by default, the release branch first; COMMAND_GITHUB_BRANCH still names the release lanes’ branch', () => {
    expect(codeConfig({})).toMatchObject({ branch: 'dev', branches: ['dev', 'main'] });
    expect(codeConfig({ COMMAND_GITHUB_BRANCHES: ' main , release ' })).toMatchObject({ branch: 'dev', branches: ['dev', 'main', 'release'] });
    expect(codeConfig({ COMMAND_GITHUB_BRANCH: 'staging' })).toMatchObject({ branch: 'staging', branches: ['staging', 'dev', 'main'] });
  });
});

describe('commits on more than one branch', () => {
  test('a commit on dev and main is one row with both branches, its files asked for once', async () => {
    const both = commit(1, '10-10T10:00:00', 'Pool v2 (#700)');
    hist.dev = [both, commit(2, '10-20T10:00:00', 'Pool queue fix (#740)', null, 'Someone Else')];
    hist.main = [both, commit(3, '10-21T10:00:00', 'Hotfix on main')];
    filesOf[sha(1)] = ['contracts/peripherals/LendingPool.sol'];
    filesOf[sha(2)] = ['contracts/peripherals/LendingPool.sol'];
    filesOf[sha(3)] = ['contracts/core/ClearUSDUpgradeable.sol'];
    reset();
    const r = await pollOnce(db, src, cfg);
    expect([r.listed, r.added, r.filled, r.waiting]).toEqual([4, 3, 3, 0]);
    expect(commitFileCalls.sort()).toEqual([sha(1), sha(2), sha(3)].sort());
    const { rows } = await db.query<{ sha: string; branch: string; branches: string[] }>('SELECT sha, branch, branches FROM command.code_commits ORDER BY committed_at');
    expect(rows.map((x) => [x.sha, x.branch, x.branches])).toEqual([
      [sha(1), 'dev', ['dev', 'main']],
      [sha(2), 'dev', ['dev']],
      [sha(3), 'main', ['main']],
    ]);
    // a commit seen again doesn't list its branch twice
    await pollOnce(db, src, cfg);
    const again = await db.query<{ branches: string[] }>('SELECT branches FROM command.code_commits WHERE sha = $1', [sha(1)]);
    expect(again.rows[0].branches).toEqual(['dev', 'main']);
  });

  test('each branch keeps its own cursor and ETag; a quiet run is one ask a branch', async () => {
    reset();
    const r = await pollOnce(db, src, cfg);
    expect(r.notModified).toBe(true);
    expect(asked.map((a) => [a.branch, a.page, !!a.etag])).toEqual([
      ['dev', 1, true],
      ['main', 1, true],
    ]);
    const { rows } = await db.query<{ branch: string }>('SELECT branch FROM command.code_cursor ORDER BY branch');
    expect(rows.map((x) => x.branch)).toEqual(['dev', 'main']);
    expect(commitFileCalls).toEqual([]);
  });

  test('the release lanes read dev only: a commit only on main is no change in flight', async () => {
    const releases = new Map([['LendingPool', [{ version: 'v1.0', at: Date.parse('2026-10-01T00:00:00Z'), implementation: '' }]]]);
    const map = [
      { name: 'LendingPool', deployed: 'LendingPool', deployedAt: null },
      { name: 'ClearUSD', deployed: 'ClearUSDUpgradeable', deployedAt: Date.parse('2026-09-01T00:00:00Z') },
    ];
    const { open } = await codeChanges(db, cfg, map, releases, NOW);
    expect(open.map((x) => [x.id, x.commits.map((y) => y.sha)])).toEqual([['code:LendingPool', [sha(1), sha(2)]]]);
  });

  test('a contract whose deployed code is exactly dev’s has nothing in flight: its later commits went out with its release', async () => {
    const at = Date.parse('2026-10-01T00:00:00Z');
    const releases = new Map([['LendingPool', [{ version: 'v1.0', at, implementation: '' }]]]);
    const map = [{ name: 'LendingPool', deployed: 'LendingPool', deployedAt: null }];
    const same = await codeChanges(db, cfg, map, releases, NOW, new Map([['LendingPool', true]]));
    expect(same.open).toEqual([]);
    expect(same.done.find((d) => d.id === 'rel:LendingPool:v1.0')!.commits.map((y) => y.sha)).toEqual([sha(1), sha(2)]);
    // different: still in flight, and it says why
    const differs = await codeChanges(db, cfg, map, releases, NOW, new Map([['LendingPool', false]]));
    expect(differs.open.map((x) => [x.id, x.state])).toEqual([['code:LendingPool', '2 commits on dev · differs from what’s deployed']]);
  });

  test('the files budget holds across branches, the release branch’s commits first', async () => {
    hist.main.push(commit(4, '10-22T08:00:00', 'main a'), commit(5, '10-22T09:00:00', 'main b'));
    hist.dev.push(commit(6, '10-22T10:00:00', 'dev a'));
    reset();
    const r = await pollOnce(db, src, cfg, { filesBudget: 2 });
    expect([r.added, r.filled, r.waiting]).toEqual([3, 2, 1]);
    expect(commitFileCalls).toEqual([sha(6), sha(4)]);
    reset();
    expect((await pollOnce(db, src, cfg, { filesBudget: 2 })).waiting).toBe(0);
    expect(commitFileCalls).toEqual([sha(5)]);
  });
});

describe('pull requests', () => {
  beforeAll(() => {
    prs = [
      pull(10, 'open', '10-22T10:00:00', { draft: true, base: 'dev' }),
      pull(9, 'merged', '10-20T10:00:00'),
      pull(8, 'merged', '10-18T10:00:00', { login: 'docs-writer' }),
      pull(7, 'closed', '10-15T10:00:00', { login: 'someone' }),
      pull(3, 'merged', '09-01T10:00:00'),
      pull(2, 'merged', '08-01T10:00:00'),
      pull(1, 'merged', '07-01T10:00:00'),
    ];
    prFiles[10] = ['contracts/peripherals/LendingPool.sol', 'apps/api/src/x.ts'];
    prFiles[9] = ['contracts/issuers/RevolvingIssuer.sol', 'docs/notes.md'];
    prFiles[8] = ['docs/README.md'];
    prFiles[7] = ['contracts/mocks/MockUSDC.sol'];
  });

  test('the first run reads the list until a PR older than 30 days, then each PR’s files', async () => {
    reset();
    const r = await pollPulls(db, src, cfg, { now: NOW });
    expect(prAsked.map((a) => a.page)).toEqual([1, 2, 3]);
    expect([r.listed, r.read, r.waiting]).toEqual([4, 4, 0]);
    expect(prFileCalls).toEqual([10, 9, 8, 7]);
    const { rows } = await db.query<{ number: number; touches: boolean; contracts: string[]; files: string[] }>(
      'SELECT number, touches, contracts, files FROM command.code_pulls ORDER BY number DESC',
    );
    expect(rows.map((x) => [x.number, x.touches, x.contracts])).toEqual([
      [10, true, ['LendingPool']],
      [9, true, ['RevolvingIssuer']],
      [8, false, []],
      [7, true, []],
    ]);
    // one that touches no project (docs only) keeps no files
    expect(rows.find((x) => x.number === 8)!.files).toEqual([]);
    // each is in the projects its files are in
    const { rows: pj } = await db.query<{ number: number; projects: string[] }>('SELECT number, projects FROM command.code_pulls ORDER BY number DESC');
    expect(pj.map((x) => [x.number, x.projects])).toEqual([
      [10, ['proto', 'sdk']],
      [9, ['proto']],
      [8, []],
      [7, ['proto']],
    ]);
  });

  test('a quiet run reuses the list’s ETag, is one ask, and reads no files', async () => {
    reset();
    const r = await pollPulls(db, src, cfg, { now: NOW });
    expect(r).toMatchObject({ notModified: true, listed: 0, read: 0 });
    expect(prAsked).toEqual([{ page: 1, etag: '"pulls:0"' }]);
    expect(prFileCalls).toEqual([]);
  });

  test('an open PR whose head moved has its files read again; the others aren’t', async () => {
    prs[0] = { ...prs[0], updatedAt: at('10-23T09:00:00'), headSha: sha(2000), draft: false };
    prFiles[10] = [...prFiles[10], 'contracts/core/ClearUSDUpgradeable.sol'];
    prVersion++;
    reset();
    const r = await pollPulls(db, src, cfg, { now: NOW });
    expect(prAsked[0].etag).toBe('"pulls:0"');
    expect(r.read).toBe(1);
    expect(prFileCalls).toEqual([10]);
    const { rows } = await db.query<{ contracts: string[]; draft: boolean }>('SELECT contracts, draft FROM command.code_pulls WHERE number = 10');
    expect(rows[0]).toEqual({ contracts: ['ClearUSDUpgradeable', 'LendingPool'], draft: false });
  });

  test('the files budget holds: what’s left waits for the next run', async () => {
    for (const n of [11, 12, 13]) {
      prs.push(pull(n, 'open', `10-23T1${n - 10}:00:00`, { login: 'someone' }));
      prFiles[n] = ['contracts/peripherals/PayoutPool.sol'];
    }
    prVersion++;
    reset();
    const first = await pollPulls(db, src, cfg, { now: NOW, filesBudget: 2 });
    expect([first.read, first.waiting]).toEqual([2, 1]);
    expect(prFileCalls).toEqual([13, 12]);
    reset();
    const second = await pollPulls(db, src, cfg, { now: NOW, filesBudget: 2 });
    expect([second.read, second.waiting]).toEqual([1, 0]);
    expect(prFileCalls).toEqual([11]);
  });

  test('running low on rate limit stops reading files', async () => {
    prs.push(pull(14, 'open', '10-23T15:00:00'), pull(15, 'open', '10-23T16:00:00'));
    prVersion++;
    left = 6;
    reset();
    const r = await pollPulls(db, src, cfg, { now: NOW });
    expect([r.read, r.waiting]).toEqual([2, 0]);
    left = 4;
    prs.push(pull(16, 'open', '10-23T16:10:00'), pull(17, 'open', '10-23T16:20:00'));
    prVersion++;
    reset();
    const low = await pollPulls(db, src, cfg, { now: NOW });
    expect([low.read, low.waiting]).toEqual([1, 1]);
    left = 5000;
    await pollPulls(db, src, cfg, { now: NOW });
    expect(await codeStatus(db, cfg)).toMatchObject({ pulls: { waitingForFiles: 0, error: null } });
  });
});

describe('Contracts’ Code payload', () => {
  const env = process.env.PROVIDER_CONTRACTS;
  beforeAll(async () => {
    await seedCommand(db);
    await syncInventory(db);
  });
  afterAll(() => {
    if (env == null) delete process.env.PROVIDER_CONTRACTS;
    else process.env.PROVIDER_CONTRACTS = env;
  });
  const read = (level: 1 | 2) => contractsSection(db, { level, reveal: false, now: new Date(NOW) }) as Promise<any>;

  test('the seed sends no Code', async () => {
    delete process.env.PROVIDER_CONTRACTS;
    expect((await read(SEE)).CODE).toBeUndefined();
  });

  test('live, the commits, pull requests, branches, contributors and how fresh it is', async () => {
    process.env.PROVIDER_CONTRACTS = 'live';
    const { CODE } = await read(SEE);
    expect(Object.keys(CODE).sort()).toEqual(['branches', 'commits', 'contributors', 'names', 'path', 'people', 'poller', 'projects', 'pulls', 'repo', 'watch']);
    expect(CODE.names).toBe('shown');
    // newest first, across branches, the branches it's on in the watched order
    expect(CODE.commits.map((x: any) => x.sha)).toEqual([6, 5, 4, 3, 2, 1].map((n) => sha(n).slice(0, 7)));
    expect(CODE.commits.at(-1)).toEqual({
      sha: sha(1).slice(0, 7),
      url: `https://github.com/${cfg.repo}/commit/${sha(1)}`,
      branches: ['dev', 'main'],
      author: 'Isaiah Litt',
      login: 'KyngKai909',
      message: 'Pool v2 (#700)',
      at: Date.parse('2026-10-10T10:00:00Z'),
      pr: 700,
      contracts: ['LendingPool'],
      projects: ['proto'],
    });
    // only the PRs that touch the path, open or lately merged or closed; newest first
    const nums = CODE.pulls.map((p: any) => p.number);
    expect(nums).not.toContain(8);
    expect(nums).not.toContain(3);
    expect(nums.slice(-3)).toEqual([10, 9, 7]);
    expect(CODE.pulls.find((p: any) => p.number === 9)).toEqual({
      number: 9,
      title: 'PR 9',
      state: 'merged',
      draft: false,
      login: 'KyngKai909',
      head: 'feat/pr-9',
      base: 'dev',
      createdAt: Date.parse('2026-10-20T10:00:00Z'),
      updatedAt: Date.parse('2026-10-20T10:00:00Z'),
      mergedAt: Date.parse('2026-10-20T10:00:00Z'),
      closedAt: Date.parse('2026-10-20T10:00:00Z'),
      url: `https://github.com/${cfg.repo}/pull/9`,
      files: 2,
      contracts: ['RevolvingIssuer'],
      projects: ['proto'],
    });
    expect(CODE.branches).toEqual([
      { name: 'dev', commits30: 3, lastAt: Date.parse('2026-10-22T10:00:00Z') },
      { name: 'main', commits30: 4, lastAt: Date.parse('2026-10-22T09:00:00Z') },
    ]);
    // by login, else the name on the commit; commits and PRs opened in 30 days
    const kai = CODE.contributors.find((x: any) => x.who === 'KyngKai909');
    expect(kai).toMatchObject({ name: 'Isaiah Litt', commits30: 5, pulls30: 2 });
    expect(CODE.contributors.find((x: any) => x.who === 'Someone Else')).toMatchObject({ commits30: 1, pulls30: 0 });
    expect(CODE.contributors.find((x: any) => x.who === 'someone')).toMatchObject({ commits30: 0, pulls30: 4 });
    // everyone in the stored history, with their last 30 days alongside
    expect(CODE.contributors.every((x: any) => x.commits >= x.commits30 && x.pulls >= x.pulls30)).toBe(true);
    // a PR that touches nothing under the path doesn't make its author a contributor
    expect(CODE.contributors.find((x: any) => x.who === 'docs-writer')).toBeUndefined();
    expect(CODE.people).toBe(CODE.contributors.length);
    expect(CODE.poller).toMatchObject({ error: null, waiting: 0, branches: ['dev', 'main'] });
    expect(typeof CODE.poller.ranAt).toBe('number');
  });

  test('at Totals: counts only, no names or logins', async () => {
    process.env.PROVIDER_CONTRACTS = 'live';
    const { CODE } = await read(TOTALS);
    expect(CODE.names).toBe('none');
    expect(CODE.contributors).toEqual([]);
    expect(CODE.people).toBe(3);
    expect(CODE.commits.every((x: any) => x.author === '' && x.login === '')).toBe(true);
    expect(CODE.pulls.every((x: any) => x.login === '')).toBe(true);
    const text = JSON.stringify(CODE);
    for (const name of ['KyngKai909', 'Isaiah Litt', 'Someone Else', '"someone"']) expect(text).not.toContain(name);
    expect(CODE.branches.map((b: any) => b.commits30)).toEqual([3, 4]);
  });

  test('a failed run says where it failed', async () => {
    await recordPullError(db, cfg, new Error('GitHub 403 (rate limit spent): API rate limit exceeded'));
    const c = await codeActivity(db, cfg, NOW, true);
    expect(c.poller.error).toBe('pull requests: GitHub 403 (rate limit spent): API rate limit exceeded');
  });
});

describe('every project, not just the contracts', () => {
  test('a commit that touches only an app is listed, in its project, and the project counts it', async () => {
    hist.dev = [...hist.dev, commit(40, '10-23T09:00:00', 'Member: Savings ladder (#711)')];
    filesOf[sha(40)] = ['apps/member/src/pages/Savings.tsx', 'packages/member-kit/src/index.ts'];
    await pollOnce(db, src, cfg);
    const c = await codeActivity(db, cfg, NOW, true);
    expect(c.commits[0]).toMatchObject({ sha: sha(40).slice(0, 7), contracts: [], projects: ['app'] });
    expect(c.projects.map((p) => p.id)).toEqual(['proto', 'app', 'merchant', 'sdk', 'pay', 'rewards', 'cc']);
    expect(c.projects.find((p) => p.id === 'app')).toMatchObject({ name: 'Member app', path: 'apps/member', commits30: 1, lastAt: Date.parse('2026-10-23T09:00:00Z') });
    expect(c.projects.find((p) => p.id === 'pay')).toMatchObject({ commits30: 0, lastAt: null });
    // the release lanes still read only the contracts' commits
    const { rows } = await db.query<{ contracts: string[] }>('SELECT contracts FROM command.code_commits WHERE sha = $1', [sha(40)]);
    expect(rows[0].contracts).toEqual([]);
  });

  test('the first listing of a branch reaches back 90 days, not the whole history', async () => {
    const seen: Array<string | null> = [];
    const fresh: GithubSource = { ...src, list: async (c, since, page, etag) => (seen.push(since), src.list(c, since, page, etag)) };
    await pollOnce(db, fresh, { ...cfg, branches: ['release-x'], branch: 'release-x' }, { now: NOW });
    expect(seen).toEqual([new Date(NOW - 90 * 24 * 3600e3).toISOString()]);
  });
});
