import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeConfig } from './github.js';

/*
 * Build → Signing (brief update 2, section 6): the day-0 signing plan that scripts/signing_plan.ts writes
 * (format `clear-signing-plan/1`), committed to the repo at deployments/<network>/signing-plan.json after
 * each plan run. The plan goes out exactly as the file has it, the steps untouched, so the browser can check
 * sha256(JSON.stringify(plan.steps)) against stepsSha256 as tools/signing-page does and send each step's
 * call data as written. Nothing here builds a call.
 *
 * Until a plan is committed, the newest run log of a plan run (deployments/<network>/run-log/*signing-plan*.log,
 * newest by the block it was read at) gives each step's id, status and why it waits, and nothing else: no
 * titles, no calls.
 *
 * Where it's read from. The API's image is apps/api and the packages it needs (apps/api/Dockerfile), not
 * deployments/, so in production it reads the repo itself: GitHub's contents API at the branch the Code tab
 * follows (COMMAND_GITHUB_REPO, COMMAND_GITHUB_BRANCH: Deed3Labs/Protocol-Contracts at dev), with the GitHub
 * poller's GITHUB_TOKEN when it's set (the repo is public, so it works without one at 60 requests an hour).
 * The branch's head is checked at most once a minute, and the files are read again only when it moves.
 * COMMAND_SIGNING_DIR (a deployments/<network> folder on disk) reads a checkout instead, for local runs.
 */

type Env = Record<string, string | undefined>;
export const PLAN_FORMAT = 'clear-signing-plan/1';
const BASE_SEPOLIA = 84532;
const CHECK_MS = 60_000;

/** The plan as scripts/signing_plan.ts writes it (SigningPlan there); served as-is. */
export interface SigningPlanFile {
  format: string;
  generatedAt: string;
  network: string;
  chainId: number;
  block: number;
  blockTime: string;
  stepsSha256: string;
  notes: string[];
  steps: Array<Record<string, unknown> & { id: string }>;
}

export type RunLogStatus = 'done' | 'waiting' | 'ready';
export interface RunLog {
  file: string;
  block?: number;
  /** when the plan run read the chain (ms) */
  at?: number;
  steps: Array<{ id: string; status: RunLogStatus; why?: string }>;
}

export interface Signing {
  source: 'plan' | 'run-log' | 'none';
  /** the file it came from, in the repo */
  file?: string;
  plan: SigningPlanFile | null;
  runLog?: RunLog;
  /** the repo commit it was read at, when read from GitHub */
  commit?: string;
  readAt: number;
  /** why a plan that's there wasn't used, or why nothing could be read */
  problem?: string;
}

const isAddress = (a: unknown) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const isHex = (a: unknown) => typeof a === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(a);

/** The plan's text, checked as tools/signing-page checks it (verifyPlan): the format, Base Sepolia, each step's shape, the fingerprint. */
export function parsePlan(text: string): { plan: SigningPlanFile } | { error: string } {
  let p: SigningPlanFile;
  try {
    p = JSON.parse(text);
  } catch {
    return { error: 'signing-plan.json isn’t JSON' };
  }
  if (!p || p.format !== PLAN_FORMAT || !Array.isArray(p.steps)) return { error: `signing-plan.json isn’t a ${PLAN_FORMAT} plan` };
  if (p.chainId !== BASE_SEPOLIA) return { error: `the plan is for chain ${p.chainId}, not Base Sepolia` };
  for (const [i, s] of p.steps.entries()) {
    if (!s || typeof s.id !== 'string') return { error: `step ${i + 1} is malformed` };
    if (s.chainId !== p.chainId || !isAddress(s.signer) || !isAddress(s.to) || (s.data !== null && !isHex(s.data)) || s.value !== '0') return { error: `step ${s.id} is malformed` };
  }
  const digest = createHash('sha256').update(JSON.stringify(p.steps)).digest('hex');
  if (digest !== p.stepsSha256) return { error: 'the plan’s steps don’t match its fingerprint (stepsSha256): it was changed after the script wrote it' };
  return { plan: p };
}

/**
 * A plan run's log: "Signing plan for base-sepolia (chain 84532) at block N, <ISO>.", then a line a step
 * ("DONE    C1d-1   <signer> -> <to>.<fn>", READY, WAITING), each with its indented reason lines under it.
 */
export function parseRunLog(text: string, file: string): RunLog {
  const out: RunLog = { file, steps: [] };
  const head = /Signing plan for \S+ \(chain \d+\) at block (\d+), (\S+?)\.?\s/.exec(text);
  if (head) {
    out.block = Number(head[1]);
    const at = Date.parse(head[2]);
    if (Number.isFinite(at)) out.at = at;
  }
  let last: RunLog['steps'][number] | null = null;
  for (const line of text.split('\n')) {
    const m = /^(DONE|READY|WAITING)\s+(\S+)\s/.exec(line);
    if (m) {
      last = { id: m[2], status: m[1].toLowerCase() as RunLogStatus };
      out.steps.push(last);
      continue;
    }
    if (last && /^\s{4,}\S/.test(line) && !/^\s*(-->|\|)/.test(line)) {
      last.why = last.why ? `${last.why} ${line.trim()}` : line.trim();
      continue;
    }
    last = null;
  }
  return out;
}

/** Of several run logs, the newest plan run: by the block it read at, then by name. */
export function newestRunLog(logs: Array<[string, string]>): RunLog | null {
  const parsed = logs.map(([file, text]) => parseRunLog(text, file)).filter((l) => l.steps.length);
  parsed.sort((a, b) => (b.block ?? -1) - (a.block ?? -1) || b.file.localeCompare(a.file));
  return parsed[0] ?? null;
}

/** Where the plan and its run logs are. */
export interface PlanFiles {
  /** a version of the files: a commit, or null for a folder on disk (read every time) */
  version(): Promise<string | null>;
  /** a file's text, or null when it isn't there */
  read(path: string, version: string | null): Promise<string | null>;
  /** the file names in a folder */
  list(dir: string, version: string | null): Promise<string[]>;
}

const RUN_LOG = /signing-plan.*\.log$/;

export async function readSigning(files: PlanFiles, network: string, now: number, version?: string | null): Promise<Signing> {
  const v = version === undefined ? await files.version() : version;
  const base = `deployments/${network}`;
  const at = { readAt: now, ...(v ? { commit: v } : {}) };
  const planFile = `${base}/signing-plan.json`;
  const text = await files.read(planFile, v);
  let problem: string | undefined;
  if (text != null) {
    const r = parsePlan(text);
    if ('plan' in r) return { source: 'plan', file: planFile, plan: r.plan, ...at };
    problem = r.error;
  }
  const names = (await files.list(`${base}/run-log`, v)).filter((n) => RUN_LOG.test(n));
  const logs: Array<[string, string]> = [];
  for (const n of names) {
    const t = await files.read(`${base}/run-log/${n}`, v);
    if (t != null) logs.push([`${base}/run-log/${n}`, t]);
  }
  const runLog = newestRunLog(logs);
  if (runLog) return { source: 'run-log', file: runLog.file, plan: null, runLog, ...at, ...(problem ? { problem } : {}) };
  return { source: 'none', plan: null, ...at, ...(problem ? { problem } : {}) };
}

/** The repo on disk: COMMAND_SIGNING_DIR is a deployments/<network> folder. */
export function diskFiles(dir: string): PlanFiles {
  const local = (path: string) => join(dir, path.split('/').slice(2).join('/'));
  return {
    version: async () => null,
    read: (path) => readFile(local(path), 'utf8').catch(() => null),
    list: (d) => readdir(local(d)).catch(() => []),
  };
}

/** The repo on GitHub, at the commit the branch's head was when asked. */
export function githubFiles(env: Env = process.env, f: typeof fetch = fetch): PlanFiles & { head(): Promise<string> } {
  const { repo, branch } = codeConfig(env);
  const token = env.GITHUB_TOKEN?.trim();
  const headers = (raw = false) => ({
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'clear-command-center',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const get = (path: string, raw = false) => f(`https://api.github.com/repos/${repo}/${path}`, { headers: headers(raw), signal: AbortSignal.timeout(10_000) });
  const contents = (path: string, ref: string | null) => `contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${ref}` : ''}`;
  return {
    async head() {
      const r = await get(`commits/${encodeURIComponent(branch)}`);
      if (!r.ok) throw new Error(`GitHub ${r.status} on ${repo}@${branch}`);
      return String(((await r.json()) as { sha: string }).sha);
    },
    async version() {
      return this.head();
    },
    async read(path, ref) {
      const r = await get(contents(path, ref), true);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
      return r.text();
    },
    async list(dir, ref) {
      const r = await get(contents(dir, ref));
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub ${r.status} on ${dir}`);
      const j = (await r.json()) as Array<{ name: string; type: string }>;
      return Array.isArray(j) ? j.filter((x) => x.type === 'file').map((x) => x.name) : [];
    },
  };
}

/** The API's reader: what it read, kept until the branch moves (checked at most once a minute); a folder on disk is read every time. */
export function signingReader(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()) {
  const network = env.COMMAND_SIGNING_NETWORK?.trim() || 'base-sepolia';
  const dir = env.COMMAND_SIGNING_DIR?.trim();
  if (dir) {
    const files = diskFiles(dir);
    return { read: () => readSigning(files, network, now(), null) };
  }
  const gh = githubFiles(env, f);
  let kept: { sha: string; p: Promise<Signing> } | null = null;
  let head: Promise<string> | null = null;
  let checked = 0;
  return {
    async read(): Promise<Signing> {
      if (!head || now() - checked > CHECK_MS) {
        checked = now();
        head = gh.head();
        head.catch(() => (head = null));
      }
      const sha = await head;
      if (!kept || kept.sha !== sha) {
        const p = readSigning(gh, network, now(), sha);
        kept = { sha, p };
        p.catch(() => kept?.p === p && (kept = null));
      }
      return kept.p;
    },
  };
}

let shared: ReturnType<typeof signingReader> | null = null;
/** The API's one reader, so every request shares what was read at the branch's head. */
export const liveSigning = () => (shared ??= signingReader());
