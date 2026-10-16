/**
 * A shop's own domain on the rewards Vercel project (rewards spec, Phase 7), through Vercel's REST
 * API. Adding the domain is what makes Vercel serve the rewards app on it and issue its
 * certificate; the shop adds one DNS record, and the state says when Vercel sees it.
 *
 *   VERCEL_TOKEN                 a token that can manage the rewards project's domains
 *   VERCEL_REWARDS_PROJECT_ID    the rewards project (prj_…)
 *   VERCEL_TEAM_ID               the team it's in (team_…), when it's a team's
 *
 * Without them there is no client, and a domain stays a record the shop can't use yet.
 */

export interface VercelDomainState {
  /** Vercel accepts it as this project's (it may still want a TXT record when another account has it). */
  verified: boolean;
  /** The DNS doesn't point at Vercel yet. */
  misconfigured: boolean;
  /** Vercel's TXT challenge, when it has one. */
  verification: { type: 'TXT'; name: string; value: string } | null;
}

export interface VercelDomains {
  add(domain: string): Promise<VercelDomainState>;
  state(domain: string): Promise<VercelDomainState>;
  remove(domain: string): Promise<void>;
}

export class VercelError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ProjectDomain {
  name: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string }>;
}

export function vercelDomains(opts: { token: string; projectId: string; teamId?: string | null; fetch?: Fetch; base?: string }): VercelDomains {
  const base = (opts.base ?? 'https://api.vercel.com').replace(/\/+$/, '');
  const f = opts.fetch ?? fetch;
  const team = opts.teamId ? `?teamId=${encodeURIComponent(opts.teamId)}` : '';
  const project = encodeURIComponent(opts.projectId);
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await f(`${base}${path}${team}`, {
      method,
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!r.ok) throw new VercelError(json.error?.message ?? `Vercel answered ${r.status}`, r.status);
    return json;
  };
  const challenge = (d: ProjectDomain): VercelDomainState['verification'] => {
    const v = d.verification?.find((x) => x.type === 'TXT');
    return v ? { type: 'TXT', name: v.domain, value: v.value } : null;
  };
  const config = (domain: string) => call<{ misconfigured: boolean }>('GET', `/v6/domains/${encodeURIComponent(domain)}/config`);
  const state = async (domain: string): Promise<VercelDomainState> => {
    let d = await call<ProjectDomain>('GET', `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`);
    // A TXT challenge is only checked when asked: ask, and keep what Vercel says.
    if (!d.verified) d = await call<ProjectDomain>('POST', `/v9/projects/${project}/domains/${encodeURIComponent(domain)}/verify`).catch(() => d);
    const c = await config(domain);
    return { verified: d.verified, misconfigured: c.misconfigured, verification: d.verified ? null : challenge(d) };
  };
  return {
    async add(domain) {
      try {
        await call<ProjectDomain>('POST', `/v10/projects/${project}/domains`, { name: domain });
      } catch (e) {
        // Already this project's (a second Use this domain): carry on to its state.
        if (!(e instanceof VercelError && e.status === 409)) throw e;
      }
      return state(domain);
    },
    state,
    async remove(domain) {
      await call('DELETE', `/v9/projects/${project}/domains/${encodeURIComponent(domain)}`).catch((e) => {
        if (!(e instanceof VercelError && e.status === 404)) throw e;
      });
    },
  };
}

export function vercelDomainsFromEnv(env = process.env): VercelDomains | null {
  const token = env.VERCEL_TOKEN?.trim();
  const projectId = env.VERCEL_REWARDS_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return vercelDomains({ token, projectId, teamId: env.VERCEL_TEAM_ID?.trim() || null });
}
