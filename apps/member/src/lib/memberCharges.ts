import type { MemberCharge } from '@/utils/apiClient';
import type { ActivityRow } from './clearModel';

/*
 * A member's shop charges, as the Charges page, Send and Activity show them.
 *
 * The alert is one way in and it doesn't last: it's cleared, the app is closed, the phone is put
 * away at the counter. So every charge they've had is kept findable here, whatever became of it,
 * and a waiting one always leads back to approving it (/c/<code>).
 */

export type ChargeState = 'waiting' | 'paying' | 'paidNow' | 'overTime' | 'declined' | 'expired' | 'cancelled' | 'refunded' | 'disputed';

export function chargeState(c: MemberCharge): ChargeState {
  switch (c.status) {
    case 'pending':
      return 'waiting';
    case 'resolving':
      return c.payingNow ? 'paying' : 'waiting';
    case 'approved':
      return c.paidNow ? 'paidNow' : 'overTime';
    default:
      return c.status;
  }
}

/** What the row says about it, in the member's words. */
export function chargeLabel(c: MemberCharge): string {
  const s = chargeState(c);
  switch (s) {
    case 'waiting':
      return 'Waiting on you';
    case 'paying':
      return 'Paying now';
    case 'paidNow':
      return 'Paid now';
    case 'overTime':
      return c.splitInto && c.splitInto > 1 ? `Over time · ${c.splitInto} payments` : 'Next cycle';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled by the shop';
    case 'refunded':
      return 'Refunded';
    case 'disputed':
      return 'In dispute';
  }
}

/** Nothing was charged: declined, expired, or withdrawn by the shop. Shown struck, not counted. */
export const notCharged = (c: MemberCharge) => ['declined', 'expired', 'cancelled'].includes(chargeState(c));
export const isWaiting = (c: MemberCharge) => chargeState(c) === 'waiting';

/** When it last changed: answered, lapsed, or raised. */
export function chargeWhen(c: MemberCharge): number {
  const s = chargeState(c);
  const iso = s === 'waiting' || s === 'paying' ? c.createdAt : s === 'expired' ? c.expiresAt : (c.resolvedAt ?? c.createdAt);
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

// ---- The page's list controls --------------------------------------------------------------------

export type ChargeFilter = 'all' | 'waiting' | 'approved' | 'notCharged' | 'refunded';
export const CHARGE_FILTERS: { id: ChargeFilter; label: string }[] = [
  { id: 'all', label: 'All charges' },
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'approved', label: 'Approved' },
  { id: 'notCharged', label: 'Not charged' },
  { id: 'refunded', label: 'Refunds and disputes' },
];

export type ChargeSort = 'newest' | 'oldest' | 'largest';
export const CHARGE_SORTS: { id: ChargeSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'largest', label: 'Largest' },
];

function matchesFilter(c: MemberCharge, f: ChargeFilter): boolean {
  const s = chargeState(c);
  if (f === 'all') return true;
  if (f === 'waiting') return s === 'waiting' || s === 'paying';
  if (f === 'approved') return s === 'paidNow' || s === 'overTime';
  if (f === 'notCharged') return notCharged(c);
  return s === 'refunded' || s === 'disputed';
}

/** The shop's name, the amount as they'd type it ("50", "$50.00", "50.00"), or the charge's code. */
function matchesQuery(c: MemberCharge, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (c.merchantName.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) return true;
  const typed = q.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(typed)) return false;
  const dollars = (c.amountCents / 100).toFixed(2);
  return dollars.startsWith(typed) || dollars === Number(typed).toFixed(2);
}

export function viewCharges(charges: MemberCharge[], opts: { query?: string; filter?: ChargeFilter; sort?: ChargeSort }): MemberCharge[] {
  const rows = charges.filter((c) => matchesFilter(c, opts.filter ?? 'all') && matchesQuery(c, opts.query ?? ''));
  const sort = opts.sort ?? 'newest';
  return rows.sort((a, b) =>
    sort === 'largest' ? b.amountCents - a.amountCents || chargeWhen(b) - chargeWhen(a) : sort === 'oldest' ? chargeWhen(a) - chargeWhen(b) : chargeWhen(b) - chargeWhen(a),
  );
}

/** Waiting on them first, then the rest newest first: what Send's cell leads with. */
export function latestCharges(charges: MemberCharge[], n: number): MemberCharge[] {
  return [...charges].sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || chargeWhen(b) - chargeWhen(a)).slice(0, n);
}

/** The latest charge waiting on them (the temporary slot's), and how many more there are. */
export function latestWaiting(charges: MemberCharge[]): { charge: MemberCharge; more: number } | null {
  const w = charges.filter(isWaiting).sort((a, b) => chargeWhen(b) - chargeWhen(a));
  return w[0] ? { charge: w[0], more: w.length - 1 } : null;
}

export function waitingSummary(charges: MemberCharge[]): { count: number; cents: number } {
  const w = charges.filter(isWaiting);
  return { count: w.length, cents: w.reduce((s, c) => s + c.amountCents, 0) };
}

/** Today, Yesterday, or "Sep 22", for the list's day sections. */
export function dayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function groupChargesByDay(charges: MemberCharge[], now = new Date()): { day: string; charges: MemberCharge[] }[] {
  const out: { day: string; charges: MemberCharge[] }[] = [];
  for (const c of charges) {
    const day = dayLabel(chargeWhen(c), now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.charges.push(c);
    else out.push({ day, charges: [c] });
  }
  return out;
}

// ---- Activity ------------------------------------------------------------------------------------

/**
 * Charges as Activity rows, for the ones Activity has no other row for.
 *
 * A charge paid now is already there, folded from its transfers (chargePaymentRow), so it isn't
 * listed twice. Over time moves none of the member's own money, so without this the purchase was
 * nowhere in Activity. A waiting charge is a pending row that opens it; one never charged is struck,
 * like a reversed one, and counts towards nothing.
 */
export function chargeActivityRows(charges: MemberCharge[]): { ts: number; row: ActivityRow }[] {
  const out: { ts: number; row: ActivityRow }[] = [];
  for (const c of charges) {
    const s = chargeState(c);
    if (c.paidNow && (s === 'paidNow' || s === 'refunded' || s === 'disputed')) continue;
    const ts = chargeWhen(c);
    const at = new Date(ts);
    const row: ActivityRow = {
      id: `charge-state:${c.code}`,
      name: c.merchantName,
      date: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      datetime: at.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      kind: 'spending',
      source: 'credit',
      amount: -c.amountCents / 100,
      status: chargeLabel(c),
      tagLabel: chargeLabel(c),
      chargeCode: c.code,
    };
    if (s === 'waiting' || s === 'paying') Object.assign(row, { pending: true, pendingLabel: s === 'paying' ? 'Paying' : 'Waiting' });
    if (notCharged(c) || s === 'refunded') Object.assign(row, { reversed: true, reversedLabel: chargeLabel(c) });
    out.push({ ts, row });
  }
  return out;
}
