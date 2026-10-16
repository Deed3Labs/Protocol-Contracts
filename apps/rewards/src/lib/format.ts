import { money } from '@clear/domain';

/** "$212.40": amounts are always cents shown in full. */
export const usd = (cents: number) => money(cents / 100, { cents: true });
/** "9.00": a bill line, no sign. */
export const plain = (cents: number) => (cents / 100).toFixed(2);
/** "−3.50" with a true minus. */
export const minus = (cents: number) => `−${plain(cents)}`;
/** "7:46pm" in the shop's time. */
export function clock(iso: string, timeZone = 'America/Los_Angeles'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/\s?([AP])M$/, (_, a: string) => `${a.toLowerCase()}m`);
}
/** "0.3 mi" */
export const miles = (meters: number) => `${(meters / 1609.344).toFixed(1)} mi`;
/** "SM" from "Sofia" and "M". */
export const initials = (first: string, lastInitial: string | null) => `${first.charAt(0)}${lastInitial ?? first.charAt(1)}`.toUpperCase();
