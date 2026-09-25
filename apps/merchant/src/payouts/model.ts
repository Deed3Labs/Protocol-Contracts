import type { PayoutPosition } from '../data/apiClient';

/**
 * Payouts, as data — docs/merchant-reference/clear-merchant-payouts.html.
 *
 * Two balances, not one: what the co-op owes (scheduled, released only as far as the pool allows)
 * and what the cash account already holds. The page is drawn from this shape; `fromPosition`
 * fills it from the API, and the reference scenario (Mike's Tire on Tue, Sep 22) fills it for the
 * preview. Card deposits and the drawer have no backend yet, so a live shop's model leaves them out.
 */

export type CycleState = 'free' | 'none' | 'paying';

export interface HistRow {
  id?: string;
  /** "Oct 14", "Wed, Sep 23" */
  t: string;
  next?: boolean;
  /** Not yet begun: its figure is a dash. */
  future?: boolean;
  det: string;
  /** Adds "· Statement" to the detail. */
  statement?: boolean;
  cents: number | null;
  /** A card deposit: tapping it shows how the processing splits. */
  card?: { salesCents: number; stripeCents: number; clearCents: number };
}

export interface PayoutsModel {
  /** Cash account plus released: movable now. Null when a balance can't be read. */
  readyCents: number | null;
  cashCents: number | null;
  releasedCents: number | null;
  scheduledCents: number;
  owedCents: number;
  /** "Oct 14"; null when nothing is scheduled. */
  on: string | null;
  /** "14th" */
  dayOrdinal: string;
  daysLeft: number | null;
  cycle: CycleState;
  /** On payout day: what left this morning, what moved early, when it lands. */
  paying?: { cents: number; movedEarlyCents: number; days: number; arrivesBy: string };
  bank: string | null;
  clear: HistRow[];
  card: HistRow[];
  /** "Oct 14 so far": the next payout's charges, fees and what it pays. */
  made?: { chargesCents: number; feesCents: number; paidCents: number };
  drawer?: { inDrawerCents: number; toBankCents: number; tipsCents: number; tipsWho: string; from: string; deposited?: string };
}

const short = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export function fromPosition(p: PayoutPosition, bank: string | null, now = new Date()): PayoutsModel {
  const on = p.nextPayoutOn ? short(p.nextPayoutOn) : null;
  const daysLeft = p.nextPayoutOn ? Math.max(0, Math.ceil((Date.parse(p.nextPayoutOn) - now.getTime()) / 86400000)) : null;
  const released = p.releasedReadyCents;
  return {
    readyCents: p.readyToWithdrawCents,
    cashCents: p.cashAccountCents,
    releasedCents: released,
    scheduledCents: p.scheduledCents,
    owedCents: p.owedCents,
    on,
    dayOrdinal: p.nextPayoutOn ? ordinal(new Date(p.nextPayoutOn).getDate()) : '—',
    daysLeft,
    cycle: (released ?? 0) > 0 ? 'free' : 'none',
    bank,
    clear: [
      ...(on ? [{ t: on, next: true, det: 'This month’s charges so far', cents: p.owedCents }] : []),
      ...p.paid.map((x) => ({
        id: x.id,
        t: short(x.on),
        det: `${x.charges} charges${bank ? ` · ${bank}` : ''}`,
        statement: true,
        cents: x.amountCents,
      })),
    ],
    card: [],
  };
}

/** Mike's Tire, as the reference draws it. */
export const REFERENCE: PayoutsModel = {
  readyCents: 301240,
  cashCents: 61240,
  releasedCents: 240000,
  scheduledCents: 181891,
  owedCents: 421891,
  on: 'Oct 14',
  dayOrdinal: '14th',
  daysLeft: 22,
  cycle: 'free',
  bank: 'Chase ••4417',
  clear: [
    { t: 'Nov 14', future: true, det: 'For October’s charges, from Oct 1', cents: null },
    { t: 'Oct 14', next: true, det: 'September’s charges, 31 so far', cents: 421891 },
    { id: 'sep', t: 'Sep 14', det: 'August’s 22 charges · Chase ••4417', statement: true, cents: 311840 },
  ],
  card: [
    {
      t: 'Wed, Sep 23',
      next: true,
      det: 'Tuesday’s cards · 1 charge, less $25.66 card processing · to Chase ••4417',
      cents: 91186,
      card: { salesCents: 93752, stripeCents: 2536, clearCents: 30 },
    },
  ],
  made: { chargesCents: 429592, feesCents: 7701, paidCents: 421891 },
  drawer: { inDrawerCents: 15000, toBankCents: 5300, tipsCents: 1000, tipsWho: 'Jen, card tip, with the next payroll', from: 'From Tuesday’s close' },
};

export const NONE: PayoutsModel = { ...REFERENCE, cycle: 'none' };

export const PAYING: PayoutsModel = {
  ...REFERENCE,
  cycle: 'paying',
  paying: { cents: 181891, movedEarlyCents: 240000, days: 3, arrivesBy: 'Oct 17' },
  drawer: { ...REFERENCE.drawer!, deposited: 'Deposited Wed, Sep 23 by Mike' },
};

/** A year on: more payouts than the cell holds. */
export const YEAR_ON: PayoutsModel = {
  ...REFERENCE,
  clear: [
    { t: 'Oct 14', next: true, det: 'September’s charges, 58 so far', cents: 613302 },
    { id: 'y1', t: 'Sep 14', det: 'August’s 61 charges', statement: true, cents: 588410 },
    { id: 'y2', t: 'Aug 14', det: 'July’s 64 charges', statement: true, cents: 640275 },
    { id: 'y3', t: 'Jul 14', det: 'June’s 52 charges', statement: true, cents: 521030 },
    { id: 'y4', t: 'Jun 14', det: 'May’s 49 charges', statement: true, cents: 498800 },
    ...['May 14', 'Apr 14', 'Mar 14', 'Feb 14', 'Jan 14', 'Dec 14', 'Nov 14', 'Oct 14'].map((t, i) => ({
      id: `y${5 + i}`,
      t,
      det: 'Earlier charges',
      statement: true,
      cents: 450000 - i * 21000,
    })),
  ],
  card: [],
  made: { chargesCents: 624490, feesCents: 11188, paidCents: 613302 },
};

/** Five payouts to a page, as the reference's year-on frame. */
export const HIST_PAGE = 5;
