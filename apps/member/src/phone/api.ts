import type { PublicMenu, PublicPayStarted, PublicPoint, Receipt, WaitlistJoined } from './types';

/**
 * The phone pages' calls: `/api/p/:code` and `/api/r/:code`. Never cached (a bill changes by the
 * second, and the API says no-store too) and never with cookies: these pages have no one signed in.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

export class PhoneError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
    const { previewCall } = await import('./preview');
    return (await previewCall(path, body)) as T;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new PhoneError('Can’t reach Clear right now. Check your connection and try again', 0);
  }
  if (res.status === 204) return undefined as T;
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new PhoneError(typeof out?.message === 'string' ? sentence(out.message) : 'Something went wrong. Try again', res.status);
  return out as T;
}

const sentence = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
const p = (code: string) => `/api/p/${encodeURIComponent(code)}`;
const r = (code: string) => `/api/r/${encodeURIComponent(code)}`;

export const phoneApi = {
  point: (code: string) => call<PublicPoint>(p(code)),
  menu: (code: string) => call<PublicMenu>(`${p(code)}/menu`),
  pay: (code: string, method: 'clear' | 'card', idempotencyKey: string) => call<PublicPayStarted>(`${p(code)}/pay`, { method, idempotencyKey }),
  joinWaitlist: (code: string, input: { name: string; size: number; phone: string | null; textConsent: boolean }) => call<WaitlistJoined>(`${p(code)}/waitlist`, input),
  receipt: (code: string) => call<Receipt>(r(code)),
  emailReceipt: (code: string, email: string) => call<void>(`${r(code)}/email`, { email }),
};

/** One key per thing the customer means to do, so a second tap or a retry starts nothing new. */
export function intentKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
