import type { PaySession, PublicLink, PublicPayStarted } from '@clear/merchant-contracts';
import { API_BASE } from './env';

/**
 * The link page's four calls (apps/api routes/payLinks.ts). Never cached and never with cookies: a
 * payment changes by the second, and this page signs nobody in.
 */
export class PayApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PayApi {
  link(slug: string): Promise<PublicLink>;
  startSession(slug: string): Promise<{ session: string }>;
  session(id: string): Promise<PaySession>;
  pay(id: string, method: 'clear' | 'card', idempotencyKey: string): Promise<PublicPayStarted>;
}

async function call<T>(path: string, init?: { method?: 'POST'; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PayApiError('We couldn’t reach Clear. Check your connection and try again.', 0, null);
  }
  const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) throw new PayApiError(data?.message ?? 'Something went wrong. Try again.', res.status, data?.error ?? null);
  return data as T;
}

const enc = encodeURIComponent;

export const liveApi: PayApi = {
  link: (slug) => call(`/api/l/${enc(slug)}`),
  startSession: (slug) => call(`/api/l/${enc(slug)}/session`, { method: 'POST', body: {} }),
  session: (id) => call(`/api/checkout/${enc(id)}`),
  pay: (id, method, idempotencyKey) => call(`/api/checkout/${enc(id)}/pay`, { method: 'POST', body: { method, idempotencyKey } }),
};
