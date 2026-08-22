import type { Milestone } from '@/lib/clearModel';

/**
 * When a member reaches the milestone that reserves them a home.
 *
 * A projection, and the only honest kind: credits now, plus what they are actually earning a
 * month, against the milestone's threshold. Nothing on-chain holds this because nothing on-chain
 * knows what next month looks like — but both inputs are real, so the answer is a real
 * extrapolation rather than a decorative date.
 *
 * Returns null rather than a guess in the two cases where there is no answer. Earning nothing a
 * month never arrives, and saying "Mar 2029" to somebody whose accrual has stopped is the page
 * inventing a future for them. Already past the threshold has no future date either.
 */
const RESERVE_MILESTONE = 'reserve';

export function projectReserveDate(
  credits: number,
  creditsPerMonth: number,
  milestones: Milestone[],
  from: Date = new Date(),
): string | null {
  const target = milestones.find((m) => m.id === RESERVE_MILESTONE)?.credits;
  if (target === undefined) return null;
  if (credits >= target) return null;
  if (creditsPerMonth <= 0) return null;

  const monthsOut = Math.ceil((target - credits) / creditsPerMonth);
  // Cap the horizon. A member earning a credit a month is technically on track for the year 3000,
  // and printing that is worse than admitting the projection does not say anything useful.
  if (monthsOut > 12 * 40) return null;

  const arrival = new Date(from.getFullYear(), from.getMonth() + monthsOut, 1);
  return arrival.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
