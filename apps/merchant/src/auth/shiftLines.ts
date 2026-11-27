import type { StaffRole } from '@clear/domain';
import type { ShiftPerson } from './screens';

/**
 * What the sign-in, PIN and lock screens say under a name, from the roster:
 *
 *   picker  "Until 4:00pm today" (or "Hours ended 4:00pm today" once it has) · "No hours set" ·
 *           "Not on today" · "First shift"
 *   PIN     "8:00am – 4:00pm"
 *   lock    "8:00am – 4:00pm", "Started 8:04am · 2 waiting"
 *
 * Times come from the server as the shop's own "HH:MM" (today's booked hours, from Staff).
 */

export interface RosterEntry {
  id: string;
  name: string;
  role: StaffRole;
  pinSet: boolean;
  today?: { from: string; to: string } | null;
  hoursSet?: boolean;
  startedAt?: string | null;
  waiting?: number;
}

/** "16:00" → "4:00pm" */
export function twelveHour(hm: string): string {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** A moment, as the tablet's clock reads it: "8:04am". */
export function clockAt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
}

/** Whether today's "HH:MM" has gone by on the tablet's clock. */
const gone = (hm: string, now: number) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  return t.getTime() <= now;
};

export function toShiftPerson(r: RosterEntry, now = Date.now()): ShiftPerson & { startedAt: string | null; waiting: number } {
  const first = !r.pinSet;
  const span = r.today ? `${twelveHour(r.today.from)} – ${twelveHour(r.today.to)}` : undefined;
  // "Until 4:00pm" at 11pm says they're still due on; past the end, the booking is history.
  const hours = r.today
    ? `${gone(r.today.to, now) ? 'Hours ended' : 'Until'} ${twelveHour(r.today.to)} today`
    : r.hoursSet === undefined
      ? undefined
      : r.hoursSet
        ? 'Not on today'
        : 'No hours set';
  return { id: r.id, name: r.name, role: r.role, first, hours, span, startedAt: r.startedAt ?? null, waiting: r.waiting ?? 0 };
}
