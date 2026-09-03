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

/**
 * The enrolled device — reference section 19.
 *
 * Stored separately from the session token, because they are separate facts with separate
 * lifetimes: this says which shop the tablet is and survives until an owner removes it; the
 * session says who is on shift and expires overnight. Ending a shift must not make a tablet forget
 * which shop it belongs to.
 *
 * It is not signing material. Clear's backend holds the merchant org's key and does the signing —
 * so a stolen tablet carries nothing that can move money, and revoking it is a server-side row
 * update that takes effect on the very next request.
 */
const DEVICE_KEY = 'clear.merchant.device';

export class ApiError extends Error {
  // Declared and assigned rather than a constructor parameter property: this app compiles with
  // `erasableSyntaxOnly`, which forbids syntax that emits code rather than just erasing types.
  readonly status: number;
  /** The parsed error body. A 409 from owner sign-in carries the shops to choose between. */
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
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

export function readDeviceToken(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function storeDeviceToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(DEVICE_KEY, token);
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // A tablet that cannot persist cannot stay enrolled; the enrollment screen says so.
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
  const device = readDeviceToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Which tablet this is. Sent on every request, including the ones reached before anyone has
      // signed in, because the roster and the PIN pad are already scoped to one shop.
      ...(device ? { 'X-Clear-Device': device } : {}),
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
    throw new ApiError(message, res.status, body);
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


/* ----------------------------------------------------------------- device */

export interface EnrolledDevice {
  id: string;
  label: string;
  idleLockSeconds: number;
  enrolledAt: string;
  revokedAt: string | null;
  enrolledByName?: string | null;
}

export const api = {
  /**
   * Who is on the counter, for the shift screen.
   *
   * Names and roles only, and reachable before anyone has signed in — the screen exists so a
   * writer picks their own name rather than remembering which of four codes is theirs.
   */
  async roster(): Promise<{ id: string; name: string; role: StaffRole }[]> {
    const res = await request<{ staff: { id: string; name: string; role: StaffRole }[] }>(
      '/api/merchant/roster',
      { method: 'POST', body: '{}' },
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
  async startShift(input: { staffId: string; pin: string }): Promise<SessionResponse> {
    const res = await request<SessionResponse>('/api/merchant/session', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (res.token) storeToken(res.token);
    return res;
  },

  /**
   * Exchange a Privy token for an owner session.
   *
   * Privy says who they are; this says whose shop it is. Both are required — a valid Privy user is
   * not by itself an owner of anything, and the backend checks the staff record before issuing.
   */
  async signInAsOwner(privyToken: string, merchant?: string): Promise<SessionResponse> {
    const res = await request<SessionResponse>('/api/merchant/session/owner', {
      method: 'POST',
      // No merchant on a tablet that is not enrolled yet — that is the entire reason enrollment
      // exists, and the backend resolves the shop from the Privy identity instead. It answers 409
      // with a list only when one account genuinely owns more than one shop.
      body: JSON.stringify(merchant ? { merchant, privyToken } : { privyToken }),
    });
    if (res.token) storeToken(res.token);
    return res;
  },


  /* ----------------------------------------------------------- onboarding */

  /**
   * Bring the shop into existence — reference section 13.
   *
   * The merchant address is NOT sent. It comes back: it is the address of the organization wallet
   * Privy creates, so the registry, the payout destination and Clear's own record name the same
   * thing by construction rather than by an owner pasting it correctly.
   *
   * `signerReady: false` means the wallet exists but Clear cannot yet sign on it. The shop can be
   * signed into and set up; it cannot be paid out of. Worth surfacing rather than hiding, because
   * the owner will otherwise discover it at the first payout.
   */
  async onboard(input: {
    privyToken: string;
    shopName: string;
    ownerName: string;
    ownerPin: string;
    category?: string | null;
    town?: string | null;
  }): Promise<{ merchant: string; walletAddress: string; created: boolean; signerReady: boolean }> {
    return request('/api/merchant/onboarding', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /* --------------------------------------------------------------- device */

  /**
   * What this tablet is, asked on load before anyone signs in.
   *
   * Returns null when the device is not enrolled, which the app must be able to tell apart from
   * signed-out: one shows the enrollment screen, the other the PIN pad. The backend answers 409
   * rather than 401 for exactly that reason — nobody's credentials are wrong.
   *
   * A revoked tablet lands here too, and correctly falls back to enrollment. That is what "remove
   * it any time, from any device" looks like from the tablet's side.
   */
  async currentDevice(): Promise<{ merchant: string; device: EnrolledDevice } | null> {
    if (!readDeviceToken()) return null;
    try {
      return await request<{ merchant: string; device: EnrolledDevice }>('/api/merchant/device');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        storeDeviceToken(null);
        return null;
      }
      throw err;
    }
  },

  /**
   * Enroll this tablet. Needs the owner's session, which is why the enrollment screen sits behind
   * owner sign-in rather than being something a counter writer can reach.
   *
   * The token comes back once and is written straight to storage. No cap is sent: the ceiling is
   * the merchant's, enforced in MerchantRegistry and backstopped by the wallet policy, which is
   * what lets the screen say "enforced by policy, not by this app" honestly.
   */
  async enrollDevice(input: { label: string; idleLockSeconds?: number }): Promise<EnrolledDevice> {
    const res = await request<{ deviceToken: string; device: EnrolledDevice; merchant: string }>(
      '/api/merchant/devices',
      { method: 'POST', body: JSON.stringify(input) },
    );
    storeDeviceToken(res.deviceToken);
    return res.device;
  },

  /** Every tablet this shop has, for Settings. Owner-only. */
  async devices(): Promise<EnrolledDevice[]> {
    const res = await request<{ devices: EnrolledDevice[] }>('/api/merchant/devices');
    return res.devices;
  },

  /** Remove a tablet — from any device, which is what makes a lost one survivable. */
  async revokeDevice(id: string): Promise<void> {
    await request(`/api/merchant/devices/${id}`, { method: 'DELETE' });
  },

  /** Rename, so "Counter tablet" can become "Front desk" without re-enrolling. */
  async renameDevice(id: string, label: string): Promise<void> {
    await request(`/api/merchant/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
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
  /**
   * Raise a charge — reference sections 02 and 03.
   *
   * The amount and nothing else. No member, because entering the amount goes straight to the code
   * and the customer has not said who they are yet; no signature, because the tablet holds no
   * signing material — the enrolled device token is what proves this is a real shop, and the
   * backend reads the shop off that rather than taking it from here.
   */
  async raiseCharge(input: { amountCents: number }): Promise<{
    code: string;
    status: string;
    expiresAt: string;
    amountCents: number;
  }> {
    return request('/api/merchant/charges', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** What the waiting screen polls. Scoped to this device's shop server-side. */
  async watchCharge(code: string): Promise<{
    code: string;
    status: string;
    amountCents: number;
    splitInto: number | null;
    expiresAt: string;
    openedAt: string | null;
    resolvedAt: string | null;
  }> {
    return request(`/api/merchant/charges/${code}`);
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

  /**
   * Ask for what is owed, before the scheduled date.
   *
   * Records a request; it does not move money. The response says what Clear will settle and when
   * the regular payout lands, so the screen can be specific rather than reassuring.
   */
  async requestWithdrawal(input: {
    amountCents: number;
    /** Owed money passes through the cash account; cash-account money goes straight out. */
    source: 'owed' | 'cash';
    destination: 'cash' | 'bank' | 'debit';
  }): Promise<{
    id: string;
    amountCents: number;
    source: 'owed' | 'cash';
    destination: 'cash' | 'bank' | 'debit';
    /** True when the route has the extra hop, which is what the Route line reports. */
    throughCashAccount: boolean;
    nextPayoutOn: string | null;
    cashAccountCents: number | null;
    owedCents: number;
    status: string;
  }> {
    return request('/api/merchant/payouts/withdraw', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

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
  /**
   * Three parallel lines — reference section 07. Owed and held are different kinds of money, and
   * one figure misstates both.
   *
   *   cashAccountCents    already the shop's, movable at any hour
   *   releasedReadyCents  owed, and free today as far as the pool allows
   *   scheduledCents      owed, and arriving on the scheduled payout
   *
   * Nulls mean "not known", never zero: an unreadable balance shown as $0.00 looks like an empty
   * account rather than a failed lookup, and a merchant would act on it.
   */
  cashAccountCents: number | null;
  releasedReadyCents: number | null;
  scheduledCents: number;
  /** What a merchant actually asks for: how much can I get right now. */
  readyToWithdrawCents: number | null;
  /** When the next one lands. Null when none is scheduled — the screen says so rather than guessing. */
  nextPayoutOn: string | null;
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
