import { describe, expect, test } from 'bun:test';
import { buildInfo, deploysReader, envOf } from './deploys.js';

/*
 * Build's "Where it runs": Vercel's deploys by branch (a stand-in Vercel here) and the API's Railway
 * environments from their /health.
 */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const dep = (ref: string, readyState: string, created: number, extra: Record<string, string> = {}) => ({ readyState, created, meta: { githubCommitRef: ref, githubCommitSha: `${ref}-sha-0000000`, ...extra } });
const asked: URL[] = [];
const fake = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  asked.push(u);
  if (u.hostname === 'api.vercel.com') {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer tok') return json({ error: 'no' }, 403);
    const p = u.searchParams.get('projectId');
    const branch = u.searchParams.get('branch');
    if (p === 'clear-pay') return json({ error: 'gone' }, 404);
    // newest first; an ignored build is CANCELED and doesn't count
    const all = [dep('dev', 'CANCELED', 9), dep('feat/x', 'BUILDING', 8, { githubPrId: '871' }), dep('dev', 'READY', 7), dep('main', 'ERROR', 6), dep('main', 'READY', 5)];
    return json({ deployments: branch ? all.filter((d) => d.meta.githubCommitRef === branch) : all });
  }
  if (u.pathname === '/health') {
    const dev = u.hostname.startsWith('dev');
    return json({ status: 'ok', build: { commit: dev ? 'abc1234ffff' : 'def5678ffff', branch: dev ? 'dev' : 'main', environment: dev ? 'dev' : 'production', startedAt: '2026-11-04T10:00:00.000Z' } });
  }
  return json({}, 404);
}) as unknown as typeof fetch;
const ENV = { VERCEL_TOKEN: 'tok', VERCEL_TEAM_ID: 'team_1', COMMAND_API_URLS: 'https://dev.api.test,https://prod.api.test/' };

describe('where each app runs', () => {
  test('a branch’s environment: dev is the testnet demo, main production, the rest previews', () => {
    expect(['dev', 'main', 'feat/x', null].map(envOf)).toEqual(['test', 'prod', 'preview', 'preview']);
  });

  test('Vercel’s latest deploy on each branch, skipped builds passed over; the API from each /health', async () => {
    const d = await deploysReader(ENV, fake).read();
    expect(d.vercelOff).toBeNull();
    expect(d.projects.app).toEqual({
      preview: { state: 'building', ref: 'feat/x', sha: 'feat/x-sha-0000000', at: 8, pr: 871 },
      test: { state: 'ready', ref: 'dev', sha: 'dev-sha-0000000', at: 7, pr: null },
      prod: { state: 'error', ref: 'main', sha: 'main-sha-0000000', at: 6, pr: null },
    });
    // a project Vercel won't answer for has no cells; the others still come
    expect(d.projects.pay).toBeUndefined();
    expect(Object.keys(d.projects).sort()).toEqual(['app', 'cc', 'merchant', 'rewards', 'sdk']);
    expect(d.projects.sdk).toEqual({
      test: { state: 'ready', ref: 'dev', sha: 'abc1234ffff', at: Date.parse('2026-11-04T10:00:00Z'), pr: null },
      prod: { state: 'ready', ref: 'main', sha: 'def5678ffff', at: Date.parse('2026-11-04T10:00:00Z'), pr: null },
    });
    const v = asked.find((u) => u.hostname === 'api.vercel.com')!;
    expect(v.searchParams.get('teamId')).toBe('team_1');
  });

  test('without the Vercel token, the API row only, and why', async () => {
    const d = await deploysReader({ COMMAND_API_URLS: 'https://dev.api.test' }, fake).read();
    expect(d.vercelOff).toBe('VERCEL_TOKEN isn’t set');
    expect(Object.keys(d.projects)).toEqual(['sdk']);
  });

  test('kept two minutes, then read again', async () => {
    let t = 0;
    const r = deploysReader(ENV, fake, () => t);
    asked.length = 0;
    await r.read();
    const n = asked.length;
    t = 60_000;
    await r.read();
    expect(asked.length).toBe(n);
    t = 121_000;
    await r.read();
    expect(asked.length).toBe(2 * n);
  });

  test('the API says what Railway built it from, nulls off Railway', () => {
    expect(buildInfo({ RAILWAY_GIT_COMMIT_SHA: 'abc', RAILWAY_GIT_BRANCH: 'dev', RAILWAY_ENVIRONMENT_NAME: 'dev' })).toMatchObject({ commit: 'abc', branch: 'dev', environment: 'dev' });
    expect(buildInfo({})).toMatchObject({ commit: null, branch: null, environment: null });
  });
});
