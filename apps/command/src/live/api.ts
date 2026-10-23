import { API_BASE } from './env';
import { privy } from './privy';

/**
 * Calls to /api/command with the Privy token and the Command Center session. The session id is kept
 * in localStorage when "keep me signed in" was ticked (the server ends it after 12 hours) and in
 * sessionStorage otherwise, so it ends with the browser.
 */

const SESSION = 'cc-session';
const DEVICE = 'cc-device';

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;
  constructor(status: number, code: string, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const read = (s: Storage, k: string) => {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
};
const write = (s: Storage, k: string, v: string | null) => {
  try {
    if (v == null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    // private windows: the session simply won't outlive the page
  }
};

let memory: string | null = null;
export const sessionId = () => read(localStorage, SESSION) ?? read(sessionStorage, SESSION) ?? memory;
export function keepSession(id: string, keep: boolean) {
  memory = id;
  write(keep ? localStorage : sessionStorage, SESSION, id);
  write(keep ? sessionStorage : localStorage, SESSION, null);
}
export function forgetSession() {
  memory = null;
  write(localStorage, SESSION, null);
  write(sessionStorage, SESSION, null);
}

/** A random id this browser keeps, so a sign-in from a new device shows as one. */
export function deviceKey(): string {
  let k = read(localStorage, DEVICE);
  if (!k) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    k = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    write(localStorage, DEVICE, k);
  }
  return k;
}

/** The city Vercel places us in (api/where.ts); null off Vercel. */
export async function city(): Promise<string | null> {
  try {
    const r = await fetch('/api/where', { signal: AbortSignal.timeout(2500) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return ((await r.json()) as { city?: string }).city || null;
  } catch {
    return null;
  }
}

let onEnded: (() => void) | null = null;
/** What to do when the server says the session is over (it was ended elsewhere, or access ran out). */
export const whenSessionEnds = (fn: () => void) => (onEnded = fn);

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await privy.token();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const sid = sessionId();
  if (sid) headers['X-Command-Session'] = sid;
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/command${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Can’t reach Clear right now. Check the connection and try again.');
  }
  const text = await r.text();
  const data = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (!r.ok) {
    const err = new ApiError(r.status, String(data.code ?? 'ERROR'), String(data.error ?? data.message ?? 'Something went wrong'), data);
    if (r.status === 401 && path !== '/sessions' && onEnded) onEnded();
    throw err;
  }
  return data as T;
}
