import { z } from 'zod';
import { BusinessDate, Id } from './common';
import { OpenSpan } from './shop';

/**
 * Shifts and staff hours (merchant UI, the Staff and Home references).
 *
 * A shift starts when someone's PIN goes in on the tablet, and ends when they press End shift (or
 * a manager ends it for them). Handing the tablet over doesn't end anybody's shift: everyone who
 * started one is "on" until they end it. Breaks pause the clock.
 *
 * Hours are what someone is booked for: their usual week, and a week that differs ("This week
 * only"). Days are Monday first (0) to Sunday (6), in the shop's timezone, like the shop's hours.
 */

/** A person's booked days: one span a day, each day at most once. */
export const StaffHours = z
  .object({ days: z.array(z.object({ day: z.number().int().min(0).max(6), open: OpenSpan })).max(7) })
  .refine((h) => new Set(h.days.map((d) => d.day)).size === h.days.length, 'Each day once');
export type StaffHours = z.infer<typeof StaffHours>;

/**
 * Someone's hours as the sheet edits them. `usual` is what applies this week; `next` a change to
 * their usual hours that starts on Monday; `thisWeek` this week only, when it differs.
 */
export const PersonHours = z.object({
  usual: StaffHours.nullable(),
  next: StaffHours.nullable(),
  thisWeek: StaffHours.nullable(),
  /** The Monday `next` starts on, and the Monday usual hours come back after `thisWeek`. */
  nextWeekOf: BusinessDate,
});
export type PersonHours = z.infer<typeof PersonHours>;

/**
 * "Every week" changes the usual hours from next Monday (from this week for someone who has none);
 * "This week only" changes this week. `weekOf`, a date in the week the Staff schedule is showing,
 * moves both to that week: its one-off, or usual hours from that Monday (not a week that's gone).
 */
export const SaveStaffHours = z.object({ hours: StaffHours, once: z.boolean(), weekOf: BusinessDate.optional() });

/** Someone on shift now. */
export const ShiftNow = z.object({
  staffId: Id,
  name: z.string(),
  role: z.enum(['owner', 'manager', 'counter']),
  startedAt: z.string(),
  /** On a break since then; null when working. */
  onBreakSince: z.string().nullable(),
  /** Break minutes already taken this shift (finished breaks). */
  breakMinutes: z.number().int().min(0),
  /** What they're booked for today, if anything. */
  booked: OpenSpan.nullable(),
});
export type ShiftNow = z.infer<typeof ShiftNow>;

/** The Staff page's week: the shop's hours day by day, and who's booked when. */
export const StaffWeek = z.object({
  /** The Monday. */
  weekOf: BusinessDate,
  /** Today in the shop, so the page draws "now" in the shop's day. */
  today: BusinessDate,
  days: z.array(z.object({ date: BusinessDate, open: OpenSpan.nullable() })).length(7),
  /** Seven days a person, Monday first; null is not booked. */
  booked: z.record(z.string(), z.array(OpenSpan.nullable()).length(7)),
  /** Each person's usual hours this week, for "Mon–Fri, 8am–4pm". */
  usual: z.record(z.string(), StaffHours.nullable()),
  /** When each person last started a shift. */
  lastShift: z.record(z.string(), z.string().nullable()),
});
export type StaffWeek = z.infer<typeof StaffWeek>;
