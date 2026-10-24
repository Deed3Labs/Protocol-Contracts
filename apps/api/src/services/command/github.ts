import type { Queryable } from '../../db/db.js';
import type { Release } from './onchain.js';

/*
 * Changes from GitHub (docs/command-center-plan.md, Phase 5c): the commits on `dev` that touch the
 * contracts, polled, and turned into Contracts' changes. A contract's commits since its last
 * release are a change in flight; the commits before each release are what that release shipped.
 *
 * Cheap by design. The list is asked for with the ETag of the last answer, and an unchanged answer
 * (304) costs nothing against the token's rate limit. Each new commit's files are asked for once.
 * The repository is public, so it works without a token too, at 60 requests an hour: the first
 * backfill then takes a few runs, a commit's files being filled by whichever run has the budget.
 */

export interface CodeConfig {
  repo: string;
  branch: string;
  path: string;
}
export const codeConfig = (env: Record<string, string | undefined> = process.env): CodeConfig => ({
  repo: env.COMMAND_GITHUB_REPO || 'Deed3Labs/Protocol-Contracts',
  branch: env.COMMAND_GITHUB_BRANCH || 'dev',
  path: (env.COMMAND_GITHUB_PATH || 'contracts').replace(/^\/+|\/+$/g, ''),
});

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

export interface GithubSource {
  /** One page of the branch's commits touching the path, newest first, since a time if given. */
  list(c: CodeConfig, since: string | null, page: number, etag: string | null): Promise<ListAnswer>;
  /** The files one commit changed. */
  files(repo: string, sha: string): Promise<{ files: string[]; remaining: number | null }>;
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
      const q = new URLSearchParams({ sha: c.branch, path: c.path, per_page: '100', page: String(page), ...(since ? { since } : {}) });
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
  notModified: boolean;
  /** Commits still waiting for their files. */
  waiting: number;
}

/**
 * One run: the commits since the newest one held (all of them the first time), then the files of
 * those that don't have them, as far as the budget goes.
 */
export async function pollOnce(db: Queryable, src: GithubSource, c: CodeConfig, o: { maxPages?: number; filesBudget?: number } = {}): Promise<PollResult> {
  const maxPages = o.maxPages ?? 10;
  const budget = o.filesBudget ?? (src.authorized ? 200 : 20);
  const { rows: cur } = await db.query<{ since: Date | null; etag: string | null }>('SELECT since, etag FROM command.code_cursor WHERE repo = $1 AND branch = $2 AND path = $3', [c.repo, c.branch, c.path]);
  const since = cur[0]?.since ? new Date(cur[0].since).toISOString() : null;
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
        `INSERT INTO command.code_commits (repo, sha, branch, committed_at, author, author_email, login, message, url, pr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (repo, sha) DO NOTHING RETURNING 1`,
        [c.repo, x.sha, c.branch, x.committedAt, x.author, x.email, x.login, x.message, x.url, prOf(x.message)],
      );
      added += ins.rows.length;
    }
    if (!r.more) break;
  }

  // the files of each commit not yet asked about, oldest first, while the rate limit lasts
  const { rows: todo } = await db.query<{ sha: string }>('SELECT sha FROM command.code_commits WHERE repo = $1 AND branch = $2 AND files IS NULL ORDER BY committed_at LIMIT $3', [c.repo, c.branch, budget]);
  let filled = 0;
  for (const { sha } of todo) {
    const r = await src.files(c.repo, sha);
    await db.query('UPDATE command.code_commits SET files = $3, contracts = $4 WHERE repo = $1 AND sha = $2', [c.repo, sha, r.files, contractsOf(r.files, c.path)]);
    filled++;
    if (r.remaining != null && r.remaining < 5) break;
  }

  // the next ask starts a week before the newest commit; the ETag only holds for the same ask
  const { rows: nw } = await db.query<{ newest: Date | null; waiting: number }>(
    'SELECT max(committed_at) AS newest, count(*) FILTER (WHERE files IS NULL)::int AS waiting FROM command.code_commits WHERE repo = $1 AND branch = $2',
    [c.repo, c.branch],
  );
  const next = nw[0].newest ? new Date(new Date(nw[0].newest).getTime() - OVERLAP_MS).toISOString() : null;
  await db.query(
    `INSERT INTO command.code_cursor (repo, branch, path, since, etag, ran_at, error) VALUES ($1, $2, $3, $4, $5, now(), NULL)
     ON CONFLICT (repo, branch, path) DO UPDATE SET since = $4, etag = $5, ran_at = now(), error = NULL`,
    [c.repo, c.branch, c.path, next, next === since ? etag : null],
  );
  return { listed, added, filled, notModified, waiting: nw[0].waiting };
}

export async function recordCodeError(db: Queryable, c: CodeConfig, error: unknown) {
  await db.query(
    `INSERT INTO command.code_cursor (repo, branch, path, ran_at, error) VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (repo, branch, path) DO UPDATE SET ran_at = now(), error = $4`,
    [c.repo, c.branch, c.path, String((error as Error)?.message ?? error).slice(0, 500)],
  );
}

/** Where the poller is: how many commits it holds, how many still want their files, its last error. */
export async function codeStatus(db: Queryable, c: CodeConfig = codeConfig()) {
  const { rows } = await db.query<any>(
    `SELECT (SELECT count(*)::int FROM command.code_commits WHERE repo = $1 AND branch = $2) AS commits,
            (SELECT count(*)::int FROM command.code_commits WHERE repo = $1 AND branch = $2 AND files IS NULL) AS waiting,
            (SELECT max(committed_at) FROM command.code_commits WHERE repo = $1 AND branch = $2) AS newest,
            k.ran_at, k.error
       FROM (SELECT 1) one LEFT JOIN command.code_cursor k ON k.repo = $1 AND k.branch = $2 AND k.path = $3`,
    [c.repo, c.branch, c.path],
  );
  const r = rows[0];
  return { ...c, commits: r.commits, waitingForFiles: r.waiting, newest: r.newest, ranAt: r.ran_at, error: r.error, token: !!process.env.GITHUB_TOKEN?.trim() };
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
): Promise<{ open: CodeChange[]; done: CodeChange[] }> {
  const { rows } = await db.query<{ sha: string; committed_at: Date; author: string; author_email: string | null; message: string; url: string; pr: number | null; contracts: string[] }>(
    'SELECT sha, committed_at, author, author_email, message, url, pr, contracts FROM command.code_commits WHERE repo = $1 AND branch = $2 AND contracts IS NOT NULL ORDER BY committed_at',
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
    const after: typeof commits = [];
    for (const x of mine) {
      const i = rel.findIndex((r) => r.at >= x.at);
      (i < 0 ? after : shipped[i]).push(x);
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
        state: `${plural(after.length)} on ${c.branch} · not released`,
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
