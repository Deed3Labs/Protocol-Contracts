/*
 * The four invariants — spec §3.
 *
 * "Run continuously, alert on drift, never auto-correct." The never-auto-correct part is the whole
 * design. A reconciler that fixes what it finds is a second, unsupervised source of truth about
 * money, and when it is wrong it destroys the evidence of why. This decides only whether two
 * numbers agree and says so.
 *
 * Pure, so the arithmetic can be tested without a chain, a database or Lithic in the way.
 *
 * ONE RESTATEMENT from the spec, flagged rather than made quietly. The spec words ESA backing as
 * "co-op fiat received from sweeps = CLRUSD minted", which assumed the treasury model — the co-op
 * taking in fiat and releasing USDC from its own float. That model is gone: sweeps now travel the
 * member's own Bridge account, and no co-op fiat is received at any point. The invariant that
 * carries the same meaning under the Bridge rail is that fiat pushed out for completed sweeps
 * equals CLRUSD minted by them. Same question — did every dollar that left become a token? — asked
 * of the rail that actually exists.
 */

export type InvariantStatus = 'ok' | 'drift' | 'unavailable';

export interface InvariantResult {
  key: string;
  label: string;
  status: InvariantStatus;
  /** What the books say should be true. Null when it could not be established. */
  expectedCents: number | null;
  /** What was actually observed. Null when the source could not be read. */
  actualCents: number | null;
  /** actual − expected. Positive is surplus, negative is shortfall. */
  driftCents: number | null;
  detail: string;
}

/**
 * Money compares exactly. The tolerance exists for one honest reason only: rounding when a figure
 * is derived through a different unit — a chain balance at 18 decimals truncated to cents, say.
 * It is one cent, and it is not a slack budget for real disagreement.
 */
export const TOLERANCE_CENTS = 1;

/**
 * Compare two figures.
 *
 * A missing figure is `unavailable`, never `ok`. This is the rule the whole file turns on: an
 * invariant that cannot be evaluated has not passed, and reporting a silent pass on missing data
 * is how a reconciler tells you everything is fine while it is reading nothing at all.
 */
export function compare(
  key: string,
  label: string,
  expectedCents: number | null,
  actualCents: number | null,
  detail: string,
): InvariantResult {
  if (expectedCents === null || actualCents === null) {
    return {
      key,
      label,
      status: 'unavailable',
      expectedCents,
      actualCents,
      driftCents: null,
      detail,
    };
  }

  const driftCents = actualCents - expectedCents;
  return {
    key,
    label,
    status: Math.abs(driftCents) <= TOLERANCE_CENTS ? 'ok' : 'drift',
    expectedCents,
    actualCents,
    driftCents,
    detail,
  };
}

/**
 * Float adequacy is the one inequality, so it does not go through `compare`.
 *
 * Equality would be the wrong test: a float larger than what has been drawn against it is healthy,
 * not drift. Only a shortfall matters — that is the co-op having lent savings-backed credit it
 * cannot currently settle.
 */
export function compareAtLeast(
  key: string,
  label: string,
  requiredCents: number | null,
  availableCents: number | null,
  detail: string,
): InvariantResult {
  if (requiredCents === null || availableCents === null) {
    return {
      key,
      label,
      status: 'unavailable',
      expectedCents: requiredCents,
      actualCents: availableCents,
      driftCents: null,
      detail,
    };
  }

  const driftCents = availableCents - requiredCents;
  return {
    key,
    label,
    status: driftCents >= -TOLERANCE_CENTS ? 'ok' : 'drift',
    expectedCents: requiredCents,
    actualCents: availableCents,
    driftCents,
    detail,
  };
}

export interface ReconciliationReport {
  checkedAt: string;
  results: InvariantResult[];
  /** True when nothing drifted. Unavailable checks do not make a report healthy. */
  healthy: boolean;
  driftCount: number;
  unavailableCount: number;
}

/**
 * Roll results into a report.
 *
 * `healthy` requires every invariant to have been evaluated AND passed. A run that could not read
 * half its sources is not a clean bill of health, and calling it one would be the most dangerous
 * thing this module could do.
 */
export function buildReport(results: InvariantResult[], checkedAt: string): ReconciliationReport {
  const driftCount = results.filter((r) => r.status === 'drift').length;
  const unavailableCount = results.filter((r) => r.status === 'unavailable').length;

  return {
    checkedAt,
    results,
    healthy: driftCount === 0 && unavailableCount === 0,
    driftCount,
    unavailableCount,
  };
}
