import type { CodeVerified, ContactSent, MemberQuote, PaidView, PaySession, PayStatus, PublicLink, PublicPayStarted } from '@clear/merchant-contracts';
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
  /** The website that may frame this session, the only origin the frame posts to. */
  frameOrigin(id: string): Promise<{ origin: string | null }>;
  /** A code and the approval page's link, to a phone or email. */
  contact(id: string, contact: string): Promise<ContactSent>;
  code(id: string, code: string): Promise<CodeVerified>;
  status(id: string): Promise<PayStatus>;
  member(id: string, token: string): Promise<MemberQuote>;
  approve(id: string, token: string, installments: number, idempotencyKey: string): Promise<PaidView>;
  /** The Clear app's approval page, for `window.open`. */
  approval(id: string): Promise<{ url: string }>;
}

async function call<T>(path: string, init?: { method?: 'POST'; body?: unknown; token?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // The payment-scoped sign-in, kept in memory: never a cookie.
        ...(init?.token ? { 'X-Pay-Session': init.token } : {}),
      },
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
  frameOrigin: (id) => call(`/api/checkout/${enc(id)}/frame`),
  contact: (id, contact) => call(`/api/checkout/${enc(id)}/contact`, { method: 'POST', body: { contact } }),
  code: (id, code) => call(`/api/checkout/${enc(id)}/code`, { method: 'POST', body: { code } }),
  status: (id) => call(`/api/checkout/${enc(id)}/status`),
  member: (id, token) => call(`/api/checkout/${enc(id)}/member`, { token }),
  approve: (id, token, installments, idempotencyKey) => call(`/api/checkout/${enc(id)}/approve`, { method: 'POST', body: { installments, idempotencyKey }, token }),
  approval: (id) => call(`/api/checkout/${enc(id)}/approval`, { method: 'POST', body: {} }),
};
