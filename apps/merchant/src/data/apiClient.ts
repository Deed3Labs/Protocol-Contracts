import type { ChargeState, StaffRole } from '@clear/domain';
import { fromWire } from '@clear/domain';

/**
 * The merchant app's API client.
 *
 * One module, so every request carries the session token and every response is narrowed in one
 * place. It talks to `/api/merchant/*` plus `POST /api/charges`, which is the odd one out: raising
 * a charge is authenticated by an EIP-712 signature the registry verifies on chain, not by a
 * session, because a merchant device signs as itself.
 *
 * **The token is stored, not a cookie.** The member app and this one must never share a session,
 * and a cookie is the easiest way to get that wrong — one `Domain=.useclear.org` and both surfaces
 * are the same login. A bearer token in `Authorization` cannot be scoped to a parent domain by
 * accident, and the browser never attaches it on its own.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3001';
const TOKEN_KEY = 'clear.merchant.token';

export class ApiError extends Error {
  // Declared and assigned rather than a constructor parameter property: this app compiles with
  // `erasableSyntaxOnly`, which forbids syntax that emits code rather than just erasing types.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private windows and locked-down browsers throw rather than returning null.
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A tablet that cannot persist still has to work for the length of a shift.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    // Never send cookies. This surface has none, and asking for them is how one arrives.
    credentials: 'omit',
  });

  if (res.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      // Never a raw status. Every failure state has to leave the writer with something to say.
      'Something went wrong. Take the ticket the usual way and try again.';
    throw new ApiError(message, res.status);
  }
  return body as T;
}

/* ---------------------------------------------------------------- session */

export interface SessionResponse {
  token?: string;
  expiresAt: string;
  staff: { id: string; name: string; role: StaffRole };
  merchant: string;
}

export const api = {
  /**
   * Who is on the counter, for the shift screen.
   *
   * Names and roles only, and reachable before anyone has signed in — the screen exists so a
   * writer picks their own name rather than remembering which of four codes is theirs.
   */
  async roster(merchant: string): Promise<{ id: string; name: string; role: StaffRole }[]> {
    const res = await request<{ staff: { id: string; name: string; role: StaffRole }[] }>(
      '/api/merchant/roster',
      { method: 'POST', body: JSON.stringify({ merchant }) },
    );
    return res.staff;
  },

  /**
   * Start a shift: a name was picked, then a PIN.
   *
   * This is not a login. It says who is at the counter so charges can be attributed, and it
   * authorises nothing that moves money — that needs the owner's Privy sign-in. There is
   * deliberately no password parameter: Clear holds no owner credential to check.
   */
  async startShift(input: {
    merchant: string;
    staffId: string;
    pin: string;
  }): Promise<SessionResponse> {
    const res = await request<SessionResponse>('/api/merchant/session', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (res.token) storeToken(res.token);
    return res;
  },

  /** Called on load: the server decides what this device is, not localStorage. */
  async currentSession(): Promise<SessionResponse | null> {
    if (!readToken()) return null;
    try {
      return await request<SessionResponse>('/api/merchant/session');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        storeToken(null);
        return null;
      }
      throw err;
    }
  },

  async signOut(): Promise<void> {
    try {
      await request('/api/merchant/session', { method: 'DELETE' });
    } finally {
      // Clear locally even if the call failed — a writer pressing Sign out must end up signed out.
      storeToken(null);
    }
  },

  /* ---------------------------------------------------------------- charges */

  /**
   * Raise a charge.
   *
   * The one call that does not use the session. `signature` is EIP-712 over the charge, recovered
   * server-side and checked against `MerchantRegistry` for active status, the per-charge cap and
   * the discount — so the payout is computed from the chain and never from this request.
   *
   * `signCharge` is injected rather than implemented here because **where a counter tablet gets a
   * signing key is an unresolved design question**, not an implementation detail. See
   * `chargeSigner.ts`.
   */
  async raiseCharge(input: {
    merchant: string;
    merchantName: string;
    member: string;
    amountCents: number;
    nonce: string;
    issuedAt: number;
    signature: string;
  }): Promise<{ code: string; status: string; expiresAt: string; ttlSeconds: number }> {
    return request('/api/charges', { method: 'POST', body: JSON.stringify(input) });
  },

  async charges(opts: { since?: string; limit?: number } = {}): Promise<MerchantCharge[]> {
    const q = new URLSearchParams();
    if (opts.since) q.set('since', opts.since);
    if (opts.limit) q.set('limit', String(opts.limit));
    const res = await request<{ charges: WireCharge[] }>(
      `/api/merchant/charges${q.toString() ? `?${q}` : ''}`,
    );
    return res.charges.map(toCharge);
  },

  async cancelCharge(code: string): Promise<void> {
    await request(`/api/merchant/charges/${encodeURIComponent(code)}/cancel`, { method: 'POST' });
  },

  /* ---------------------------------------------------------------- refunds */

  /** A writer starts one. Nothing moves and the customer is told nothing. */
  async requestRefund(input: {
    chargeCode: string;
    splitInto: number;
    cyclesCleared: number;
    ratePerCycle: number;
    discountRate: number;
    nextPayoutCents: number;
  }): Promise<Refund> {
    return request('/api/merchant/refunds', { method: 'POST', body: JSON.stringify(input) });
  },

  /**
   * Verify an owner's code so the writer's screen can move to the authorise step.
   *
   * Returns a name and nothing else — no token, no session. The decision re-sends the code, so
   * this grants nothing that outlives the request.
   */
  async checkOwnerCode(code: string): Promise<{ id: string; name: string; role: StaffRole }> {
    return request('/api/merchant/owner-check', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /**
   * An owner authorises with their code, at the counter, without taking over the writer's session.
   *
   * The weaker of the two paths — it proves somebody knew four digits — which is why the shop's
   * threshold caps what it can clear. Above that the decision must come from the owner's own
   * device, and the record keeps which path was used.
   */
  async authoriseRefund(id: string, code: string, decision: 'approve' | 'decline'): Promise<Refund> {
    return request(`/api/merchant/refunds/${encodeURIComponent(id)}/authorise`, {
      method: 'POST',
      body: JSON.stringify({ code, decision }),
    });
  },

  /** An owner decides from their own device, signed in with Privy. No amount limit. */
  async decideRefund(id: string, decision: 'approve' | 'decline'): Promise<Refund> {
    return request(`/api/merchant/refunds/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },

  /** What a counter writer may clear with the owner's code. Zero is "Off". */
  async refundThreshold(): Promise<{ limitCents: number; maxCents: number | null }> {
    return request('/api/merchant/refund-threshold');
  },

  /** Owner only, and never reachable by the code path — the code cannot raise its own limit. */
  async setRefundThreshold(limitCents: number): Promise<{ limitCents: number }> {
    return request('/api/merchant/refund-threshold', {
      method: 'PUT',
      body: JSON.stringify({ limitCents }),
    });
  },

  async withdrawRefund(id: string): Promise<void> {
    await request(`/api/merchant/refunds/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* ------------------------------------------------------- owner-only reads */

  async payouts(): Promise<PayoutPosition> {
    return request('/api/merchant/payouts');
  },

  async staff(): Promise<StaffMember[]> {
    const res = await request<{ staff: StaffMember[] }>('/api/merchant/staff');
    return res.staff;
  },

  async addStaff(input: {
    name: string;
    role: StaffRole;
    secret: string;
    email?: string;
  }): Promise<{ id: string }> {
    return request('/api/merchant/staff', { method: 'POST', body: JSON.stringify(input) });
  },

  async profile(): Promise<MerchantProfile> {
    return request('/api/merchant/profile');
  },
};

/* ------------------------------------------------------------------ types */

interface WireCharge {
  code: string;
  amountCents: number;
  payoutCents?: number;
  status: string;
  splitInto: number | null;
  member: { displayName: string } | null;
  raisedBy: string | null;
  raisedByStaffId: string | null;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  resolvedAt: string | null;
}

export interface MerchantCharge {
  code: string;
  amount: number;
  /** Absent for counter staff — payout figures are owner-only, server-side. */
  payout?: number;
  state: ChargeState;
  splitInto: number | null;
  memberName: string | null;
  raisedBy: string | null;
  raisedByStaffId: string | null;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  resolvedAt: string | null;
}

/** Cents on the wire, units in the app — converted once, here. */
const toCharge = (c: WireCharge): MerchantCharge => ({
  code: c.code,
  amount: c.amountCents / 100,
  payout: c.payoutCents == null ? undefined : c.payoutCents / 100,
  state: fromWire(c.status),
  splitInto: c.splitInto,
  memberName: c.member?.displayName ?? null,
  raisedBy: c.raisedBy,
  raisedByStaffId: c.raisedByStaffId,
  createdAt: c.createdAt,
  expiresAt: c.expiresAt,
  openedAt: c.openedAt,
  resolvedAt: c.resolvedAt,
});

export interface Refund {
  id: string;
  chargeCode: string;
  amountCents: number;
  memberCents: number;
  carryKeptCents: number;
  clawbackCents: number;
  state: 'requested' | 'approved' | 'declined' | 'settled';
  requestedByName: string;
  decidedByName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  /** How it was approved. Not equal evidence, so the record keeps which. */
  decidedVia: 'owner_code' | 'owner_device' | null;
}

export interface PayoutPosition {
  owedCents: number;
  clearsBalanceCents: number;
  toBankCents: number;
  /** Null when the pool cap is not yet known. The app says so rather than inventing a figure. */
  availableTodayCents: number | null;
  paid: { id: string; amountCents: number; charges: number; on: string; paidAt: string | null }[];
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  chargesThisMonth: number;
}

export interface MerchantProfile {
  merchant: string;
  name: string;
  category: string | null;
  town: string | null;
  partnerSince: string | null;
  founding: boolean;
  payoutTerms: string;
  /** Owner-only fields. Absent, not null, when a counter writer asks. */
  discountRate?: number | null;
  approvalCapCents?: number | null;
  payoutAccount?: string | null;
  termsSource?: 'chain' | 'unavailable';
}
