import { useMemo, useState } from 'react';
import { usePay } from '@/context/PayContext';
import type { PaySummary } from '@/utils/apiClient';
import {
  buildOwnershipPath,
  OWNERSHIP_STAGES,
  REFERENCE_MONTHLY,
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

  // Hairlines sit at the true crossing point. Labels do NOT — they're an evenly spaced legend
  // underneath (as in the Figma), because data-derived label positions pile up and overprint
  // each other whenever several stages are still far away.
  // Equal-width stage segments, filled by real credit thresholds. Equal widths (rather than
  // duration-proportional) keep every stage readable no matter how far out it is, and make the
  // rail immune to the label pile-up that data-derived positions caused.
  const segments = useMemo(
    () =>
      OWNERSHIP_STAGES.map((stage, i) => {
        const next = OWNERSHIP_STAGES[i + 1];
        const span = next ? next.at - stage.at : 0;
        const into = path.earned - stage.at;
        const fill = !next
          ? path.earned >= stage.at
            ? 100
            : 0
          : span > 0
            ? Math.max(0, Math.min(into / span, 1)) * 100
            : 0;
        return {
          stage,
          fill,
          reached: path.earned >= stage.at,
          current: path.stageIndex === i,
        };
      }),
    [path.earned, path.stageIndex],
  );

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
            <span className="text-[2rem] font-light leading-none tracking-tight tabular-nums text-foreground">
              {(path.share * 100).toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {fmt(path.earned)} of {fmt(TARGET_CREDITS)} credits
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Projected move-in
          </div>
          {path.titleDate ? (
            <>
              <div className="mt-3 text-[2rem] font-light leading-none tracking-tight text-foreground">
                {path.titleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                {path.usingReference
                  ? `if you save $${REFERENCE_MONTHLY}/mo`
                  : `${path.monthsToTitle} months`}
                {monthsSaved > 0 && (
                  <span className="text-positive"> &middot; {monthsSaved} sooner</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mt-3 text-[2rem] font-light leading-none text-muted-foreground/40">—</div>
              <div className="mt-1 text-sm text-muted-foreground">Not enough history yet</div>
            </>
          )}
        </div>
      </div>

      {/* scenario lenses — same chip vocabulary as the chart's time ranges */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScenarioKey(s.key)}
            aria-pressed={s.key === scenarioKey}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              s.key === scenarioKey
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* the band */}
      <div className="relative mt-5 select-none">
        {/* Hover readout only — the row keeps its height so the band never reflows, but it stays
            empty at rest rather than carrying a permanent caption. */}
        <div className="mb-2 h-5 text-xs text-muted-foreground">
          {loading ? (
            <span>Loading…</span>
          ) : active ? (
            <span className="tabular-nums">
              <span className="text-foreground">{active.label || 'Projected'}</span>
              {' · '}
              {fmt(Math.round(active.equity))} credits
              {active.projected && ' · projected'}
            </span>
          ) : null}
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

        </div>

        {/* Stage rail — five equal steps split by the same hairline used everywhere else. Reached
            steps are solid, the current step fills to how far through it you are. */}
        <div className="mt-5 grid grid-cols-5 gap-px">
          {segments.map((s) => (
            <div key={s.stage.key} className="h-1 bg-secondary" aria-hidden>
              <div
                className={cn('h-full', s.current ? 'bg-foreground' : 'bg-foreground/70')}
                style={{ width: `${s.fill}%` }}
              />
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-5 gap-px">
          {segments.map((s, i) => (
            <div
              key={s.stage.key}
              className={cn(
                'min-w-0',
                i === segments.length - 1 ? 'text-right' : 'text-left',
              )}
            >
              <span
                title={s.stage.meaning}
                className={cn(
                  'block truncate text-[10px] font-medium uppercase tracking-widest',
                  s.current
                    ? 'text-foreground'
                    : s.reached
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/50',
                )}
              >
                {s.stage.label}
              </span>
              {s.current && path.nextStage && (
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground tabular-nums">
                  {fmt(path.toNextStage)} to go
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
