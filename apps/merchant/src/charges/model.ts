import { isPending, type ChargeState } from '@clear/domain';
import { canVoidOrder, type OrderWithTenders, type Tender } from '@clear/merchant-contracts';
import type { MerchantCharge } from '@/data/apiClient';
import { ago, clockTime, firstName } from '../home/model';

/**
 * Charges, as data — docs/merchant-reference/clear-merchant-charges.html.
 *
 * One row shape for the list whether it came from the API (Clear only, today) or from the
 * reference scenario (Clear, card, cash and split, Mike's Tire on Tue, Sep 22). The list, the
 * Raised today bar and How it was paid are all computed from rows, so the preview and a live shop
 * add up the same way.
 */

export type PayMethod = 'clear' | 'card' | 'cash' | 'split';

export type RowState = 'waiting' | 'confirmed' | 'paid' | 'expired' | 'refunded' | 'refund' | 'declined' | 'cancelled' | 'voided';

export interface ChargeRow {
  id: string;
  /** "Marcus T.", "Walk-in" */
  name: string;
  amountCents: number;
  method: PayMethod;
  state: RowState;
  /** Days ago: 0 today, 1 yesterday. */
  day: number;
  /** "Sun, Sep 20", for a day before yesterday. */
  date?: string;
  /** "2:26pm", and minutes since midnight to sort on. */
  time: string;
  at: number;
  /** First name of whoever raised it, and their id. */
  by: string;
  byId?: string;
  /** Waiting: "sent 2 minutes ago". Clear, paid: "4 payments". Expired: "not approved in 24 hours". */
  note?: string;
  /** Card and cash: "Card ••4242", "Cash"; what was sold for cash; any tip. */
  pay?: string;
  sold?: string;
  tipCents?: number;
}

export const done = (r: ChargeRow) => r.state === 'confirmed' || r.state === 'paid';

// ---- From the API -------------------------------------------------------------------------------

const STATE: Partial<Record<ChargeState, RowState>> = {
  approved: 'confirmed',
  expired: 'expired',
  refunded: 'refunded',
  refund_requested: 'refund',
  refund_declined: 'confirmed',
  declined: 'declined',
  cancelled: 'cancelled',
  disputed: 'confirmed',
};

const dayOf = (iso: string, now = new Date()) => {
  const a = new Date(iso);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(now) - start(a)) / 86400000);
};

export function rowFromApi(c: MerchantCharge, now = Date.now()): ChargeRow {
  const d = new Date(c.createdAt);
  const pending = isPending(c.state);
  const state: RowState = pending ? 'waiting' : (STATE[c.state] ?? 'cancelled');
  const hours = Math.round((Date.parse(c.expiresAt) - Date.parse(c.createdAt)) / 3600000);
  const note = pending
    ? c.openedAt
      ? `opened ${ago(c.openedAt, now)}`
      : `sent ${ago(c.createdAt, now)}`
    : state === 'expired'
      ? `not approved in ${hours} hours`
      : c.splitInto === null
        ? undefined
        : c.splitInto === 1
          ? 'paid now'
          : `${c.splitInto} payments`;
  const day = dayOf(c.createdAt, new Date(now));
  return {
    id: c.code,
    name: c.memberName ?? 'A customer',
    amountCents: Math.round(c.amount * 100),
    method: 'clear',
    state,
    day,
    date: day > 1 ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : undefined,
    time: clockTime(c.createdAt),
    at: d.getHours() * 60 + d.getMinutes() - day * 1440,
    by: c.raisedBy ? firstName(c.raisedBy) : '—',
    byId: c.raisedByStaffId ?? undefined,
    note,
  };
}

// ---- Card, cash and split sales, from the orders ---------------------------------------------------

/** A tender that took money (or holds it, for a card before capture). */
export const took = (t: Tender) => ['approved', 'authorised', 'captured', 'partly_refunded', 'refunded'].includes(t.status);

const cardLabel = (t: Tender) => `${t.cardBrand ? t.cardBrand[0]!.toUpperCase() + t.cardBrand.slice(1) : 'Card'} ••${t.cardLast4 ?? '····'}`;

/**
 * A sale on the Charges list: an order that took card or cash. Its Clear part, if any, is on the
 * list already as a Clear charge, so this row is the card and cash part, and each dollar is listed
 * once. A Clear-only order is only its Clear charge; an order still being paid isn't a sale yet.
 */
export function rowFromOrder(o: OrderWithTenders, nameOf: (staffId: string) => string, now = Date.now()): ChargeRow | null {
  const voided = o.status === 'voided';
  const legs = o.tenders.filter((t) => t.method !== 'clear' && (voided ? true : took(t)));
  if (!legs.length) return null;
  const methods = new Set(legs.map((t) => t.method));
  const withClear = o.tenders.some((t) => t.method === 'clear' && took(t));
  const method: PayMethod = methods.size > 1 || withClear ? 'split' : (legs[0]!.method as PayMethod);
  const d = new Date(o.createdAt);
  const day = dayOf(o.createdAt, new Date(now));
  return {
    id: o.id,
    name: o.customer ?? 'Walk-in',
    amountCents: legs.reduce((s, t) => s + t.amountCents + t.tipCents, 0),
    method,
    state: voided ? 'voided' : o.status === 'refunded' ? 'refunded' : 'paid',
    day,
    date: day > 1 ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : undefined,
    time: clockTime(o.createdAt),
    at: d.getHours() * 60 + d.getMinutes() - day * 1440,
    by: firstName(nameOf(o.raisedBy)),
    byId: o.raisedBy,
    note: o.status === 'partly_refunded' ? 'part refunded' : undefined,
    pay: method === 'split' ? 'Split' : method === 'card' ? cardLabel(legs[0]!) : 'Cash',
    sold: o.lines[0]?.name,
    tipCents: legs.reduce((s, t) => s + t.tipCents, 0) || undefined,
  };
}

// ---- Raised today, and how it was paid -----------------------------------------------------------

export interface RaisedToday {
  totalCents: number;
  ok: { cents: number; n: number };
  wait: { cents: number; n: number };
  exp: { cents: number; n: number };
  /** Any card or cash today: the bar says paid rather than approved. */
  paid: boolean;
}

const tally = (rows: ChargeRow[]) => ({ cents: rows.reduce((t, r) => t + r.amountCents, 0), n: rows.length });

export function raisedToday(rows: ChargeRow[]): RaisedToday {
  const today = rows.filter((r) => r.day === 0);
  const ok = tally(today.filter(done));
  const wait = tally(today.filter((r) => r.state === 'waiting'));
  const exp = tally(today.filter((r) => r.state === 'expired'));
  return { totalCents: ok.cents + wait.cents + exp.cents, ok, wait, exp, paid: today.some((r) => r.method !== 'clear') };
}

/** "40% approved so far", "72% approved", "All approved", "No charges yet" */
export function shareLine(t: RaisedToday): string {
  const word = t.paid ? 'paid' : 'approved';
  if (!t.totalCents) return 'No charges yet';
  if (t.ok.cents === t.totalCents) return `All ${word}`;
  const pct = Math.round((t.ok.cents / t.totalCents) * 100);
  return `${pct}% ${word}${t.wait.n ? ' so far' : ''}`;
}

export function byMethod(rows: ChargeRow[]): Record<'clear' | 'card' | 'cash', { cents: number; n: number }> {
  const paid = rows.filter((r) => r.day === 0 && done(r));
  const of = (m: PayMethod) => tally(paid.filter((r) => r.method === m));
  return { clear: of('clear'), card: of('card'), cash: of('cash') };
}

// ---- The list ----------------------------------------------------------------------------------

export type When = 'today' | 'yesterday' | 'both' | 'month';
export type Status = 'all' | 'waiting' | 'confirmed' | 'expired' | 'refunded';
export type SortBy = 'newest' | 'oldest' | 'largest' | 'waiting';

export interface Filters {
  when: When;
  status: Status;
  method: PayMethod | 'any';
  by: string | 'anyone';
}

export function filterRows(rows: ChargeRow[], f: Filters): ChargeRow[] {
  return rows.filter((r) => {
    if (f.when === 'today' && r.day !== 0) return false;
    if (f.when === 'yesterday' && r.day !== 1) return false;
    if (f.when === 'both' && r.day > 1) return false;
    if (f.status === 'waiting' && r.state !== 'waiting') return false;
    if (f.status === 'confirmed' && !done(r)) return false;
    if (f.status === 'expired' && r.state !== 'expired') return false;
    if (f.status === 'refunded' && r.state !== 'refunded' && r.state !== 'refund') return false;
    if (f.method !== 'any' && r.method !== f.method) return false;
    if (f.by !== 'anyone' && r.by !== f.by) return false;
    return true;
  });
}

/** Waiting first, whatever time it was raised: the only rows with anything to do. Then the sort. */
export function sortRows(rows: ChargeRow[], s: SortBy): ChargeRow[] {
  const key = (r: ChargeRow) => (s === 'oldest' ? r.at : s === 'largest' ? -r.amountCents : -r.at);
  return rows.slice().sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || key(a) - key(b));
}

export interface Section {
  key: string;
  label: string;
  /** The right-hand figure: "2 · $1,350.00", or "$1,240.00 confirmed · 1 expired". */
  n?: number;
  cents: number;
  expired: number;
  past: boolean;
  rows: ChargeRow[];
}

/** Waiting, then one group a day. Only Clear can wait, so only Clear has a Waiting group. */
export function sections(rows: ChargeRow[], paidWord: boolean): Section[] {
  const out: Section[] = [];
  const waiting = rows.filter((r) => r.state === 'waiting');
  if (waiting.length) out.push({ key: 'waiting', label: 'Waiting', n: waiting.length, cents: tally(waiting).cents, expired: 0, past: false, rows: waiting });
  const rest = rows.filter((r) => r.state !== 'waiting');
  const days = [...new Set(rest.map((r) => r.day))];
  for (const d of days) {
    const its = rest.filter((r) => r.day === d);
    const ok = its.filter(done);
    out.push({
      key: `d${d}`,
      label: d === 0 ? (paidWord ? 'Paid today' : 'Confirmed today') : d === 1 ? 'Yesterday' : (its[0].date ?? ''),
      n: d === 0 ? ok.length : undefined,
      cents: tally(ok).cents,
      expired: its.filter((r) => r.state === 'expired').length,
      past: d > 0,
      rows: its,
    });
  }
  return out;
}

/** Seven to a page, as the reference's list: one screen of a tablet. */
export const PAGE = 7;

// ---- The reference scenario --------------------------------------------------------------------

const m = (h: number, min: number) => h * 60 + min;

const NINA: ChargeRow = { id: 'nina', name: 'Nina P.', amountCents: 41000, method: 'clear', state: 'waiting', day: 0, time: '2:26pm', at: m(14, 26), by: 'Jen', byId: 'jen', note: 'sent 2 minutes ago' };
const DANA: ChargeRow = { id: 'dana', name: 'Dana R.', amountCents: 94000, method: 'clear', state: 'waiting', day: 0, time: '2:14pm', at: m(14, 14), by: 'Jen', byId: 'jen', note: 'opened 6 minutes ago' };
export const MARCUS: ChargeRow = { id: 'marcus', name: 'Marcus T.', amountCents: 41200, method: 'clear', state: 'confirmed', day: 0, time: '11:02am', at: m(11, 2), by: 'Jen', byId: 'jen', note: '4 payments' };
const PRIYA: ChargeRow = { id: 'priya', name: 'Priya S.', amountCents: 18800, method: 'clear', state: 'confirmed', day: 0, time: '9:47am', at: m(9, 47), by: 'Luis', byId: 'luis', note: 'paid now' };
const ANA: ChargeRow = { id: 'ana', name: 'Ana V.', amountCents: 30000, method: 'clear', state: 'confirmed', day: 0, time: '8:30am', at: m(8, 30), by: 'Luis', byId: 'luis', note: '2 payments' };
const RAY: ChargeRow = { id: 'ray', name: 'Ray C.', amountCents: 124000, method: 'clear', state: 'confirmed', day: 1, time: '4:12pm', at: m(16, 12) - 1440, by: 'Luis', byId: 'luis', note: '2 payments' };
const TOM: ChargeRow = { id: 'tom', name: 'Tom B.', amountCents: 31000, method: 'clear', state: 'expired', day: 1, time: '1:40pm', at: m(13, 40) - 1440, by: 'Jen', byId: 'jen', note: 'not approved in 24 hours' };

/**
 * The rest of September, so "This month" counts 31 as the reference does. Not drawn by it: the
 * pager's later pages.
 */
const EARLIER: ChargeRow[] = (() => {
  const names = ['Leo K.', 'Maya D.', 'Sam W.', 'Rosa L.', 'Ivan P.', 'Chen H.', 'Beth A.', 'Omar F.'];
  const amounts = [18800, 41200, 9600, 30000, 124000, 56400, 21400, 75600];
  const by = ['Jen', 'Luis'];
  return Array.from({ length: 24 }, (_, i) => {
    const day = 2 + Math.floor(i / 2);
    const date = new Date(2026, 8, 22 - day);
    return {
      id: `sep${i}`,
      name: names[i % names.length],
      amountCents: amounts[i % amounts.length],
      method: 'clear' as const,
      state: 'confirmed' as const,
      day,
      date: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      time: i % 2 ? '3:15pm' : '10:40am',
      at: (i % 2 ? m(15, 15) : m(10, 40)) - day * 1440,
      by: by[i % 2],
      byId: by[i % 2].toLowerCase(),
      note: i % 3 ? '4 payments' : 'paid now',
    };
  });
})();

export const REFERENCE_ROWS: ChargeRow[] = [NINA, DANA, MARCUS, PRIYA, ANA, RAY, TOM, ...EARLIER];

/** Late in the day, every way to pay. The valve stems are $38.79 (DECISIONS.md). */
export const LATE_ROWS: ChargeRow[] = [
  { ...NINA, note: 'sent 3 hours ago' },
  { ...DANA, note: 'opened' },
  { id: 'card', name: 'Walk-in', amountCents: 93752, method: 'card', state: 'paid', day: 0, time: '4:41pm', at: m(16, 41), by: 'Jen', byId: 'jen', pay: 'Card ••4242', tipCents: 1000 },
  { id: 'patch', name: 'Walk-in', amountCents: 2300, method: 'cash', state: 'paid', day: 0, time: '1:10pm', at: m(13, 10), by: 'Luis', byId: 'luis', pay: 'Cash', sold: 'patch', tipCents: 500 },
  { id: 'stems', name: 'Walk-in', amountCents: 3879, method: 'cash', state: 'paid', day: 0, time: '12:40pm', at: m(12, 40), by: 'Jen', byId: 'jen', pay: 'Cash', sold: 'valve stems' },
  { ...MARCUS, pay: 'Clear' },
  { ...PRIYA, pay: 'Clear' },
  { ...ANA, pay: 'Clear' },
];

export const TEAM_NAMES = ['Jen', 'Luis', 'Mike'];

// ---- A charge, opened ----------------------------------------------------------------------------

/** A Clear charge's money and plan, as the opened charge shows them. */
export interface ClearDetail {
  payoutCents: number | null;
  feeCents: number | null;
  /** "2.0%" */
  rate: string | null;
  /** "Dec 14", or null until it is paid out. */
  paidOut: string | null;
  splitInto: number | null;
  perCycleCents: number | null;
  /** Cycles the customer has cleared, when known. */
  cleared?: number;
}

export const MARCUS_DETAIL: ClearDetail = {
  payoutCents: 40376,
  feeCents: 824,
  rate: '2.0%',
  paidOut: 'Dec 14',
  splitInto: 4,
  perCycleCents: 10815,
  cleared: 1,
};

export interface Leg {
  method: 'card' | 'cash' | 'clear';
  /** "Cash", "Visa ••4242" */
  t: string;
  det: string;
  cents: number;
}

/** A card, cash or split sale: what was sold and how it was paid. */
export interface Sale {
  id: string;
  name: string;
  /** "Sun, Sep 20 · 3:20pm · Luis" */
  when: string;
  count: number;
  totalCents: number;
  lines: { t: string; cents: number }[];
  goodsCents: number;
  labourCents: number;
  taxCents: number;
  tipCents: number;
  legs: Leg[];
  /** "Printed", "Texted". Absent when it isn't known. */
  receipt?: string;
  /** "Settled Sunday night". Absent with no card part. */
  settled?: string;
  /** Settled, so only a refund remains. */
  refundOnly: boolean;
  /** "Sales tax · 7.75% on parts"; "Sales tax" when the rate isn't to hand. */
  taxLabel?: string;
  /** A live sale's own ids, for its void, tip and refund. */
  live?: { order: OrderWithTenders };
}

export const SPLIT_SALE: Sale = {
  id: 'split',
  name: 'Walk-in',
  when: 'Sun, Sep 20 · 3:20pm · Luis',
  count: 3,
  totalCents: 22779,
  lines: [
    { t: '1 × Goodyear Assurance · disposal', cents: 16500 },
    { t: '1 × Mount and balance', cents: 2500 },
    { t: '1 × Tire rotation', cents: 2500 },
  ],
  goodsCents: 16500,
  labourCents: 5000,
  taxCents: 1279,
  tipCents: 0,
  legs: [
    { method: 'cash', t: 'Cash', det: '3:18pm · $20.00 change', cents: 20000 },
    { method: 'card', t: 'Visa ••4242', det: '3:20pm · contactless', cents: 2779 },
  ],
  receipt: 'Printed',
  settled: 'Settled Sunday night',
  refundOnly: true,
};

/** Today's card sale: the New Charge reference's cart, with Jen's $10.00 tip. */
export const CARD_SALE: Sale = {
  id: 'card',
  name: 'Walk-in',
  when: 'Today · 4:41pm · Jen',
  count: 9,
  totalCents: 93752,
  lines: [
    { t: '4 × Michelin Defender2', cents: 75600 },
    { t: '4 × Mount and balance', cents: 10000 },
    { t: '1 × Valve stems, set of 4', cents: 1200 },
  ],
  goodsCents: 76800,
  labourCents: 10000,
  taxCents: 5952,
  tipCents: 1000,
  legs: [{ method: 'card', t: 'Visa ••4242', det: '4:41pm · contactless', cents: 93752 }],
  receipt: 'Texted',
  settled: 'Settles tonight',
  refundOnly: false,
};

/**
 * A sale opened: what was sold and how it was paid, from the order and its tenders. It can be
 * voided the same day, before a card on it is captured; after that only a refund remains.
 */
export function saleFromOrder(o: OrderWithTenders, nameOf: (staffId: string) => string, today: string): Sale {
  const legs = o.tenders.filter(took);
  const card = legs.find((t) => t.method === 'card');
  const sameDay = o.businessDate === today;
  const d = new Date(o.createdAt);
  const day = sameDay ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const net = (l: OrderWithTenders['lines'][number]) => l.lineCents - l.discountCents;
  return {
    id: o.id,
    name: o.customer ?? 'Walk-in',
    when: `${day} · ${clockTime(o.createdAt)} · ${firstName(nameOf(o.raisedBy))}`,
    count: o.lines.reduce((s, l) => s + l.quantity, 0),
    totalCents: o.totalCents + o.tipCents,
    lines: o.lines.map((l) => ({ t: `${l.quantity} × ${l.name}${l.options.length ? ` · ${l.options.map((x) => x.name.toLowerCase()).join(', ')}` : ''}`, cents: net(l) })),
    goodsCents: o.lines.filter((l) => l.taxKind !== 'labour').reduce((s, l) => s + net(l), 0),
    labourCents: o.lines.filter((l) => l.taxKind === 'labour').reduce((s, l) => s + net(l), 0),
    taxCents: o.taxCents,
    tipCents: o.tipCents,
    legs: legs.map((t) => ({
      method: t.method,
      t: t.method === 'card' ? cardLabel(t) : t.method === 'cash' ? 'Cash' : 'Clear',
      det: `${clockTime(t.createdAt)}${t.method === 'cash' && t.changeCents ? ` · ${usdOf(t.changeCents)} change` : ''}${t.refundedCents ? ` · ${usdOf(t.refundedCents)} refunded` : ''}`,
      cents: t.amountCents + t.tipCents,
    })),
    settled: card ? (card.status === 'authorised' ? 'Settles when the day is closed' : 'Settled') : undefined,
    refundOnly: !(sameDay && canVoidOrder({ totalCents: o.totalCents, voided: o.status === 'voided' }, o.tenders).ok),
    taxLabel: 'Sales tax',
    live: { order: o },
  };
}

const usdOf = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
