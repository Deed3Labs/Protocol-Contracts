import type { Queryable } from '../../db/db.js';
import type { Release } from './onchain.js';

/*
 * Changes from GitHub (docs/command-center-plan.md, Phase 5c): the commits on `dev`, polled, and
 * those that touch the contracts turned into Contracts' changes. A contract's commits since its last
 * release are a change in flight; the commits before each release are what that release shipped.
 *
 * The Code tab reads more: every commit on each watched branch (`dev` and `main`) and every pull
 * request, open and lately merged or closed, each tagged with the projects its files are in (the
 * contracts, the apps, the API and SDK, the Command Center: PROJECTS).
 *
 * Cheap by design. The list is asked for with the ETag of the last answer, and an unchanged answer
 * (304) costs nothing against the token's rate limit. Each new commit's files are asked for once.
 * The repository is public, so it works without a token too, at 60 requests an hour: the first
 * backfill then takes a few runs, a commit's files being filled by whichever run has the budget.
 */

export interface CodeConfig {
  repo: string;
  /** The branch the release lanes read (Changes): `dev`. */
  branch: string;
  /** Every branch whose commits are polled, the release branch first. */
  branches: string[];
  /** The contracts' folder: a commit's contracts are its Solidity files under it. */
  path: string;
  /** The folder whose commits are listed: the whole repo when empty. */
  watch: string;
}
export const codeConfig = (env: Record<string, string | undefined> = process.env): CodeConfig => {
  const branch = env.COMMAND_GITHUB_BRANCH || 'dev';
  const more = (env.COMMAND_GITHUB_BRANCHES || 'dev,main').split(',').map((b) => b.trim()).filter(Boolean);
  return {
    repo: env.COMMAND_GITHUB_REPO || 'Deed3Labs/Protocol-Contracts',
    branch,
    branches: [...new Set([branch, ...more])],
    path: (env.COMMAND_GITHUB_PATH || 'contracts').replace(/^\/+|\/+$/g, ''),
    watch: (env.COMMAND_GITHUB_WATCH || '').replace(/^\/+|\/+$/g, ''),
  };
};

/** The monorepo's projects, by the folders that are theirs; a commit or PR is in each project a file of it is under. */
export const PROJECTS = [
  { id: 'proto', name: 'Protocol', tiny: 'Contracts', what: 'Smart contracts', lang: 'Solidity · Hardhat', paths: ['contracts'] },
  { id: 'app', name: 'Member app', tiny: 'App', what: 'Member app', lang: 'TypeScript · PWA', paths: ['apps/member', 'packages/member-kit'] },
  { id: 'merchant', name: 'Merchant app', tiny: 'Merchant', what: 'Merchant app', lang: 'TypeScript · tablet PWA', paths: ['apps/merchant', 'packages/merchant-contracts'] },
  {
    id: 'sdk',
    name: 'API and SDK',
    tiny: 'SDK',
    what: 'API and SDK',
    lang: 'TypeScript · Railway',
    paths: ['apps/api', 'packages/clear-js', 'packages/clear-node', 'packages/clear-mcp', 'packages/contracts-sdk', 'packages/public-api-contracts', 'packages/domain', 'packages/tokens'],
  },
  { id: 'pay', name: 'Pay with Clear', tiny: 'Pay', what: 'Pay with Clear', lang: 'TypeScript', paths: ['apps/pay', 'packages/pay-docs'] },
  { id: 'rewards', name: 'Rewards', tiny: 'Rewards', what: 'Rewards app', lang: 'TypeScript', paths: ['apps/rewards'] },
  {
    id: 'cc',
    name: 'Command Center',
    tiny: 'CC',
    what: 'This app',
    lang: 'TypeScript · Vercel',
    paths: ['apps/command', 'packages/command-types', 'scripts/command', 'design/command-center-ui', 'docs/ui-redesign', 'docs/ui-redesign-plan.md', 'docs/command-center-plan.md', 'docs/command-reference'],
  },
] as const;

/** The projects a commit's or PR's files are in, the one with the most files first (the one it's shown under), ties in PROJECTS' order. */
export function projectsOf(files: string[]): string[] {
  const n = PROJECTS.map((p) => files.filter((f) => p.paths.some((d) => f === d || f.startsWith(`${d}/`))).length);
  return PROJECTS.map((p, i) => ({ id: p.id, n: n[i], i }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.id);
}

/** How far back the first listing of a branch reaches: the commits before it aren't read. */
const HISTORY_MS = 90 * 24 * 3600e3;

export interface ListedCommit {
  sha: string;
  committedAt: string;
  author: string;
  email: string | null;
  login: string | null;
  message: string;
  url: string;
}
export type ListAnswer = { notModified: true; remaining: number | null } | { notModified: false; etag: string | null; commits: ListedCommit[]; more: boolean; remaining: number | null };

export interface ListedPull {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  login: string | null;
  head: string;
  base: string;
  headSha: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  url: string;
}
export type PullsAnswer = { notModified: true; remaining: number | null } | { notModified: false; etag: string | null; pulls: ListedPull[]; more: boolean; remaining: number | null };

/** A workflow run on a branch, as GitHub Actions lists it. */
export interface ListedRun {
  id: number;
  workflow: string;
  branch: string;
  sha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}
/** One job of a run: its name, how it ended, and when it ran (ms). */
export interface RunJob {
  name: string;
  conclusion: string | null;
  startedAt: number | null;
  completedAt: number | null;
}
/** A check run at a commit (a job of a workflow, or another app's check). */
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}
/** A review on a pull request: who, what they said (APPROVED, CHANGES_REQUESTED, COMMENTED…), when (ms). */
export interface PullReview {
  login: string;
  state: string;
  at: number;
}

export interface GithubSource {
  /** One page of the branch's commits (touching the watched folder, if one), newest first, since a time if given. */
  list(c: CodeConfig, since: string | null, page: number, etag: string | null): Promise<ListAnswer>;
  /** The files one commit changed. */
  files(repo: string, sha: string): Promise<{ files: string[]; remaining: number | null }>;
  /** One page of the repository's pull requests, every state, the most lately updated first. */
  pulls(repo: string, page: number, etag: string | null): Promise<PullsAnswer>;
  /** The files one pull request changes, and how many requests reading them took (100 a page). */
  pullFiles(repo: string, number: number): Promise<{ files: string[]; remaining: number | null; requests: number }>;
  /** The workflow runs for the branch since a day (YYYY-MM-DD), newest first, up to 300: pull requests into it, and pushes to it. */
  runs?(repo: string, branch: string, since: string): Promise<ListedRun[]>;
  /** A run's jobs. */
  jobs?(repo: string, runId: number): Promise<RunJob[]>;
  /** The check runs at a commit. */
  checks?(repo: string, sha: string): Promise<CheckRun[]>;
  /** A pull request's reviews, and who's still asked to review it. */
  reviews?(repo: string, number: number): Promise<{ reviews: PullReview[]; requested: string[] }>;
  /** Whether it asks with a token (5,000 an hour) or without (60). */
  authorized: boolean;
}

export function liveGithub(token = process.env.GITHUB_TOKEN?.trim() || '', f: typeof fetch = fetch): GithubSource {
  const headers = (etag?: string | null): Record<string, string> => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'clear-command-center',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(etag ? { 'If-None-Match': etag } : {}),
  });
  const remaining = (r: Response) => (r.headers.get('x-ratelimit-remaining') == null ? null : Number(r.headers.get('x-ratelimit-remaining')));
  const fail = async (r: Response) => {
    const body = await r.text().catch(() => '');
    const msg = (() => {
      try {
        return JSON.parse(body).message as string;
      } catch {
        return body.slice(0, 200);
      }
    })();
    return new Error(`GitHub ${r.status}${remaining(r) === 0 ? ' (rate limit spent)' : ''}: ${msg}`);
  };
  return {
    authorized: !!token,
    async list(c, since, page, etag) {
      const q = new URLSearchParams({ sha: c.branch, ...(c.watch ? { path: c.watch } : {}), per_page: '100', page: String(page), ...(since ? { since } : {}) });
      const r = await f(`https://api.github.com/repos/${c.repo}/commits?${q}`, { headers: headers(etag) });
      if (r.status === 304) return { notModified: true, remaining: remaining(r) };
      if (!r.ok) throw await fail(r);
      const list = (await r.json()) as any[];
      return {
        notModified: false,
        etag: r.headers.get('etag'),
        more: /rel="next"/.test(r.headers.get('link') ?? ''),
        remaining: remaining(r),
        commits: list.map((x) => ({
          sha: String(x.sha).toLowerCase(),
          committedAt: x.commit?.committer?.date ?? x.commit?.author?.date,
          author: x.commit?.author?.name ?? x.author?.login ?? 'unknown',
          email: x.commit?.author?.email ?? null,
          login: x.author?.login ?? null,
          message: String(x.commit?.message ?? ''),
          url: x.html_url,
        })),
      };
    },
    async files(repo, sha) {
      const r = await f(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers: headers() });
      if (!r.ok) throw await fail(r);
      const j = (await r.json()) as any;
      return { files: (j.files ?? []).map((x: any) => String(x.filename)), remaining: remaining(r) };
    },
    async pulls(repo, page, etag) {
      const q = new URLSearchParams({ state: 'all', sort: 'updated', direction: 'desc', per_page: '100', page: String(page) });
      const r = await f(`https://api.github.com/repos/${repo}/pulls?${q}`, { headers: headers(etag) });
      if (r.status === 304) return { notModified: true, remaining: remaining(r) };
      if (!r.ok) throw await fail(r);
      const list = (await r.json()) as any[];
      return {
        notModified: false,
        etag: r.headers.get('etag'),
        more: /rel="next"/.test(r.headers.get('link') ?? ''),
        remaining: remaining(r),
        pulls: list.map((x) => ({
          number: Number(x.number),
          title: String(x.title ?? ''),
          state: x.merged_at ? 'merged' : x.state === 'open' ? 'open' : 'closed',
          draft: !!x.draft,
          login: x.user?.login ?? null,
          head: String(x.head?.ref ?? ''),
          base: String(x.base?.ref ?? ''),
          headSha: x.head?.sha ?? null,
          createdAt: x.created_at,
          updatedAt: x.updated_at,
          mergedAt: x.merged_at ?? null,
          closedAt: x.closed_at ?? null,
          url: x.html_url,
        })),
      };
    },
    async runs(repo, branch, since) {
      const out: ListedRun[] = [];
      for (let page = 1; page <= 3; page++) {
        // CI runs on pull requests into the branch (dev), not on pushes to it: a run is the branch's when it
        // was for a pull request into it, or a push to it
        const q = new URLSearchParams({ per_page: '100', page: String(page), created: `>=${since}` });
        const r = await f(`https://api.github.com/repos/${repo}/actions/runs?${q}`, { headers: headers() });
        if (!r.ok) throw await fail(r);
        const j = (await r.json()) as any;
        for (const x of j.workflow_runs ?? []) {
          const into = x.event === 'pull_request' ? x.pull_requests?.[0]?.base?.ref : x.head_branch;
          if (into !== branch) continue;
          out.push({ id: Number(x.id), workflow: String(x.name ?? x.workflow_id), branch, sha: String(x.head_sha).toLowerCase(), status: String(x.status), conclusion: x.conclusion ?? null, createdAt: x.created_at, updatedAt: x.updated_at, url: x.html_url });
        }
        if (!/rel="next"/.test(r.headers.get('link') ?? '')) break;
      }
      return out;
    },
    async jobs(repo, runId) {
      const r = await f(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, { headers: headers() });
      if (!r.ok) throw await fail(r);
      const ms = (d: string | null) => (d ? new Date(d).getTime() : null);
      return (((await r.json()) as any).jobs ?? []).map((x: any) => ({ name: String(x.name), conclusion: x.conclusion ?? null, startedAt: ms(x.started_at), completedAt: ms(x.completed_at) }));
    },
    async checks(repo, sha) {
      const r = await f(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`, { headers: headers() });
      if (!r.ok) throw await fail(r);
      return (((await r.json()) as any).check_runs ?? []).map((x: any) => ({ name: String(x.name), status: String(x.status), conclusion: x.conclusion ?? null, url: String(x.html_url ?? '') }));
    },
    async reviews(repo, number) {
      const [a, b] = await Promise.all([
        f(`https://api.github.com/repos/${repo}/pulls/${number}/reviews?per_page=100`, { headers: headers() }),
        f(`https://api.github.com/repos/${repo}/pulls/${number}/requested_reviewers`, { headers: headers() }),
      ]);
      if (!a.ok) throw await fail(a);
      if (!b.ok) throw await fail(b);
      const reviews = ((await a.json()) as any[]).filter((x) => x.submitted_at && x.user?.login).map((x) => ({ login: String(x.user.login), state: String(x.state), at: new Date(x.submitted_at).getTime() }));
      const requested = (((await b.json()) as any).users ?? []).map((u: any) => String(u.login));
      return { reviews, requested };
    },
    async pullFiles(repo, number) {
      // GitHub lists at most 3,000 files a PR, 100 a page
      const files: string[] = [];
      let left: number | null = null,
        requests = 0;
      for (let page = 1; page <= 30; page++) {
        const r = await f(`https://api.github.com/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`, { headers: headers() });
        requests++;
        if (!r.ok) throw await fail(r);
        left = remaining(r);
        files.push(...((await r.json()) as any[]).map((x) => String(x.filename)));
        if (!/rel="next"/.test(r.headers.get('link') ?? '') || (left != null && left < 5)) break;
      }
      return { files, remaining: left, requests };
    },
  };
}

/** The contracts a commit's files are: each Solidity file under the path, by name, leaving out mocks, tests and interfaces. */
export function contractsOf(files: string[], path: string): string[] {
  const out = new Set<string>();
  for (const f of files) {
    if (!f.startsWith(`${path}/`) || !f.endsWith('.sol') || /\/(mocks?|tests?|interfaces?)\//i.test(f)) continue;
    out.add(f.slice(f.lastIndexOf('/') + 1, -'.sol'.length));
  }
  return [...out].sort();
}

/** A squash merge says its PR at the end of its first line: "… (#759)". */
const prOf = (message: string) => {
  const m = /\(#(\d+)\)\s*$/.exec(message.split('\n')[0]);
  return m ? Number(m[1]) : null;
};

/** A week of overlap, so a commit that landed late with an older time (a merge of an old branch) is still seen. */
const OVERLAP_MS = 7 * 24 * 3600e3;

export interface PollResult {
  listed: number;
  added: number;
  filled: number;
  /** Every branch's list answered unchanged. */
  notModified: boolean;
  /** Commits still waiting for their files. */
  waiting: number;
}

/** One branch's list: the commits since the newest one held on it, a new one inserted, one already held (from another branch) marked as on this one too. */
async function listBranch(db: Queryable, src: GithubSource, c: CodeConfig, maxPages: number, now: number) {
  const { rows: cur } = await db.query<{ since: Date | null; etag: string | null }>('SELECT since, etag FROM command.code_cursor WHERE repo = $1 AND branch = $2 AND path = $3', [c.repo, c.branch, c.watch]);
  // the first time, the last 90 days; after, since the newest commit held there
  const since = cur.length ? (cur[0].since ? new Date(cur[0].since).toISOString() : null) : new Date(now - HISTORY_MS).toISOString();
  let etag = cur[0]?.etag ?? null,
    listed = 0,
    added = 0,
    notModified = false;
  for (let page = 1; page <= maxPages; page++) {
    const r = await src.list(c, since, page, page === 1 ? etag : null);
    if (r.notModified) {
      notModified = true;
      break;
    }
    if (page === 1) etag = r.etag;
    listed += r.commits.length;
    for (const x of r.commits) {
      const ins = await db.query(
        `INSERT INTO command.code_commits (repo, sha, branch, branches, committed_at, author, author_email, login, message, url, pr)
         VALUES ($1, $2, $3, ARRAY[$3]::text[], $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (repo, sha) DO NOTHING RETURNING 1`,
        [c.repo, x.sha, c.branch, x.committedAt, x.author, x.email, x.login, x.message, x.url, prOf(x.message)],
      );
      if (ins.rows.length) added++;
      else await db.query('UPDATE command.code_commits SET branches = array_append(branches, $3) WHERE repo = $1 AND sha = $2 AND NOT ($3 = ANY(branches))', [c.repo, x.sha, c.branch]);
    }
    if (!r.more) break;
  }
  return { since, etag, listed, added, notModified };
}

/**
 * One run: on each watched branch, the commits since the newest one held there (all of them the
 * first time); then the files of those that don't have them, as far as the budget goes. A commit
 * on two branches is one row, its files asked for once.
 */
export async function pollOnce(db: Queryable, src: GithubSource, c: CodeConfig, o: { maxPages?: number; filesBudget?: number; now?: number } = {}): Promise<PollResult> {
  const maxPages = o.maxPages ?? 10;
  const budget = o.filesBudget ?? (src.authorized ? 200 : 20);
  const lists: Array<{ branch: string } & Awaited<ReturnType<typeof listBranch>>> = [];
  for (const branch of c.branches) lists.push({ branch, ...(await listBranch(db, src, { ...c, branch }, maxPages, o.now ?? Date.now())) });
  // the projects of commits whose files were read before projects were (migration 0065)
  const { rows: old } = await db.query<{ sha: string; files: string[] }>('SELECT sha, files FROM command.code_commits WHERE repo = $1 AND files IS NOT NULL AND projects IS NULL', [c.repo]);
  for (const r of old) await db.query('UPDATE command.code_commits SET projects = $3 WHERE repo = $1 AND sha = $2', [c.repo, r.sha, projectsOf(r.files)]);

  // the files of each commit not yet asked about, while the rate limit lasts: the release branch's first, oldest first
  const { rows: todo } = await db.query<{ sha: string }>('SELECT sha FROM command.code_commits WHERE repo = $1 AND files IS NULL ORDER BY ($2 = ANY(branches)) DESC, committed_at LIMIT $3', [
    c.repo,
    c.branch,
    budget,
  ]);
  let filled = 0;
  for (const { sha } of todo) {
    const r = await src.files(c.repo, sha);
    await db.query('UPDATE command.code_commits SET files = $3, contracts = $4, projects = $5 WHERE repo = $1 AND sha = $2', [c.repo, sha, r.files, contractsOf(r.files, c.path), projectsOf(r.files)]);
    filled++;
    if (r.remaining != null && r.remaining < 5) break;
  }

  // each branch's next ask starts a week before its newest commit; the ETag only holds for the same ask
  for (const l of lists) {
    const { rows: nw } = await db.query<{ newest: Date | null }>('SELECT max(committed_at) AS newest FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches)', [c.repo, l.branch]);
    const next = nw[0].newest ? new Date(new Date(nw[0].newest).getTime() - OVERLAP_MS).toISOString() : null;
    await db.query(
      `INSERT INTO command.code_cursor (repo, branch, path, since, etag, ran_at, error) VALUES ($1, $2, $3, $4, $5, now(), NULL)
       ON CONFLICT (repo, branch, path) DO UPDATE SET since = $4, etag = $5, ran_at = now(), error = NULL`,
      [c.repo, l.branch, c.watch, next, next === l.since ? l.etag : null],
    );
  }
  const { rows: w } = await db.query<{ waiting: number }>('SELECT count(*)::int AS waiting FROM command.code_commits WHERE repo = $1 AND files IS NULL', [c.repo]);
  return {
    listed: lists.reduce((a, l) => a + l.listed, 0),
    added: lists.reduce((a, l) => a + l.added, 0),
    filled,
    notModified: lists.every((l) => l.notModified),
    waiting: w[0].waiting,
  };
}

/** A run that failed: its error on every watched branch's cursor. */
export async function recordCodeError(db: Queryable, c: CodeConfig, error: unknown) {
  for (const branch of c.branches)
    await db.query(
      `INSERT INTO command.code_cursor (repo, branch, path, ran_at, error) VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (repo, branch, path) DO UPDATE SET ran_at = now(), error = $4`,
      [c.repo, branch, c.watch, String((error as Error)?.message ?? error).slice(0, 500)],
    );
}

// ── Pull requests ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 3600e3;
/** How far back the Code tab looks: PRs merged or closed, commits and contributors, in the last 30 days. */
export const CODE_WINDOW_MS = 30 * DAY_MS;

export interface PullPollResult {
  listed: number;
  /** PRs whose files were read this run. */
  read: number;
  notModified: boolean;
  /** PRs in the window still waiting for their files. */
  waiting: number;
}

/**
 * The pull requests: the list, most lately updated first, asked for with the last answer's ETag
 * and read until a PR older than the window; then the files of each new PR, and of each whose head
 * moved since its files were read, as far as the budget goes. A PR that changes nothing in a project
 * (only docs, say) is marked so and never shown.
 */
export async function pollPulls(db: Queryable, src: GithubSource, c: CodeConfig, o: { maxPages?: number; filesBudget?: number; now?: number } = {}): Promise<PullPollResult> {
  const maxPages = o.maxPages ?? 5;
  const budget = o.filesBudget ?? (src.authorized ? 100 : 10);
  const cutoff = new Date((o.now ?? Date.now()) - CODE_WINDOW_MS).toISOString();
  const { rows: cur } = await db.query<{ etag: string | null }>('SELECT etag FROM command.code_pull_cursor WHERE repo = $1', [c.repo]);
  let etag = cur[0]?.etag ?? null,
    listed = 0,
    notModified = false;
  for (let page = 1; page <= maxPages; page++) {
    const r = await src.pulls(c.repo, page, page === 1 ? etag : null);
    if (r.notModified) {
      notModified = true;
      break;
    }
    if (page === 1) etag = r.etag;
    let older = false;
    for (const x of r.pulls) {
      if (Date.parse(x.updatedAt) < Date.parse(cutoff)) {
        older = true;
        break;
      }
      listed++;
      await db.query(
        `INSERT INTO command.code_pulls (repo, number, title, state, draft, login, head, base, head_sha, created_at, updated_at, merged_at, closed_at, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (repo, number) DO UPDATE SET title = $3, state = $4, draft = $5, login = $6, head = $7, base = $8, head_sha = $9,
           updated_at = $11, merged_at = $12, closed_at = $13, url = $14`,
        [c.repo, x.number, x.title, x.state, x.draft, x.login, x.head, x.base, x.headSha, x.createdAt, x.updatedAt, x.mergedAt, x.closedAt, x.url],
      );
    }
    if (older || !r.more) break;
  }

  const todo = `repo = $1 AND updated_at >= $2 AND (touches IS NULL OR head_sha IS DISTINCT FROM files_sha)`;
  const { rows } = await db.query<{ number: number; head_sha: string | null }>(`SELECT number, head_sha FROM command.code_pulls WHERE ${todo} ORDER BY updated_at DESC`, [c.repo, cutoff]);
  let used = 0,
    read = 0;
  for (const p of rows) {
    if (used >= budget) break;
    const r = await src.pullFiles(c.repo, p.number);
    used += Math.max(1, r.requests);
    const projects = projectsOf(r.files);
    const touches = projects.length > 0;
    // a PR that touches no project keeps only that answer, not its files
    await db.query('UPDATE command.code_pulls SET files = $3, contracts = $4, touches = $5, files_sha = $6, projects = $7 WHERE repo = $1 AND number = $2', [
      c.repo,
      p.number,
      touches ? r.files : [],
      touches ? contractsOf(r.files, c.path) : [],
      touches,
      p.head_sha,
      projects,
    ]);
    read++;
    if (r.remaining != null && r.remaining < 5) break;
  }

  await db.query(
    `INSERT INTO command.code_pull_cursor (repo, etag, ran_at, error) VALUES ($1, $2, now(), NULL)
     ON CONFLICT (repo) DO UPDATE SET etag = $2, ran_at = now(), error = NULL`,
    [c.repo, etag],
  );
  const { rows: w } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.code_pulls WHERE ${todo}`, [c.repo, cutoff]);
  return { listed, read, notModified, waiting: w[0].n };
}

export async function recordPullError(db: Queryable, c: CodeConfig, error: unknown) {
  await db.query(
    `INSERT INTO command.code_pull_cursor (repo, ran_at, error) VALUES ($1, now(), $2)
     ON CONFLICT (repo) DO UPDATE SET ran_at = now(), error = $2`,
    [c.repo, String((error as Error)?.message ?? error).slice(0, 500)],
  );
}

/** Where the poller is: how many commits it holds, how many still want their files, its last error; each branch's, and the pull requests'. */
export interface ChecksPollResult {
  runs: number;
  jobsRead: number;
  checksRead: number;
  reviewsRead: number;
}

/**
 * GitHub Actions for the watched branch (pull requests into it, as CI runs), and each pull request’s checks and reviews (migration 0070).
 * The last 30 days' runs are upserted every time (a run's status moves until it completes); a complete
 * run's jobs are read once. A pull request's check runs are read again when its head moves or one is
 * still running; its reviews when it's been updated since they were read. Within a budget a run.
 */
export async function pollChecks(db: Queryable, src: GithubSource, c: CodeConfig, o: { budget?: number; now?: number } = {}): Promise<ChecksPollResult> {
  const out: ChecksPollResult = { runs: 0, jobsRead: 0, checksRead: 0, reviewsRead: 0 };
  if (!src.runs || !src.jobs || !src.checks || !src.reviews) return out;
  const now = o.now ?? Date.now();
  let budget = o.budget ?? 40;
  const cutoff = new Date(now - CODE_WINDOW_MS);
  const runs = await src.runs(c.repo, c.branch, cutoff.toISOString().slice(0, 10));
  for (const r of runs) {
    await db.query(
      `INSERT INTO command.code_runs (repo, id, workflow, branch, sha, status, conclusion, created_at, updated_at, url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (repo, id) DO UPDATE SET status = EXCLUDED.status, conclusion = EXCLUDED.conclusion, updated_at = EXCLUDED.updated_at`,
      [c.repo, r.id, r.workflow, r.branch, r.sha, r.status, r.conclusion, r.createdAt, r.updatedAt, r.url],
    );
  }
  out.runs = runs.length;
  const { rows: needJobs } = await db.query<{ id: string }>(
    `SELECT id FROM command.code_runs WHERE repo = $1 AND status = 'completed' AND jobs IS NULL AND created_at >= $2 ORDER BY created_at DESC`,
    [c.repo, cutoff],
  );
  for (const r of needJobs) {
    if (budget <= 0) break;
    await db.query('UPDATE command.code_runs SET jobs = $3 WHERE repo = $1 AND id = $2', [c.repo, r.id, JSON.stringify(await src.jobs(c.repo, Number(r.id)))]);
    budget--;
    out.jobsRead++;
  }
  // the pull requests Build shows: open, or merged or closed in the window
  const { rows: pulls } = await db.query<{ number: number; head_sha: string | null; checks: CheckRun[] | null; checks_sha: string | null; updated_at: Date; reviews_at: Date | null }>(
    `SELECT number, head_sha, checks, checks_sha, updated_at, reviews_at FROM command.code_pulls
      WHERE repo = $1 AND touches AND (state = 'open' OR coalesce(merged_at, closed_at) >= $2) ORDER BY updated_at DESC`,
    [c.repo, cutoff],
  );
  for (const p of pulls) {
    if (budget <= 0) break;
    const running = (p.checks ?? []).some((x) => x.status !== 'completed');
    if (p.head_sha && (p.checks_sha !== p.head_sha || running)) {
      await db.query('UPDATE command.code_pulls SET checks = $3, checks_sha = $4 WHERE repo = $1 AND number = $2', [c.repo, p.number, JSON.stringify(await src.checks(c.repo, p.head_sha)), p.head_sha]);
      budget--;
      out.checksRead++;
    }
    if (budget > 0 && (!p.reviews_at || p.reviews_at < p.updated_at)) {
      const r = await src.reviews(c.repo, p.number);
      await db.query('UPDATE command.code_pulls SET reviews = $3, requested = $4, reviews_at = $5 WHERE repo = $1 AND number = $2', [c.repo, p.number, JSON.stringify(r.reviews), r.requested, new Date(now)]);
      budget -= 2;
      out.reviewsRead++;
    }
  }
  return out;
}

export async function codeStatus(db: Queryable, c: CodeConfig = codeConfig()) {
  const { rows } = await db.query<any>(
    `SELECT (SELECT count(*)::int FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches)) AS commits,
            (SELECT count(*)::int FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches) AND files IS NULL) AS waiting,
            (SELECT max(committed_at) FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches)) AS newest,
            k.ran_at, k.error
       FROM (SELECT 1) one LEFT JOIN command.code_cursor k ON k.repo = $1 AND k.branch = $2 AND k.path = $3`,
    [c.repo, c.branch, c.watch],
  );
  const r = rows[0];
  const byBranch = [];
  for (const branch of c.branches) {
    const { rows: b } = await db.query<any>(
      `SELECT (SELECT count(*)::int FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches)) AS commits, k.ran_at, k.error
         FROM (SELECT 1) one LEFT JOIN command.code_cursor k ON k.repo = $1 AND k.branch = $2 AND k.path = $3`,
      [c.repo, branch, c.watch],
    );
    byBranch.push({ branch, commits: b[0].commits, ranAt: b[0].ran_at, error: b[0].error });
  }
  const { rows: p } = await db.query<any>(
    `SELECT (SELECT count(*)::int FROM command.code_pulls WHERE repo = $1 AND touches) AS pulls,
            (SELECT count(*)::int FROM command.code_pulls WHERE repo = $1 AND touches IS NULL) AS waiting,
            k.ran_at, k.error
       FROM (SELECT 1) one LEFT JOIN command.code_pull_cursor k ON k.repo = $1`,
    [c.repo],
  );
  return {
    ...c,
    commits: r.commits,
    waitingForFiles: r.waiting,
    newest: r.newest,
    ranAt: r.ran_at,
    error: r.error,
    token: !!process.env.GITHUB_TOKEN?.trim(),
    byBranch,
    pulls: { count: p[0].pulls, waitingForFiles: p[0].waiting, ranAt: p[0].ran_at, error: p[0].error },
  };
}

// ── The Code tab ────────────────────────────────────────────────────────────

export interface CodePayload {
  repo: string;
  path: string;
  /** The folder whose commits are listed: '' for the whole repo. */
  watch: string;
  /** The repo's projects (PROJECTS, without their folders' full list): what the commits and PRs are tagged with. */
  projects: Array<{ id: string; name: string; tiny: string; what: string; lang: string; path: string; lastAt: number | null; commits30: number }>;
  /** 'none' at Totals: no author names or logins, contributors only counted. */
  names: 'none' | 'shown';
  /** The newest commits on any watched branch: every one in the window, at least 60, at most 400. */
  commits: Array<{ sha: string; url: string; branches: string[]; author: string; login: string; message: string; at: number; pr: number | null; contracts: string[]; projects: string[] }>;
  /** The PRs touching a project: open, and merged or closed in the window. Newest first (by update). */
  pulls: Array<{
    number: number;
    title: string;
    state: 'open' | 'merged' | 'closed';
    draft: boolean;
    login: string;
    head: string;
    base: string;
    createdAt: number;
    updatedAt: number;
    mergedAt: number | null;
    closedAt: number | null;
    url: string;
    files: number;
    contracts: string[];
    projects: string[];
    /** Its check runs at its head, as one state; null until the poller has read them. */
    checks: ReturnType<typeof checkState>;
    /** Its reviews (logins only above Totals); null until read. */
    reviews: Array<{ login: string; state: string; at: number }> | null;
    /** Who's still asked to review it. */
    requested: string[];
  }>;
  /** GitHub Actions on the watched branch in the window (migration 0070). */
  checks: Awaited<ReturnType<typeof branchChecks>>;
  branches: Array<{ name: string; commits30: number; lastAt: number | null }>;
  /** Who's contributed in the window, by GitHub login (else the commit's name); empty at Totals. */
  /** Everyone in the stored history (commits, and PRs touching a project), with their last 30 days too. */
  contributors: Array<{ who: string; name: string; commits: number; pulls: number; commits30: number; pulls30: number; lastAt: number }>;
  /** How many people contributed in the window: the one figure Totals keeps. */
  people: number;
  poller: { ranAt: number | null; error: string | null; token: boolean; waiting: number; branches: string[] };
}

const msOf = (d: Date | string | null) => (d == null ? null : new Date(d).getTime());

/** A pull request's checks at its head, as one state: failing if any failed, running if any still runs, else passing; none until read. */
export function checkState(runs: CheckRun[] | null) {
  if (!runs) return null;
  const failing = runs.filter((x) => x.status === 'completed' && ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(x.conclusion ?? '')).map((x) => x.name);
  const running = runs.filter((x) => x.status !== 'completed').length;
  const passed = runs.filter((x) => x.status === 'completed' && ['success', 'neutral', 'skipped'].includes(x.conclusion ?? '')).length;
  return { state: !runs.length ? 'none' : failing.length ? 'fail' : running ? 'run' : 'pass', passed, total: runs.length, failing };
}

/**
 * The watched branch's GitHub Actions in the window: each job's runs, how many passed, how long one takes
 * (median), and how its last run ended. Skipped jobs (the changes filter left them out) don't count.
 */
export async function branchChecks(db: Queryable, c: CodeConfig, now: number) {
  const { rows } = await db.query<{ conclusion: string | null; created_at: Date; url: string; jobs: RunJob[] | null; status: string }>(
    'SELECT status, conclusion, created_at, url, jobs FROM command.code_runs WHERE repo = $1 AND branch = $2 AND created_at >= $3 ORDER BY created_at',
    [c.repo, c.branch, new Date(now - CODE_WINDOW_MS)],
  );
  const ok = (x: string | null) => x === 'success';
  const jobs = new Map<string, { runs: number; passed: number; ms: number[]; last: { conclusion: string | null; at: number; url: string } }>();
  for (const r of rows)
    for (const j of r.jobs ?? []) {
      if (j.conclusion === 'skipped' || j.conclusion == null) continue;
      const e = jobs.get(j.name) ?? { runs: 0, passed: 0, ms: [], last: { conclusion: null, at: 0, url: '' } };
      e.runs++;
      if (ok(j.conclusion)) e.passed++;
      if (j.startedAt && j.completedAt && j.completedAt > j.startedAt) e.ms.push(j.completedAt - j.startedAt);
      e.last = { conclusion: j.conclusion, at: new Date(r.created_at).getTime(), url: r.url };
      jobs.set(j.name, e);
    }
  const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const done = rows.filter((r) => r.status === 'completed');
  const last = rows.at(-1);
  return {
    branch: c.branch,
    runs: done.length,
    passed: done.filter((r) => ok(r.conclusion)).length,
    running: rows.filter((r) => r.status !== 'completed').length,
    last: last ? { conclusion: last.conclusion, status: last.status, at: new Date(last.created_at).getTime(), url: last.url } : null,
    jobs: [...jobs].map(([name, e]) => ({ name, runs: e.runs, passed: e.passed, medianMs: median(e.ms), last: e.last })),
  };
}

/** The Code tab's activity: commits, pull requests, branches and contributors. Names only above Totals. */
export async function codeActivity(db: Queryable, c: CodeConfig, now: number, names: boolean): Promise<CodePayload> {
  const cutoff = new Date(now - CODE_WINDOW_MS).toISOString();
  const { rows: cm } = await db.query<any>(
    `SELECT * FROM (SELECT sha, branches, author, login, message, committed_at, url, pr, contracts, projects,
              row_number() OVER (ORDER BY committed_at DESC, sha) AS n
         FROM command.code_commits WHERE repo = $1 AND branches && $2::text[]) x
      WHERE n <= 60 OR (committed_at >= $3 AND n <= 400) ORDER BY n`,
    [c.repo, c.branches, cutoff],
  );
  const { rows: pl } = await db.query<any>(
    `SELECT number, title, state, draft, login, head, base, created_at, updated_at, merged_at, closed_at, url, files, contracts, projects, checks, reviews, requested FROM command.code_pulls
      WHERE repo = $1 AND touches AND (state = 'open' OR coalesce(merged_at, closed_at) >= $2) ORDER BY updated_at DESC, number DESC`,
    [c.repo, cutoff],
  );
  const branches = [];
  for (const name of c.branches) {
    const { rows } = await db.query<{ n: number; last: Date | null }>(
      'SELECT count(*) FILTER (WHERE committed_at >= $3)::int AS n, max(committed_at) AS last FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches)',
      [c.repo, name, cutoff],
    );
    branches.push({ name, commits30: rows[0].n, lastAt: msOf(rows[0].last) });
  }

  // who: a commit's GitHub login, else the name on it; a PR's author. Everyone in the stored history, so a
  // quiet month doesn't empty the list; the last 30 days ride along.
  const { rows: byCommit } = await db.query<{ who: string; name: string; n: number; n30: number; last: Date }>(
    `SELECT coalesce(login, author) AS who, max(author) AS name, count(*)::int AS n, count(*) FILTER (WHERE committed_at >= $3)::int AS n30, max(committed_at) AS last
       FROM command.code_commits WHERE repo = $1 AND branches && $2::text[] GROUP BY 1`,
    [c.repo, c.branches, cutoff],
  );
  const { rows: byPull } = await db.query<{ who: string; n: number; n30: number; last: Date }>(
    `SELECT login AS who, count(*)::int AS n, count(*) FILTER (WHERE created_at >= $2)::int AS n30, max(created_at) AS last FROM command.code_pulls
      WHERE repo = $1 AND touches AND login IS NOT NULL GROUP BY 1`,
    [c.repo, cutoff],
  );
  const people = new Map<string, CodePayload['contributors'][number]>();
  const of = (who: string, name: string) =>
    people.get(who) ?? (people.set(who, { who, name, commits: 0, pulls: 0, commits30: 0, pulls30: 0, lastAt: 0 }), people.get(who)!);
  for (const r of byCommit) {
    const p = of(r.who, r.name);
    [p.commits, p.commits30] = [r.n, r.n30];
    p.lastAt = Math.max(p.lastAt, msOf(r.last)!);
  }
  for (const r of byPull) {
    const p = of(r.who, r.who);
    [p.pulls, p.pulls30] = [r.n, r.n30];
    p.lastAt = Math.max(p.lastAt, msOf(r.last)!);
  }
  // each project's newest commit, and its commits in the window
  const { rows: pj } = await db.query<{ id: string; last: Date | null; n: number }>(
    `SELECT p AS id, max(committed_at) AS last, count(*) FILTER (WHERE committed_at >= $3)::int AS n
       FROM command.code_commits, unnest(projects) AS p WHERE repo = $1 AND branches && $2::text[] GROUP BY p`,
    [c.repo, c.branches, cutoff],
  );
  const pjOf = new Map(pj.map((r) => [r.id, r]));
  const projects = PROJECTS.map((p) => ({
    id: p.id,
    name: p.name,
    tiny: p.tiny,
    what: p.what,
    lang: p.lang,
    path: p.paths[0],
    lastAt: msOf(pjOf.get(p.id)?.last ?? null),
    commits30: pjOf.get(p.id)?.n ?? 0,
  }));
  const contributors = [...people.values()].sort((a, b) => b.commits + b.pulls - (a.commits + a.pulls) || b.lastAt - a.lastAt || a.who.localeCompare(b.who));

  // how fresh: the last run of any part of the poller, and the first error any part has
  const { rows: runs } = await db.query<{ ran_at: Date; error: string | null; part: string }>(
    `SELECT ran_at, error, branch AS part FROM command.code_cursor WHERE repo = $1 AND path = $2 AND branch = ANY($3::text[])
     UNION ALL SELECT ran_at, error, 'pull requests' AS part FROM command.code_pull_cursor WHERE repo = $1`,
    [c.repo, c.watch, c.branches],
  );
  const failed = runs.find((r) => r.error);
  const { rows: w } = await db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM command.code_commits WHERE repo = $1 AND files IS NULL) + (SELECT count(*) FROM command.code_pulls WHERE repo = $1 AND touches IS NULL AND updated_at >= $2) AS n`,
    [c.repo, cutoff],
  );

  return {
    repo: c.repo,
    path: c.path,
    watch: c.watch,
    projects,
    names: names ? 'shown' : 'none',
    commits: cm.map((r) => ({
      sha: String(r.sha).slice(0, 7),
      url: r.url,
      branches: c.branches.filter((b) => (r.branches as string[]).includes(b)),
      author: names ? r.author : '',
      login: names ? (r.login ?? '') : '',
      message: String(r.message).split('\n')[0],
      at: msOf(r.committed_at)!,
      pr: r.pr,
      contracts: r.contracts ?? [],
      projects: r.projects ?? [],
    })),
    pulls: pl.map((r) => ({
      number: r.number,
      title: r.title,
      state: r.state,
      draft: r.draft,
      login: names ? (r.login ?? '') : '',
      head: r.head,
      base: r.base,
      createdAt: msOf(r.created_at)!,
      updatedAt: msOf(r.updated_at)!,
      mergedAt: msOf(r.merged_at),
      closedAt: msOf(r.closed_at),
      url: r.url,
      files: (r.files ?? []).length,
      contracts: r.contracts ?? [],
      projects: r.projects ?? [],
      checks: checkState(r.checks),
      // who reviewed and who's asked: names only above Totals, as the authors are
      reviews: (r.reviews as PullReview[] | null)?.map((v) => ({ login: names ? v.login : '', state: v.state, at: v.at })) ?? null,
      requested: names ? (r.requested ?? []) : (r.requested ?? []).map(() => ''),
    })),
    checks: await branchChecks(db, c, now),
    branches,
    contributors: names ? contributors : [],
    people: contributors.length,
    poller: {
      ranAt: runs.length ? Math.max(...runs.map((r) => msOf(r.ran_at)!)) : null,
      error: failed ? `${failed.part}: ${failed.error}` : null,
      token: !!process.env.GITHUB_TOKEN?.trim(),
      waiting: Number(w[0].n),
      branches: c.branches,
    },
  };
}

// ── Contracts' changes ──────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (t: number) => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const DAY = 24 * 3600e3;

export interface CodeChange {
  id: string;
  t: string;
  c: string;
  by: string;
  stage?: number;
  state: string;
  d: string;
  short?: string;
  ev: unknown[];
  commits: Array<{ sha: string; at: number; message: string; url: string; pr: number | null }>;
}

/**
 * Each map contract's changes from its commits. A commit goes to the first release after it
 * landed; the commits after the last release are one change in flight, the next version. Releases
 * in the last 30 days are changes done, by whoever wrote their commits.
 *
 * `deployed` says which deployed contract a map name stands for (ClearUSD is ClearUSDUpgradeable);
 * a commit counts for either name. A contract with no proxy releases once, when it was deployed.
 */
export async function codeChanges(
  db: Queryable,
  c: CodeConfig,
  map: Array<{ name: string; deployed: string | null; deployedAt: number | null }>,
  releases: Map<string, Release[]>,
  now: number,
  /** Whether each deployed contract runs what dev compiles (codeMatchLive), by its deployed name: when it does, commits dated after its last release went out with it. */
  same: Map<string, boolean> = new Map(),
): Promise<{ open: CodeChange[]; done: CodeChange[] }> {
  const { rows } = await db.query<{ sha: string; committed_at: Date; author: string; author_email: string | null; message: string; url: string; pr: number | null; contracts: string[] }>(
    'SELECT sha, committed_at, author, author_email, message, url, pr, contracts FROM command.code_commits WHERE repo = $1 AND $2 = ANY(branches) AND contracts IS NOT NULL ORDER BY committed_at',
    [c.repo, c.branch],
  );
  // a commit's author by the name they have in Command, when their email is a person's here
  const { rows: ppl } = await db.query<{ email: string; name: string }>('SELECT lower(email) AS email, name FROM command.people WHERE email IS NOT NULL');
  const names = new Map(ppl.map((p) => [p.email, p.name]));
  const commits = rows.map((r) => ({
    sha: r.sha,
    at: new Date(r.committed_at).getTime(),
    by: (r.author_email && names.get(r.author_email.toLowerCase())) || r.author,
    message: r.message.split('\n')[0],
    url: r.url,
    pr: r.pr,
    contracts: r.contracts,
  }));
  const by = (list: typeof commits) => [...new Set(list.map((x) => x.by))].join(', ') || '—';
  const said = (list: typeof commits) => list.slice(-3).reverse().map((x) => x.message).join('; ');
  const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
  const out = (list: typeof commits) => list.map(({ sha, at, message, url, pr }) => ({ sha, at, message, url, pr }));

  const open: CodeChange[] = [],
    done: CodeChange[] = [];
  for (const m of map) {
    const keys = new Set([m.name, m.deployed].filter(Boolean) as string[]);
    const mine = commits.filter((x) => x.contracts.some((k) => keys.has(k)));
    const rel = (m.deployed && releases.get(m.deployed)) || (m.deployedAt != null ? [{ version: 'v1.0', at: m.deployedAt, implementation: '' }] : []);
    const shipped: Array<typeof commits> = rel.map(() => []);
    let after: typeof commits = [];
    for (const x of mine) {
      const i = rel.findIndex((r) => r.at >= x.at);
      (i < 0 ? after : shipped[i]).push(x);
    }
    // the chain runs exactly what dev compiles: what's dated after the release went out with it (deployed
    // from its branch before it merged), so nothing is waiting
    const match = m.deployed ? same.get(m.deployed) : undefined;
    if (match === true && rel.length) {
      shipped[rel.length - 1].push(...after);
      after = [];
    }
    rel.forEach((r, i) => {
      if (r.at < now - 30 * DAY) return;
      const list = shipped[i];
      done.push({
        id: `rel:${m.name}:${r.version}`,
        t: `${m.name} ${r.version}`,
        c: m.name,
        by: by(list),
        state: `Live ${dayMon(r.at)}`,
        d: list.length ? `${plural(list.length)}: ${said(list)}` : 'Released',
        ev: list.length ? [['seg', 'done', list[0].at, r.at], ['draft', list[0].at], ['live', r.at]] : [['live', r.at]],
        commits: out(list),
      });
    });
    if (after.length) {
      const next = `v1.${rel.length}`;
      open.push({
        id: `code:${m.name}`,
        t: `${m.name} ${next}`,
        c: m.name,
        by: by(after),
        stage: 0,
        state: `${plural(after.length)} on ${c.branch} · ${match === false ? 'differs from what’s deployed' : 'not released'}`,
        d: said(after),
        short: after.at(-1)!.message,
        ev: [['seg', 'open', after[0].at, now], ['draft', after[0].at]],
        commits: out(after),
      });
    }
  }
  open.sort((a, b) => (b.ev[1] as any)[1] - (a.ev[1] as any)[1]);
  done.sort((a, b) => (b.ev.at(-1) as any)[1] - (a.ev.at(-1) as any)[1]);
  return { open, done };
}
