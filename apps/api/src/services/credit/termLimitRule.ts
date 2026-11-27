import { INCOME_SHARE } from '../lithic/tierLimits.js';

/*
 * The automatic term limit -- how much a member may have out on split plans.
 *
 * Every verified member starts with a modest line and earns more of it by paying on time. Growth is
 * bounded by the same income rule the card's income tier uses, so a clean record alone cannot carry
 * someone past what their deposits support -- but the starter line stands without any income at
 * all, because a new member has no deposit history yet and still needs somewhere to start.
 *
 * Pure, so the figures can be tested against the product rule without a chain or a database. The
 * figures themselves are proposals awaiting sign-off; they live here, together, so changing one is a
 * one-line edit.
 *
 * Raise only. An operator may have set a member higher by hand, and a default already zeroes the
 * limit on chain, so lowering is never this rule's job.
 */

/** What every verified member starts with: $500. */
export const STARTER_CENTS = 50_000;
/** What each run of clean installments adds: $250. */
export const STEP_CENTS = 25_000;
/** Clean installments per step. */
export const CYCLES_PER_STEP = 3;
/** The most this rule will ever set on its own: $5,000. Above that is an operator's decision. */
export const CEILING_CENTS = 500_000;
/** Changes smaller than a dollar are not worth a transaction. */
export const MIN_CHANGE_CENTS = 100;
/** Income-backed growth is capped at the card's income share of a month's deposits. */
export { INCOME_SHARE };

export interface TermLimitInput {
  /** Identity check passed (Lithic ACCEPTED). */
  verified: boolean;
  /** `termSuspended` on chain. */
  suspended: boolean;
  /** `defaultedAt != 0` on chain. */
  defaulted: boolean;
  /** `totalArrearsOf > 0` on chain right now. */
  inArrears: boolean;
  /** `termLimitOf` now, in cents. */
  currentCents: number;
  /** Installments paid since the member's last late mark. */
  cleanInstallments: number;
  /** Trailing estimated monthly deposit, in cents. */
  monthlyDepositCents: number;
}

/** Why a member is left alone before any arithmetic, or null when they qualify to be considered. */
export function termLimitSkip(input: TermLimitInput): 'unverified' | 'suspended' | 'defaulted' | 'late' | null {
  if (!input.verified) return 'unverified';
  if (input.suspended) return 'suspended';
  if (input.defaulted) return 'defaulted';
  // Behind right now: raising the line of someone missing payments is the opposite of the point.
  if (input.inArrears) return 'late';
  return null;
}

/** The limit the record supports, before comparing it with what is already set. */
export function earnedLimitCents(cleanInstallments: number, monthlyDepositCents: number): number {
  const steps = Math.floor(Math.max(0, cleanInstallments) / CYCLES_PER_STEP);
  const earned = STARTER_CENTS + steps * STEP_CENTS;
  const incomeCap = Math.round(Math.max(0, monthlyDepositCents) * INCOME_SHARE);
  // The starter stands on its own; only growth above it needs income to back it.
  return Math.min(CEILING_CENTS, Math.max(STARTER_CENTS, Math.min(earned, incomeCap)));
}

/**
 * Where this member's term limit should go, or null to leave it as it is.
 *
 * Null covers every "not now": not verified, suspended, defaulted, behind, already at or above what
 * they have earned, or a change too small to send.
 */
export function termLimitTarget(input: TermLimitInput): { targetCents: number; reason: string } | null {
  if (termLimitSkip(input)) return null;
  const targetCents = earnedLimitCents(input.cleanInstallments, input.monthlyDepositCents);
  if (targetCents - input.currentCents < MIN_CHANGE_CENTS) return null;

  if (targetCents === STARTER_CENTS) return { targetCents, reason: 'starter' };
  const steps = Math.floor(input.cleanInstallments / CYCLES_PER_STEP);
  const earned = STARTER_CENTS + steps * STEP_CENTS;
  const bound = targetCents === CEILING_CENTS ? ', at the ceiling' : targetCents < earned ? ', capped by income' : '';
  return { targetCents, reason: `${input.cleanInstallments} clean installments${bound}` };
}
