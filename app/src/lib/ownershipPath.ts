import type { PaySummary } from '@/utils/apiClient';

/**
 * The path to ownership — the member's arc from Renters → Owners → Earners, expressed as
 * equity-credit thresholds.
 *
 * Everything here is derived from real data (PaySummary.series / totalEquity). The one piece
 * that is NOT yet backed by the API is the stage ladder itself: the thresholds below are
 * product constants, not member-specific terms. When the backend exposes per-member terms
 * (target structure value + accrual schedule) these should come from there instead.
 */
export interface OwnershipStage {
  key: string;
  label: string;
  /** Cumulative equity credits at which this stage is reached. */
  at: number;
  /** What the member actually gets here — plain language, not pipeline jargon. */
  meaning: string;
}

export const OWNERSHIP_STAGES: OwnershipStage[] = [
  { key: 'enrolled', label: 'Enrolled', at: 0, meaning: 'You joined the co-op.' },
  { key: 'foundation', label: 'Foundation', at: 2_500, meaning: 'Your first credits are vesting.' },
  { key: 'qualified', label: 'Qualified', at: 12_500, meaning: 'You can reserve a home.' },
  { key: 'reserved', label: 'Reserved', at: 30_000, meaning: 'A specific home is held for you.' },
  { key: 'movein', label: 'Move-in', at: 60_000, meaning: 'You hold title to the structure.' },
];

export const TARGET_CREDITS = OWNERSHIP_STAGES[OWNERSHIP_STAGES.length - 1].at;

export interface PathTick {
  /** Month label from the API series, e.g. "Mar". */
  label: string;
  /** Equity credits earned that month. */
  equity: number;
  /** Cumulative credits at the end of that month. */
  cumulative: number;
  /** True when this month hasn't happened yet — rendered as an outline, never as fact. */
  projected: boolean;
  /** True for the month currently in progress. */
  current: boolean;
}

export interface OwnershipPath {
  ticks: PathTick[];
  /** Credits earned to date (real). */
  earned: number;
  /** Share of the full title, 0–1 (real / TARGET_CREDITS). */
  share: number;
  stageIndex: number;
  stage: OwnershipStage;
  nextStage: OwnershipStage | null;
  /** Credits still needed to reach the next stage. */
  toNextStage: number;
  /** Average monthly credits over the trailing window — the basis for every projection. */
  runRate: number;
  /** Months until title at the current run rate, or null when the run rate is zero. */
  monthsToTitle: number | null;
  /** Projected move-in date, or null when it can't be projected honestly. */
  titleDate: Date | null;
  /** True when there's too little history to project — the UI must say so rather than guess. */
  insufficientHistory: boolean;
  /**
   * True when the current pace is so slow the estimate is meaningless (a brand-new member with a
   * handful of credits projects centuries out). The UI must not print that date.
   */
  paceTooSlow: boolean;
}

/** Beyond this, a move-in estimate is noise, not information. */
const MAX_CREDIBLE_MONTHS = 240; // 20 years

/** Months of forward projection to draw. Enough to show the shape, not so many it implies precision. */
const PROJECTION_MONTHS = 18;
/** Trailing months used to compute the run rate. */
const RUN_RATE_WINDOW = 6;

export function buildOwnershipPath(
  summary: PaySummary | null,
  opts: { extraMonthly?: number } = {},
): OwnershipPath {
  const extraMonthly = Math.max(0, opts.extraMonthly ?? 0);
  const series = summary?.series ?? [];
  const earned = summary?.totalEquity ?? 0;

  // --- real history -> ticks ---------------------------------------------------------------
  const ticks: PathTick[] = [];
  let running = 0;
  series.forEach((point, i) => {
    running += point.equity;
    ticks.push({
      label: point.label,
      equity: point.equity,
      cumulative: running,
      projected: false,
      current: i === series.length - 1,
    });
  });

  // The series is the source of truth for shape; totalEquity is the source of truth for the
  // figure. If they disagree (backfill gaps), trust totalEquity and carry the delta forward.
  const historyTotal = running;
  const cumulativeStart = Math.max(earned, historyTotal);

  // --- run rate ----------------------------------------------------------------------------
  const window = series.slice(-RUN_RATE_WINDOW);
  const observed = window.length
    ? window.reduce((sum, p) => sum + p.equity, 0) / window.length
    : 0;
  const runRate = observed + extraMonthly;
  const insufficientHistory = series.length < 2;

  // --- projection --------------------------------------------------------------------------
  let projectedRunning = cumulativeStart;
  if (runRate > 0) {
    const lastLabel = series[series.length - 1]?.label;
    const start = monthIndexFromLabel(lastLabel);
    for (let i = 1; i <= PROJECTION_MONTHS && projectedRunning < TARGET_CREDITS; i++) {
      projectedRunning += runRate;
      ticks.push({
        label: start === null ? '' : MONTHS[(start + i) % 12],
        equity: runRate,
        cumulative: projectedRunning,
        projected: true,
        current: false,
      });
    }
  }

  // --- stage ---------------------------------------------------------------------------------
  let stageIndex = 0;
  for (let i = 0; i < OWNERSHIP_STAGES.length; i++) {
    if (earned >= OWNERSHIP_STAGES[i].at) stageIndex = i;
  }
  const nextStage = OWNERSHIP_STAGES[stageIndex + 1] ?? null;

  const remaining = Math.max(TARGET_CREDITS - earned, 0);
  const monthsToTitle = runRate > 0 && remaining > 0 ? Math.ceil(remaining / runRate) : null;

  const paceTooSlow = monthsToTitle !== null && monthsToTitle > MAX_CREDIBLE_MONTHS;

  let titleDate: Date | null = null;
  if (monthsToTitle !== null && !insufficientHistory && !paceTooSlow) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsToTitle);
    titleDate = d;
  }

  return {
    ticks,
    earned,
    share: TARGET_CREDITS > 0 ? Math.min(earned / TARGET_CREDITS, 1) : 0,
    stageIndex,
    stage: OWNERSHIP_STAGES[stageIndex],
    nextStage,
    toNextStage: nextStage ? Math.max(nextStage.at - earned, 0) : 0,
    runRate,
    monthsToTitle,
    titleDate,
    insufficientHistory,
    paceTooSlow,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthIndexFromLabel(label?: string): number | null {
  if (!label) return null;
  const i = MONTHS.findIndex((m) => label.toLowerCase().startsWith(m.toLowerCase()));
  return i >= 0 ? i : null;
}

/** Scenario lenses for the band. "Actual" is the observed run rate; the rest are what-ifs. */
export const SCENARIOS = [
  { key: 'actual', label: 'Actual', extraMonthly: 0 },
  { key: 'plus50', label: '+$50/mo', extraMonthly: 50 },
  { key: 'plus100', label: '+$100/mo', extraMonthly: 100 },
  { key: 'plus250', label: '+$250/mo', extraMonthly: 250 },
] as const;
