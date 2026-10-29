import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { branchChecks, checkState, codeActivity, codeConfig, pollChecks, type CheckRun, type GithubSource, type ListedRun, type PullReview, type RunJob } from './github.js';

/*
 * Build's Checks and Reviews (migration 0070): the branch's GitHub Actions runs and their jobs, and each
 * pull request's check runs and reviews, as the poller reads them and the Code payload sends them.
 */

const cfg = codeConfig({});
const NOW = new Date('2026-10-28T12:00:00Z').getTime();
const at = (s: string) => `2026-10-${s}Z`;

// a stand-in GitHub: two runs on dev (one green, one red), a PR's checks and its reviews
const runs: ListedRun[] = [
  { id: 1, workflow: 'ci', branch: 'dev', sha: 'a'.repeat(40), status: 'completed', conclusion: 'success', createdAt: at('20T10:00:00'), updatedAt: at('20T10:06:00'), url: 'https://github.com/r/actions/runs/1' },
  { id: 2, workflow: 'ci', branch: 'dev', sha: 'b'.repeat(40), status: 'completed', conclusion: 'failure', createdAt: at('27T10:00:00'), updatedAt: at('27T10:08:00'), url: 'https://github.com/r/actions/runs/2' },
  { id: 3, workflow: 'ci', branch: 'dev', sha: 'c'.repeat(40), status: 'in_progress', conclusion: null, createdAt: at('28T11:50:00'), updatedAt: at('28T11:51:00'), url: 'https://github.com/r/actions/runs/3' },
];
const ms = (s: string) => new Date(at(s)).getTime();
const jobsOf: Record<number, RunJob[]> = {
  1: [
    { name: 'Apps (typecheck, test)', conclusion: 'success', startedAt: ms('20T10:00:00'), completedAt: ms('20T10:04:00') },
    { name: 'Contracts (hardhat test)', conclusion: 'skipped', startedAt: null, completedAt: null },
  ],
  2: [
    { name: 'Apps (typecheck, test)', conclusion: 'failure', startedAt: ms('27T10:00:00'), completedAt: ms('27T10:06:00') },
    { name: 'Contracts (hardhat test)', conclusion: 'success', startedAt: ms('27T10:00:00'), completedAt: ms('27T10:05:00') },
  ],
};
let prChecks: CheckRun[] = [
  { name: 'Apps (typecheck, test)', status: 'completed', conclusion: 'success', url: 'u1' },
  { name: 'ci', status: 'in_progress', conclusion: null, url: 'u2' },
];
const prReviews: PullReview[] = [{ login: 'dana', state: 'APPROVED', at: ms('27T15:00:00') }];
const asked: string[] = [];
const src: GithubSource = {
  authorized: true,
  list: async () => ({ notModified: true, remaining: 5000 }),
  files: async () => ({ files: [], remaining: 5000 }),
  pulls: async () => ({ notModified: true, remaining: 5000 }),
  pullFiles: async () => ({ files: [], remaining: 5000, requests: 1 }),
  runs: async () => (asked.push('runs'), runs),
  jobs: async (_r, id) => (asked.push(`jobs:${id}`), jobsOf[id] ?? []),
  checks: async (_r, sha) => (asked.push(`checks:${sha.slice(0, 4)}`), prChecks),
  reviews: async (_r, n) => (asked.push(`reviews:${n}`), { reviews: prReviews, requested: ['kai'] }),
};

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
  // one open pull request touching a project, at head dddd
  await db.query(
    `INSERT INTO command.code_pulls (repo, number, title, state, draft, login, head, base, head_sha, created_at, updated_at, url, files, contracts, projects, touches, files_sha)
     VALUES ($1, 812, 'List bands', 'open', false, 'kai', 'ui/list-bands', 'dev', $2, $3, $4, 'https://github.com/r/pull/812', '{apps/command/x.css}', '{}', '{command}', true, $2)`,
    [cfg.repo, 'd'.repeat(40), at('27T09:00:00'), at('27T16:00:00')],
  );
});

describe('a pull request’s checks, as one state', () => {
  test('failing beats running beats passing; none read is null, none at all is none', () => {
    expect(checkState(null)).toBeNull();
    expect(checkState([])).toMatchObject({ state: 'none', total: 0 });
    expect(checkState([{ name: 'a', status: 'completed', conclusion: 'success', url: '' }])).toMatchObject({ state: 'pass', passed: 1, total: 1 });
    expect(checkState(prChecks)).toMatchObject({ state: 'run', passed: 1, total: 2 });
    expect(checkState([...prChecks, { name: 'b', status: 'completed', conclusion: 'failure', url: '' }])).toMatchObject({ state: 'fail', failing: ['b'] });
  });
});

describe('the poller', () => {
  test('reads the runs, each complete run’s jobs once, the pull request’s checks and its reviews', async () => {
    asked.length = 0;
    const r = await pollChecks(db, src, cfg, { now: NOW });
    expect(r).toEqual({ runs: 3, jobsRead: 2, checksRead: 1, reviewsRead: 1 });
    expect(asked).toEqual(['runs', 'jobs:2', 'jobs:1', 'checks:dddd', 'reviews:812']);
  });

  test('again: no jobs re-read; the checks again only because one is still running; the reviews not, nothing changed', async () => {
    asked.length = 0;
    prChecks = prChecks.map((x) => ({ ...x, status: 'completed', conclusion: 'success' }));
    const r = await pollChecks(db, src, cfg, { now: NOW });
    expect(r).toEqual({ runs: 3, jobsRead: 0, checksRead: 1, reviewsRead: 0 });
    asked.length = 0;
    expect(await pollChecks(db, src, cfg, { now: NOW })).toEqual({ runs: 3, jobsRead: 0, checksRead: 0, reviewsRead: 0 });
  });

  test('a source without the Actions reads skips it', async () => {
    const { runs: _r, jobs: _j, checks: _c, reviews: _v, ...old } = src;
    expect(await pollChecks(db, old as GithubSource, cfg, { now: NOW })).toEqual({ runs: 0, jobsRead: 0, checksRead: 0, reviewsRead: 0 });
  });
});

describe('what Build reads', () => {
  test('each job’s runs, passes and median time on dev, skipped ones left out; the branch’s runs and the one still going', async () => {
    const b = await branchChecks(db, cfg, NOW);
    expect(b).toMatchObject({ branch: 'dev', runs: 2, passed: 1, running: 1, last: { status: 'in_progress' } });
    const apps = b.jobs.find((j) => j.name.startsWith('Apps'))!;
    const contracts = b.jobs.find((j) => j.name.startsWith('Contracts'))!;
    expect([apps.runs, apps.passed, apps.last.conclusion]).toEqual([2, 1, 'failure']);
    // 4 and 6 minutes: the median of two is the later
    expect(apps.medianMs).toBe(6 * 60_000);
    expect([contracts.runs, contracts.passed, contracts.medianMs]).toEqual([1, 1, 5 * 60_000]);
  });

  test('the Code payload: the pull request’s checks and reviews, names only above Totals', async () => {
    const shown = await codeActivity(db, cfg, NOW, true);
    const p = shown.pulls.find((x) => x.number === 812)!;
    expect(p.checks).toMatchObject({ state: 'pass', passed: 2, total: 2 });
    expect(p.reviews).toEqual([{ login: 'dana', state: 'APPROVED', at: ms('27T15:00:00') }]);
    expect(p.requested).toEqual(['kai']);
    expect(shown.checks.runs).toBe(2);
    const totals = await codeActivity(db, cfg, NOW, false);
    const q = totals.pulls.find((x) => x.number === 812)!;
    expect([q.reviews![0].login, q.requested]).toEqual(['', ['']]);
  });
});
