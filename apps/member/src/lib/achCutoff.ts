/*
 * Same-day ACH cutoff. Bridge has to clear the USDC→USD conversion AND submit the ACH batch before
 * its final 2:30 PM ET cutoff for a withdrawal to land the same day. Miss it (or withdraw on a
 * weekend, when there's no ACH processing) and it settles the next business day instead.
 *
 * Everything here is computed in America/New_York and rendered in the member's OWN timezone, so
 * someone in Los Angeles sees 11:30 AM and someone in London sees 7:30 PM.
 */

const CUTOFF_HOUR_ET = 14;
const CUTOFF_MINUTE_ET = 30;
const ET = 'America/New_York';

/** Offset (ms) to add to a UTC instant to get the wall clock in `timeZone`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour` comes back as 24 at midnight in some engines — normalize so Date.UTC stays on the day.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - date.getTime();
}

export interface SameDayCutoff {
  /** The 2:30 PM ET cutoff for the current ET day, as an absolute instant. */
  cutoffAt: Date;
  /** True when a withdrawal submitted now can still make today's batch. */
  makesToday: boolean;
  /** ms until the cutoff; 0 once it has passed. */
  msRemaining: number;
  /** The cutoff in the member's local timezone, e.g. "11:30 AM PDT". */
  localLabel: string;
  /** What to actually promise the user. */
  settles: 'same day' | 'next business day';
  /** Weekends have no ACH processing at all, so the cutoff is moot. */
  isWeekend: boolean;
}

export function getSameDayCutoff(now: Date = new Date()): SameDayCutoff {
  const offset = tzOffsetMs(now, ET);
  // Shift into ET wall-clock space so the UTC getters read as Eastern date parts.
  const etWall = new Date(now.getTime() + offset);
  const cutoffWall = Date.UTC(
    etWall.getUTCFullYear(),
    etWall.getUTCMonth(),
    etWall.getUTCDate(),
    CUTOFF_HOUR_ET,
    CUTOFF_MINUTE_ET,
    0,
  );
  const cutoffAt = new Date(cutoffWall - offset);

  const etDay = etWall.getUTCDay();
  const isWeekend = etDay === 0 || etDay === 6;
  const msRemaining = Math.max(0, cutoffAt.getTime() - now.getTime());
  const makesToday = !isWeekend && msRemaining > 0;

  return {
    cutoffAt,
    makesToday,
    msRemaining,
    localLabel: cutoffAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    settles: makesToday ? 'same day' : 'next business day',
    isWeekend,
  };
}

/** "1h 12m" / "8m 30s" — tightens to seconds in the last minutes so the urgency reads. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
