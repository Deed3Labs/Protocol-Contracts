import { API_BASE, PAY_ORIGIN, PUBLISHABLE_KEY } from './constants';
import type { ClearConfig } from './types';

export type Mode = 'test' | 'live';

export interface Config {
  key: string;
  mode: Mode;
  apiBase: string;
  payOrigin: string;
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

export const isLoopback = (hostname: string): boolean => LOOPBACK.includes(hostname);

/** Why a key can't be used in a page, or null. */
export function keyProblem(key: unknown): string | null {
  if (typeof key !== 'string' || !key.trim()) {
    return 'Clear needs your publishable key: Clear("clear_pk_live_…"), from Settings › Developers in the merchant app.';
  }
  const k = key.trim();
  if (/^(clear_)?sk_/.test(k)) {
    return 'That is a secret key. A secret key (clear_sk_…) must never be in a web page: roll it in Settings › Developers now, and use the publishable key (clear_pk_…) here.';
  }
  if (!PUBLISHABLE_KEY.test(k)) {
    return 'That is not a Clear publishable key. It starts clear_pk_test_ or clear_pk_live_.';
  }
  return null;
}

/** An http(s) origin, or null. http only for loopback. */
function origin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname))) return u.origin;
  } catch {
    /* not a URL */
  }
  return null;
}

/** The instance's settings, or the reason it can't be made. */
export function makeConfig(key: unknown, options: ClearConfig = {}): Config | string {
  const problem = keyProblem(key);
  if (problem) return problem;
  const k = (key as string).trim();
  const mode: Mode = k.startsWith('clear_pk_live_') ? 'live' : 'test';

  let apiBase = API_BASE;
  if (options.apiBase != null) {
    const o = typeof options.apiBase === 'string' ? origin(options.apiBase) : null;
    if (!o) return 'apiBase must be an https URL (or http on localhost).';
    apiBase = options.apiBase.replace(/\/+$/, '');
  }

  let payOrigin = PAY_ORIGIN;
  if (options.payOrigin != null) {
    const o = typeof options.payOrigin === 'string' ? origin(options.payOrigin) : null;
    if (!o) return 'payOrigin must be an https origin (or http on localhost).';
    if (o !== PAY_ORIGIN && mode !== 'test') return `payOrigin can only be changed with a test key. Live payments open on ${PAY_ORIGIN}.`;
    payOrigin = o;
  }
  return { key: k, mode, apiBase, payOrigin };
}

/** Why the script won't run on this page, or null. */
export function pageProblem(loc: { protocol: string; hostname: string }, mode: Mode): string | null {
  if (loc.protocol === 'https:') return null;
  if (isLoopback(loc.hostname) && (loc.protocol === 'http:' || loc.protocol === 'https:')) {
    return mode === 'test' ? null : 'A live key only runs on an https page. On localhost, use your test key (clear_pk_test_…).';
  }
  return 'Pay with Clear only runs on an https page (or on localhost with a test key).';
}
