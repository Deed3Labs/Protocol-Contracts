import { countsAsVolume, isPending, type StaffRole } from '@clear/domain';
import type { MerchantCharge, MerchantProfile, PayoutPosition, StaffMember } from '../data/apiClient';

/**
 * Overview, as data — docs/merchant-reference/clear-merchant-overview.html.
 *
 * Everything an owner asks at month end: the month as the figure, the trend, one insight, then
 * the slab. It answers and does not manage: every cell ends in a link to the page that does the
 * work. `fromApi` builds it from the charge list, the payout position, the profile and the roster;
 * card, cash, items, tips and the drawer have no backend yet, so the second slab is the preview's.
 */

export interface RecentRow {
  id: string;
  name: string;
  /** "today", "yesterday", "Sep 20" */
  when: string;
  by: string;
  state?: 'waiting' | 'expired';
  cents: number;
}

export interface OverviewModel {
  /** "September" */
  month: string;
  monthCents: number;
  count: number;
  avgCents: number;
  day: number;
  daysInMonth: number;
  /** Against last month, when there is one. */
  vs?: { cents: number; prev: string };
  note: string;
  tip?: { fact: string; det: string };
  recent: RecentRow[];
  owed: { cents: number; on: string | null; freeCents: number | null; cashCents: number | null } | null;
  fees: { t: string; det: string; cents: number }[];
  months: { t: string; det: string; cents: number }[];
  terms: { rate: string; payout: string; cap: string; since: string; founding: boolean };
  people: { name: string; role: StaffRole }[];
  /** The second slab: the merchant API's month (UI Phase 6, step 9), or the reference's in the preview. */
  more?: {
    /** "Since Tuesday" in the reference; "This month" for a live shop. */
    since?: string;
    /** A first-month note under the reports ("The drawer, and so the close, began on Tuesday"). */
    firstNote?: string;
    /** Under the tax line. */
    taxNote?: string;
    paid: { clear: [number, number]; card: [number, number]; cash: [number, number]; note: string };
    items: [string, number, number][];
    discounts: string;
    tips: string;
    taxCents: number;
    eod: { date: string; det: string; cents: number; state: string }[];
  };
}

const monthName = (d: Date, style: 'long' | 'short' = 'long') => d.toLocaleDateString('en-US', { month: style });
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const first = (n: string) => n.split(/\s+/)[0] ?? n;
const cents = (c: MerchantCharge) => Math.round(c.amount * 100);

export function fromApi(input: {
  charges: MerchantCharge[];
  position: PayoutPosition | null;
  profile: MerchantProfile | null;
  staff: StaffMember[] | null;
  now?: Date;
}): OverviewModel {
  const now = input.now ?? new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const counted = input.charges.filter((c) => countsAsVolume(c.state));
  const month = counted.filter((c) => Date.parse(c.createdAt) >= start.getTime());
  const prev = counted.filter((c) => Date.parse(c.createdAt) >= prevStart.getTime() && Date.parse(c.createdAt) < start.getTime());
  const monthCents = month.reduce((t, c) => t + cents(c), 0);
  const prevCents = prev.reduce((t, c) => t + cents(c), 0);
  const more = month.length - prev.length;

  // Who is offering it: the one line an owner most needs and only Clear can see.
  const byWriter = new Map<string, number>();
  month.forEach((c) => c.raisedBy && byWriter.set(c.raisedBy, (byWriter.get(c.raisedBy) ?? 0) + 1));
  const ranked = [...byWriter].sort((a, b) => b[1] - a[1]);

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStart(now);
  const recent = input.charges
    .filter((c) => dayStart(new Date(c.createdAt)) >= today - 86400000)
    .slice(0, 6)
    .map((c) => ({
      id: c.code,
      name: c.memberName ?? 'A customer',
      when: dayStart(new Date(c.createdAt)) === today ? 'today' : 'yesterday',
      by: c.raisedBy ? first(c.raisedBy) : '—',
      state: isPending(c.state) ? ('waiting' as const) : c.state === 'expired' ? ('expired' as const) : undefined,
      cents: cents(c),
    }));

  const fee = (list: MerchantCharge[]) => list.reduce((t, c) => t + (c.payout === undefined ? 0 : cents(c) - Math.round(c.payout * 100)), 0);
  const now1 = month.filter((c) => c.splitInto === 1);
  const over = month.filter((c) => (c.splitInto ?? 0) > 1);
  const pct = (list: MerchantCharge[]) => {
    const a = list.reduce((t, c) => t + cents(c), 0);
    return a ? `${((fee(list) / a) * 100).toFixed(2).replace(/0$/, '')}% of ${usdOf(a)}` : '—';
  };

  const byMonth = new Map<string, { n: number; cents: number; from: Date }>();
  counted.forEach((c) => {
    const d = new Date(c.createdAt);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    const m = byMonth.get(k) ?? { n: 0, cents: 0, from: d };
    m.n += 1;
    m.cents += cents(c);
    if (d < m.from) m.from = d;
    byMonth.set(k, m);
  });

  const p = input.profile;
  const rate = p?.discountRate == null ? '—' : `${(p.discountRate * 100).toFixed(1)}%`;
  return {
    month: monthName(now),
    monthCents,
    count: month.length,
    avgCents: month.length ? Math.round(monthCents / month.length) : 0,
    day: now.getDate(),
    daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    vs: prev.length ? { cents: monthCents - prevCents, prev: monthName(prevStart) } : undefined,
    note: prev.length ? `${WORDS[Math.abs(more)] ?? Math.abs(more)} ${more >= 0 ? 'more' : 'fewer'} charges than ${monthName(prevStart)}` : 'Your first month on Clear',
    tip:
      ranked.length >= 2
        ? {
            fact: `${first(ranked[0][0])} has raised ${ranked[0][1]} of this month’s ${month.length} charges`,
            det: `${first(ranked[ranked.length - 1][0])} has raised ${ranked[ranked.length - 1][1]} · worth fifteen minutes with whoever is behind`,
          }
        : undefined,
    recent,
    owed: input.position
      ? {
          cents: input.position.owedCents,
          on: input.position.nextPayoutOn ? new Date(input.position.nextPayoutOn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null,
          freeCents: input.position.releasedReadyCents,
          cashCents: input.position.cashAccountCents,
        }
      : null,
    fees: [
      { t: 'Clear, paid now', det: pct(now1), cents: fee(now1) },
      { t: 'Clear, over time', det: pct(over), cents: fee(over) },
    ],
    months: [...byMonth.values()]
      .sort((a, b) => a.from.getTime() - b.from.getTime())
      .map((m) => {
        const current = m.from.getMonth() === now.getMonth() && m.from.getFullYear() === now.getFullYear();
        return {
          t: m.from.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          det: `${m.n} charges${current ? ' · in progress' : ''}`,
          cents: m.cents,
        };
      }),
    terms: {
      rate,
      payout: p?.payoutTerms ?? '—',
      cap: p?.approvalCapCents == null ? '—' : usdOf(p.approvalCapCents),
      since: p?.partnerSince ? new Date(p.partnerSince).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—',
      founding: !!p?.founding,
    },
    people: (input.staff ?? []).filter((s) => s.active).map((s) => ({ name: s.name, role: s.role })),
  };
}

const usdOf = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Mike's Tire, September 22, as the reference draws it — with the valve stems at $38.79 and sales
 * tax at $62.31 (DECISIONS.md), which move the month, the average, the change on August, the cash
 * total and the close by the same 21 cents.
 */
export const REFERENCE: OverviewModel = {
  month: 'September',
  monthCents: 529523,
  count: 34,
  avgCents: 15574,
  day: 22,
  daysInMonth: 30,
  vs: { cents: 211319, prev: 'August' },
  note: 'Twelve more charges than August, with card and cash since Tuesday',
  tip: { fact: 'Jen has raised 18 of this month’s 34 charges', det: 'Luis has raised 13 · worth fifteen minutes with whoever is behind' },
  recent: [
    { id: 'dana', name: 'Dana R.', when: 'today', by: 'Jen', state: 'waiting', cents: 94000 },
    { id: 'marcus', name: 'Marcus T.', when: 'today', by: 'Jen', cents: 41200 },
    { id: 'priya', name: 'Priya S.', when: 'today', by: 'Luis', cents: 18800 },
    { id: 'ana', name: 'Ana V.', when: 'today', by: 'Luis', cents: 30000 },
    { id: 'ray', name: 'Ray C.', when: 'yesterday', by: 'Luis', cents: 124000 },
    { id: 'tom', name: 'Tom B.', when: 'yesterday', by: 'Jen', state: 'expired', cents: 31000 },
  ],
  owed: { cents: 421891, on: 'Oct 14', freeCents: 240000, cashCents: 61240 },
  fees: [
    { t: 'Clear, paid now', det: '1.25% of $1,188.00', cents: 1485 },
    { t: 'Clear, over time', det: '2.0% of $3,107.92', cents: 6216 },
    { t: 'Card processing', det: '2.7% + 35¢ a sale', cents: 2566 },
  ],
  months: [
    { t: 'Aug 2026', det: '22 charges, from Aug 12', cents: 318204 },
    { t: 'Sep 2026', det: '34 charges · in progress', cents: 529523 },
  ],
  terms: { rate: '1.25% now · 2.0% over time', payout: 'Paid on the 14th, sooner when the pool allows', cap: '$1,500.00', since: 'August 2026', founding: true },
  people: [
    { name: 'Jen R.', role: 'counter' },
    { name: 'Luis M.', role: 'manager' },
    { name: 'Mike R.', role: 'owner' },
  ],
  more: {
    paid: { clear: [31, 429592], card: [1, 93752], cash: [2, 6179], note: 'Card and cash began on Tuesday' },
    items: [
      ['Michelin Defender2', 4, 75600],
      ['Mount and balance', 4, 10000],
      ['Valve stems, set of 4', 4, 4800],
      ['Quick sales', 1, 1800],
    ],
    since: 'Since Tuesday',
    firstNote: 'The drawer, and so the close, began on Tuesday. Each night adds a row.',
    taxNote: 'Tax is for card and cash sales only',
    discounts: '4 · −$214.60',
    tips: '$15.00 · Jen $10.00, Luis $5.00',
    taxCents: 6231,
    eod: [{ date: 'Tue, Sep 22', det: '6 charges · counted by Luis and Mike', cents: 189931, state: 'Short $3.79 · signed off' }],
  },
};
