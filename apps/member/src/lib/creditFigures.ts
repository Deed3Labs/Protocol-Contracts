import type { CreditState } from '@/utils/apiClient';

/** When this credit cycle began (ms): 0 when there's no readable cycle, which the cycle maths reads as "everything loaded". */
export function cycleStartOf(credit: CreditState | null): number {
  const cycle = credit?.complete ? credit.cycle : null;
  return cycle && cycle.issuedAt > 0 ? cycle.issuedAt * 1000 : 0;
}

/**
 * At partners (under the member's code): the credit they can split at a Clear partner right now --
 * the term line a pay-over-time plan draws on, what's left of it. Undefined until it's been read; 0
 * while the line is paused after a default.
 */
export function partnerCreditOf(credit: CreditState | null): number | undefined {
  if (!credit?.term) return undefined;
  return credit.term.suspended ? 0 : Math.max(0, credit.term.availableCents) / 100;
}
