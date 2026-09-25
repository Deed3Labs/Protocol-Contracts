import { countsAsVolume, dollars, type StaffRole } from '@clear/domain';
import type { MerchantCharge, PayoutPosition, StaffMember } from '@/data/apiClient';

/**
 * What Home shows, as data.
 *
 * Home is drawn from docs/merchant-reference/clear-merchant-home.html. The view only draws this;
 * `fromApi` fills it from what the API has today, and home/seed.ts fills it with the reference
 * scenario for the preview and the gallery. Anything the API cannot answer yet (the shift clock,
 * the drawer, Close the day) is left out of `fromApi` rather than invented, and the view draws
 * nothing in its place.
 */

export const usd = (cents: number) => dollars(cents / 100);

export interface WaitingCharge {
  id: string;
  name: string;
  amountCents: number;
  /** The customer has opened it on their phone. */
  opened: boolean;
  /** "2 minutes ago" */
  ago: string;
  /** First name of whoever raised it. */
  by?: string;
}

export interface ConfirmedCharge {
  id: string;
  name: string;
  /** "11:02am" */
  time: string;
  by: string;
  amountCents: number;
}

export interface Payout {
  totalCents: number;
  availableCents: number;
  settlingCents: number;
  /** "Oct 14" */
  landsOn: string;
  /** "14th" */
  dayOrdinal: string;
  /** Nothing paid out yet, so the cell explains how the first one works. */
  first: boolean;
}

export interface PersonTally {
  name: string;
  confirmed: number;
  waiting: number;
  amountCents: number;
}

/** The owner-only line about who is and is not offering Clear. */
export interface WriterTip {
  /** "Jen has raised both of today's charges" */
  fact: string;
  /** "Luis" */
  other: string;
}

export interface SetupItem {
  key: string;
  t: string;
  det: string;
  action: string;
}

export interface ShiftClock {
  /** "4h 12m" */
  onFor: string;
  /** "3h 48m" */
  left: string;
  /** "8:04am" */
  since: string;
  /** "4:00pm" */
  until: string;
  /** Booked hours, one block each. */
  hours: number;
  /** Hours done, fractional: 4.2 fills four blocks and a fifth to 20%. */
  done: number;
  /** On a break: how long, and since when. */
  onBreak?: { for: string; from: string };
}

export interface ShiftCell {
  clock?: ShiftClock;
  raised: number;
  shopRaised: number;
  drawer?: { startCents: number; cashInCents: number };
  /** The one row that is a job: a charge of theirs someone has not opened. */
  job?: { name: string; amountCents: number; ago: string; opened: boolean };
}

export interface ClosingUp {
  closesAt: string;
  drawer: string;
  stillOn?: string;
  waiting?: string;
}

export type Stage = 'dayOne' | 'early' | 'running';

export interface HomeModel {
  role: StaffRole;
  stage: Stage;
  confirmedCents: number;
  confirmedCount: number;
  waiting: WaitingCharge[];
  confirmed: ConfirmedCharge[];
  /** Owners and managers only. */
  payout?: Payout;
  byPerson?: PersonTally[];
  tip?: WriterTip;
  setup?: SetupItem[];
  /** Counter shifts only. */
  shift?: ShiftCell;
  /** Owners and managers, from half an hour before closing. */
  closing?: ClosingUp;
  /** Owners and managers: stock under its reorder line (Inventory reference). */
  runningLow?: import('@/inventory/model').InvItem[];
}

export const sees = (role: StaffRole) => role === 'owner' || role === 'manager';

// ---- Words --------------------------------------------------------------------------------------

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const inWords = (n: number) => WORDS[n] ?? String(n);

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** "11:02am" */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}`;
}

/** "2 minutes ago", "an hour ago", "3 hours ago" */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return 'a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? 'an hour ago' : `${hrs} hours ago`;
}

// ---- From the API ---------------------------------------------------------------------------

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/**
 * Home from what the API answers today: today's charges, the payout position and the roster.
 *
 * Not here, because nothing answers them yet: the shift clock and breaks, the drawer, the Closing
 * up card and the setup checklist's state. Those arrive with the backend's drawer and shift work
 * (card-processing prompt, Phase 7); until then Home simply does not draw them for a live shop.
 */
export function fromApi(input: {
  role: StaffRole;
  staffId: string;
  charges: MerchantCharge[];
  position: PayoutPosition | null;
  staff: StaffMember[] | null;
}): HomeModel {
  const { role, staffId, position, staff } = input;
  const today = input.charges.filter((c) => isToday(c.createdAt));
  const cents = (c: MerchantCharge) => Math.round(c.amount * 100);

  const waitingRaw = today.filter((c) => c.state === 'waiting' || c.state === 'resolving');
  const confirmedRaw = today.filter((c) => c.state === 'approved');

  const waiting: WaitingCharge[] = waitingRaw.map((c) => ({
    id: c.code,
    name: c.memberName ?? 'A customer',
    amountCents: cents(c),
    opened: !!c.openedAt,
    ago: ago(c.openedAt ?? c.createdAt),
    by: c.raisedBy ? firstName(c.raisedBy) : undefined,
  }));
  const confirmed: ConfirmedCharge[] = confirmedRaw.map((c) => ({
    id: c.code,
    name: c.memberName ?? 'A customer',
    time: clockTime(c.resolvedAt ?? c.createdAt),
    by: c.raisedBy ? firstName(c.raisedBy) : '—',
    amountCents: cents(c),
  }));
  const confirmedCents = confirmed.reduce((s, c) => s + c.amountCents, 0);
  const raisedToday = today.filter((c) => countsAsVolume(c.state));
  const stage: Stage = raisedToday.length === 0 ? 'dayOne' : waiting.length ? 'running' : 'early';

  const model: HomeModel = { role, stage, confirmedCents, confirmedCount: confirmed.length, waiting, confirmed };

  if (sees(role) && position) {
    const available = position.readyToWithdrawCents ?? position.releasedReadyCents ?? 0;
    const total = position.owedCents;
    const on = position.nextPayoutOn ? new Date(position.nextPayoutOn) : null;
    if (on) {
      model.payout = {
        totalCents: total,
        availableCents: Math.min(available, total),
        settlingCents: Math.max(0, total - available),
        landsOn: on.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dayOrdinal: ordinal(on.getDate()),
        first: position.paid.length === 0,
      };
    }
  }

  if (sees(role) && staff) {
    model.byPerson = staff
      .filter((s) => s.active)
      .map((s) => {
        const mine = raisedToday.filter((c) => c.raisedByStaffId === s.id);
        return {
          name: s.name,
          confirmed: mine.filter((c) => c.state === 'approved').length,
          waiting: mine.filter((c) => c.state !== 'approved').length,
          amountCents: mine.filter((c) => c.state === 'approved').reduce((t, c) => t + cents(c), 0),
        };
      });

    // One writer raising everything while a colleague raises nothing, early in the day: the line
    // an owner most needs and only Clear can see. True only while it is true.
    const writers = [...new Set(raisedToday.map((c) => c.raisedByStaffId).filter(Boolean))];
    const idle = staff.filter((s) => s.active && s.role !== 'owner' && !writers.includes(s.id));
    const lead = raisedToday.find((c) => c.raisedByStaffId === writers[0])?.raisedBy;
    if (stage === 'early' && writers.length === 1 && idle.length && lead) {
      const n = raisedToday.length;
      model.tip = {
        fact: `${firstName(lead)} has raised ${n === 1 ? 'today’s only charge' : n === 2 ? 'both of today’s charges' : `all ${inWords(n)} of today’s charges`}`,
        other: firstName(idle[0].name),
      };
    }
  }

  if (!sees(role)) {
    const mine = raisedToday.filter((c) => c.raisedByStaffId === staffId);
    const job = waitingRaw.find((c) => c.raisedByStaffId === staffId && !c.openedAt);
    model.shift = {
      raised: mine.length,
      shopRaised: raisedToday.length,
      job: job
        ? { name: job.memberName ?? 'A customer', amountCents: cents(job), ago: ago(job.createdAt), opened: false }
        : undefined,
    };
  }

  return model;
}
