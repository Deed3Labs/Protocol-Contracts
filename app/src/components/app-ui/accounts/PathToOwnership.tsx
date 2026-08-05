import { useMemo, useState } from 'react';
import { usePay } from '@/context/PayContext';
import type { PaySummary } from '@/utils/apiClient';
import {
  buildOwnershipPath,
  OWNERSHIP_STAGES,
  SCENARIOS,
  TARGET_CREDITS,
} from '@/lib/ownershipPath';
import { cn } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Path to Ownership — the band.
 *
 * One continuous instrument spanning the page: every tick is a month of the member's tenure,
 * tick height is the equity earned that month, and the vertical hairlines are the stage
 * boundaries. Months already lived are solid; months ahead are drawn as outlines and are
 * explicitly labelled a projection.
 *
 * This is the page's differentiator, so it is the only element allowed to be this large. It
 * replaces the old stepper (which was onboarding UI) and the progress bar.
 */
export default function PathToOwnership({
  className,
  summary: summaryOverride,
}: {
  className?: string;
  /** Overrides the live PaySummary. Only used by the design preview harness. */
  summary?: PaySummary | null;
}) {
  const pay = usePay();
  const summary = summaryOverride ?? pay.summary;
  const loading = summaryOverride ? false : pay.loading;
  const [scenarioKey, setScenarioKey] = useState<string>('actual');
  const [hovered, setHovered] = useState<number | null>(null);

  const scenario = SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0];
  const path = useMemo(
    () => buildOwnershipPath(summary, { extraMonthly: scenario.extraMonthly }),
    [summary, scenario.extraMonthly],
  );
  // The baseline is what the member is actually on track for — used to show what a scenario buys.
  const baseline = useMemo(() => buildOwnershipPath(summary), [summary]);

  const maxEquity = useMemo(
    () => Math.max(...path.ticks.map((t) => t.equity), 1),
    [path.ticks],
  );

  // Stage boundaries as a percentage across the band, placed where cumulative credits cross them.
  // `labelPct` is nudged so early stages (which can cross within a month or two of each other)
  // don't stack their labels on top of one another — the hairline stays at the true position.
  const markers = useMemo(() => {
    const total = path.ticks.length || 1;
    const raw = OWNERSHIP_STAGES.map((stage) => {
      const idx = path.ticks.findIndex((t) => t.cumulative >= stage.at);
      return {
        stage,
        reached: path.earned >= stage.at,
        pct: stage.at === 0 ? 0 : ((idx < 0 ? total : idx) / total) * 100,
      };
    });

    const MIN_GAP = 13; // percent — roughly the width of the longest stage label
    let cursor = -Infinity;
    return raw.map((m) => {
      const labelPct = Math.min(Math.max(m.pct, cursor + MIN_GAP), 100);
      cursor = labelPct;
      return { ...m, labelPct };
    });
  }, [path.ticks, path.earned]);

  const monthsSaved =
    path.monthsToTitle !== null && baseline.monthsToTitle !== null
      ? baseline.monthsToTitle - path.monthsToTitle
      : 0;

  const active = hovered !== null ? path.ticks[hovered] : null;

  return (
    <section className={cn('py-6', className)}>
      {/* header — figure left, projection right. No box. */}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Your path to ownership
          </h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
              {(path.share * 100).toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground">
              of title &middot;{' '}
              <span className="font-medium text-foreground tabular-nums">{fmt(path.earned)}</span> of{' '}
              <span className="tabular-nums">{fmt(TARGET_CREDITS)}</span> credits
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{path.stage.label}</span> &middot;{' '}
            {path.stage.meaning}
            {path.nextStage && (
              <>
                {' '}
                Next: <span className="text-foreground">{path.nextStage.label}</span>,{' '}
                <span className="tabular-nums">{fmt(path.toNextStage)}</span> credits to go.
              </>
            )}
          </p>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Projected move-in
          </div>
          {path.insufficientHistory || !path.titleDate ? (
            <div className="mt-2 max-w-[16rem] text-sm text-muted-foreground">
              Not enough payment history to project yet — make a payment to start the estimate.
            </div>
          ) : (
            <>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {path.titleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                {path.monthsToTitle} months at {fmt(Math.round(path.runRate))} credits/mo
              </div>
              {monthsSaved > 0 && (
                <div className="mt-1 text-sm font-medium text-positive tabular-nums">
                  {monthsSaved} {monthsSaved === 1 ? 'month' : 'months'} sooner
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* scenario lenses — same chip vocabulary as the chart's time ranges */}
      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScenarioKey(s.key)}
            aria-pressed={s.key === scenarioKey}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              s.key === scenarioKey
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-1 text-xs text-muted-foreground">
          {scenario.extraMonthly > 0 ? 'Projection — what saving more would do' : 'Your current pace'}
        </span>
      </div>

      {/* the band */}
      <div className="relative mt-5 select-none">
        {/* readout for the hovered month, pinned above the band so the band never reflows */}
        <div className="mb-2 h-5 text-xs text-muted-foreground">
          {active ? (
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{active.label || 'Projected'}</span>
              {' · '}
              {fmt(Math.round(active.equity))} credits
              {' · '}
              {fmt(Math.round(active.cumulative))} cumulative
              {active.projected && ' · projected'}
            </span>
          ) : (
            <span>
              {loading
                ? 'Loading your history…'
                : `${path.ticks.filter((t) => !t.projected).length} months of payments, then projected`}
            </span>
          )}
        </div>

        <div
          className="relative flex h-28 items-end gap-px border-b border-border sm:h-36"
          onMouseLeave={() => setHovered(null)}
        >
          {path.ticks.map((tick, i) => {
            const h = Math.max((tick.equity / maxEquity) * 100, 3);
            return (
              <div
                key={`${tick.label}-${i}`}
                onMouseEnter={() => setHovered(i)}
                className="group relative flex h-full flex-1 items-end"
              >
                <div
                  style={{ height: `${h}%` }}
                  className={cn(
                    'w-full transition-opacity',
                    tick.projected
                      ? 'border-t border-dashed border-foreground/50 bg-foreground/[0.10]'
                      : 'bg-foreground/80',
                    tick.current && 'bg-foreground',
                    hovered === i && 'opacity-100',
                    hovered !== null && hovered !== i && 'opacity-40',
                  )}
                />
              </div>
            );
          })}

          {/* stage boundaries — the same 1px hairline used everywhere else */}
          {markers.map((m) =>
            m.pct <= 0 || m.pct >= 100 ? null : (
              <div
                key={m.stage.key}
                aria-hidden
                style={{ left: `${m.pct}%` }}
                className={cn(
                  'pointer-events-none absolute top-0 bottom-0 w-px',
                  m.reached ? 'bg-foreground/30' : 'bg-border',
                )}
              />
            ),
          )}
        </div>

        {/* stage labels sit under the band, positioned at their boundary */}
        <div className="relative mt-2 h-8">
          {markers.map((m, i) => (
            <div
              key={m.stage.key}
              style={{ left: `${m.labelPct}%` }}
              className={cn(
                'absolute top-0 whitespace-nowrap',
                i === 0 && 'translate-x-0',
                i > 0 && i < markers.length - 1 && '-translate-x-1/2',
                i === markers.length - 1 && '-translate-x-full',
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-medium uppercase tracking-widest',
                  m.reached ? 'text-foreground' : 'text-muted-foreground/60',
                )}
              >
                {m.stage.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
