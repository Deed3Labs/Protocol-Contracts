/*
 * Where each app runs, for Build's "Where it runs" (the Deploys tab): every Vercel project's latest deploy
 * from a pull request, from dev (the testnet demo) and from main (production), read with the Vercel token
 * Rewards already uses (VERCEL_TOKEN, VERCEL_TEAM_ID); and the API's two Railway environments, each read
 * from its own /health, which says what Railway built it from. Read when Build loads, kept two minutes.
 */

type Env = Record<string, string | undefined>;
export type DeployEnv = 'preview' | 'test' | 'prod';
export interface DeployCell {
  state: 'ready' | 'building' | 'error';
  /** The branch it was built from. */
  ref: string | null;
  sha: string | null;
  /** When it was made (Vercel) or started running (Railway), ms. */
  at: number | null;
  pr: number | null;
}
export interface Deploys {
  /** Build's project id → its environments' latest deploys. */
  projects: Record<string, Partial<Record<DeployEnv, DeployCell>>>;
  /** Why the Vercel apps aren't read, or null. */
  vercelOff: string | null;
}

/** Build's projects on Vercel, by the Vercel project's name. */
export const VERCEL_PROJECTS: Record<string, string> = { app: 'protocol-contracts', merchant: 'clear-merchant', cc: 'clear-command', pay: 'clear-pay', rewards: 'clear-rewards' };
/** The API's Railway environments: dev (testnet) and production (built from main, whatever its address says). */
const API_URLS = ['https://protocol-contracts-dev.up.railway.app', 'https://protocol-contracts-preview.up.railway.app'];
const KEEP_MS = 2 * 60_000;
const STARTED = new Date().toISOString();

/** What this API is running, as Railway built it; nulls when it isn't on Railway. */
export const buildInfo = (env: Env = process.env) => ({
  commit: env.RAILWAY_GIT_COMMIT_SHA || null,
  branch: env.RAILWAY_GIT_BRANCH || null,
  environment: env.RAILWAY_ENVIRONMENT_NAME || null,
  startedAt: STARTED,
});

/** The environment a branch deploys to: dev is the testnet demo, main is production, anything else a preview. */
export const envOf = (ref: string | null | undefined): DeployEnv => (ref === 'main' ? 'prod' : ref === 'dev' ? 'test' : 'preview');

type VercelDeploy = { readyState?: string; state?: string; created?: number; createdAt?: number; meta?: Record<string, string | undefined> };
const stateOf = (s: string | undefined): DeployCell['state'] | null =>
  s === 'READY' ? 'ready' : s === 'BUILDING' || s === 'INITIALIZING' || s === 'QUEUED' ? 'building' : s === 'ERROR' || s === 'BLOCKED' ? 'error' : null;

export function deploysReader(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()) {
  const token = env.VERCEL_TOKEN?.trim();
  const team = env.VERCEL_TEAM_ID?.trim();
  const apis = (env.COMMAND_API_URLS?.split(',') ?? API_URLS).map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean);
  const get = async <T>(url: string, headers: Record<string, string> = {}): Promise<T> => {
    const r = await f(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  };

  /** A Vercel project's latest deploy on a branch (or, with none, from a pull request); skipped builds don't count. */
  const vercel = async (project: string, branch?: string): Promise<DeployCell | null> => {
    const q = new URLSearchParams({ projectId: project, limit: '20', ...(branch ? { branch } : {}), ...(team ? { teamId: team } : {}) });
    const { deployments } = await get<{ deployments: VercelDeploy[] }>(`https://api.vercel.com/v7/deployments?${q}`, { Authorization: `Bearer ${token}` });
    for (const d of deployments) {
      const state = stateOf(d.readyState ?? d.state);
      const ref = d.meta?.githubCommitRef ?? null;
      if (!state || (!branch && envOf(ref) !== 'preview')) continue;
      return { state, ref, sha: d.meta?.githubCommitSha ?? null, at: d.created ?? d.createdAt ?? null, pr: Number(d.meta?.githubPrId) || null };
    }
    return null;
  };

  const read = async (): Promise<Deploys> => {
    const projects: Deploys['projects'] = {};
    const vercelOff = token ? null : 'VERCEL_TOKEN isn’t set';
    const jobs: Promise<void>[] = [];
    if (token)
      for (const [id, name] of Object.entries(VERCEL_PROJECTS))
        for (const [k, branch] of [['preview', undefined], ['test', 'dev'], ['prod', 'main']] as const)
          jobs.push(
            vercel(name, branch).then(
              (c) => void (c && ((projects[id] ??= {})[k] = c)),
              () => undefined,
            ),
          );
    // the API: each environment's /health says what it was built from
    for (const url of apis)
      jobs.push(
        get<{ build?: ReturnType<typeof buildInfo> }>(`${url}/health`).then(
          ({ build }) => {
            if (!build?.branch) return;
            const at = Date.parse(build.startedAt);
            (projects.sdk ??= {})[envOf(build.branch)] = { state: 'ready', ref: build.branch, sha: build.commit, at: Number.isFinite(at) ? at : null, pr: null };
          },
          () => undefined,
        ),
      );
    await Promise.all(jobs);
    return { projects, vercelOff };
  };

  let kept: { at: number; p: Promise<Deploys> } | null = null;
  return {
    /** The deploys, read again once they're two minutes old. */
    read(): Promise<Deploys> {
      if (!kept || now() - kept.at > KEEP_MS) kept = { at: now(), p: read() };
      return kept.p;
    },
  };
}

let shared: ReturnType<typeof deploysReader> | null = null;
/** The API's one reader, so every Build load shares the two-minute copy. */
export const readDeploys = () => (shared ??= deploysReader()).read();
