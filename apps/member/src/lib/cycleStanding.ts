/*
 * Where a member's cycles stand (Phase 2b, section 12.3-12.5), in words.
 *
 * Read from RevolvingIssuer through the credit route (`standing`): Clean Cycles in a row, missed
 * rebalances in a row, the chain-dated cure notice, the excess over a halved limit, and the Boost
 * cap ($500, or $750 once earned). Pure, so it is tested without a screen.
 */

export interface CycleStanding {
  cleanStreak: number;
  missedInRow: number;
  cureNoticeAt: number | null;
  defaultFrom: number | null;
  unsecuredExcessCents: number;
  boostCapCents: number | null;
  boostCapEarned: boolean;
  boostEarnedCapCents: number | null;
  boostCleanCycles: number;
}

export interface StandingNotice {
  tone: 'warn' | 'alert';
  title: string;
  body: string;
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const day = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The banner for a missed cycle or a cure notice; null for a member in good standing. */
export function standingNotice(s: CycleStanding | null | undefined): StandingNotice | null {
  if (!s) return null;
  if (s.cureNoticeAt) {
    return {
      tone: 'alert',
      title: 'Cure notice: two cycles missed',
      body: `Your line is paused. Clear your balance${s.defaultFrom ? ` by ${day(s.defaultFrom)}` : ''} to avoid default. Your savings are used only if it defaults.`,
    };
  }
  if (s.missedInRow > 0) {
    const excess = s.unsecuredExcessCents > 0
      ? ` ${dollars(s.unsecuredExcessCents)} is over the halved limit, and is settled from pledged bonds or pool shares, never your Savings.`
      : '';
    return {
      tone: 'warn',
      title: 'Last cycle closed with a balance',
      body: `Your income-backed and Boost limit is halved until you finish a cycle at zero.${excess}`,
    };
  }
  return null;
}

/** "Boost up to $500 · rises to $750 after 6 clean cycles (2 so far)". Null when no cap is set. */
export function boostCapLine(s: CycleStanding | null | undefined): string | null {
  if (!s || s.boostCapCents === null) return null;
  if (s.boostCapEarned || s.boostEarnedCapCents === null || s.boostEarnedCapCents <= s.boostCapCents) {
    return `Boost up to ${dollars(s.boostCapCents)}`;
  }
  const need = s.boostCleanCycles || 6;
  return `Boost up to ${dollars(s.boostCapCents)} · rises to ${dollars(s.boostEarnedCapCents)} after ${need} clean cycles with savings deposits (${Math.min(s.cleanStreak, need)} so far)`;
}
