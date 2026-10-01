import type { CreditState } from '@/utils/apiClient';

/** When this credit cycle began (ms): 0 when there's no readable cycle, which the cycle maths reads as "everything loaded". */
export function cycleStartOf(credit: CreditState | null): number {
  const cycle = credit?.complete ? credit.cycle : null;
  return cycle && cycle.issuedAt > 0 ? cycle.issuedAt * 1000 : 0;
}
