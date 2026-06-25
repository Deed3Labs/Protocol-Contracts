import { Home, Zap, Sparkles, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const CREDITS = 6240;
const GOAL = 25000;

/** Homeownership milestones — equal quarters of the goal, named like a build. */
const TIERS = [
  { label: 'Foundation', value: 6250 },
  { label: 'Halfway', value: 12500 },
  { label: 'Framing', value: 18750 },
  { label: 'Keys', value: 25000 },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2.5 py-3 text-center">
      <div className="font-display text-[15px] leading-none text-foreground tabular-nums">{value}</div>
      <div className="mt-1.5 text-[10px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Clear Deed progress — gamified milestone tracker for equity credits (1:1 match on
 * CLRUSD savings + on-time rent credits; non-withdrawable, applied at conversion).
 * A tiered "build" meter, a next-milestone nudge, and performance stats.
 */
export default function ClearDeedCard({ className }: { className?: string }) {
  const pct = (CREDITS / GOAL) * 100;
  const segSize = GOAL / TIERS.length;
  const currentIdx = TIERS.findIndex((t) => CREDITS < t.value);
  const nextTier = TIERS[currentIdx] ?? TIERS[TIERS.length - 1];
  const toNext = Math.max(0, nextTier.value - CREDITS);

  return (
    <div className={cn('relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-5', className)}>
      {/* subtle flourish */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-foreground/[0.04] blur-2xl" aria-hidden />

      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
            <Home className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-sm font-medium text-foreground">Clear Deed</div>
            <div className="text-xs text-muted-foreground">Your path to ownership</div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-[11px] font-medium text-foreground">
          <Zap className="h-3 w-3" /> 1:1 match
        </span>
      </div>

      {/* hero */}
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[2.5rem] leading-none tracking-tight text-foreground tabular-nums">
              ${CREDITS.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">/ $25k</span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Equity credits · non-withdrawable</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-xl leading-none text-foreground tabular-nums">{Math.round(pct)}%</div>
          <div className="mt-1 text-[10px] text-muted-foreground">to goal</div>
        </div>
      </div>

      {/* tiered "build" meter */}
      <div className="mt-5">
        <div className="flex gap-1.5">
          {TIERS.map((t, i) => {
            const fill = clamp((CREDITS - i * segSize) / segSize, 0, 1) * 100;
            return (
              <div key={t.label} className="h-2.5 flex-1 overflow-hidden rounded-lg bg-secondary">
                <div className="h-full rounded-lg bg-primary transition-[width] duration-500" style={{ width: `${fill}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1.5">
          {TIERS.map((t, i) => {
            const reached = CREDITS >= t.value;
            const active = i === currentIdx;
            return (
              <div
                key={t.label}
                className={cn(
                  'flex flex-1 items-center gap-1 text-[10px] font-medium first:justify-start last:justify-end',
                  i > 0 && i < TIERS.length - 1 && 'justify-center',
                  reached || active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {reached && <Check className="h-2.5 w-2.5" />}
                {t.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* next-milestone nudge */}
      <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-secondary p-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card text-foreground">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">${toNext.toLocaleString()} to {nextTier.label}</span> — your next milestone
        </p>
      </div>

      {/* performance stats */}
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <MiniStat label="This month" value="+$520" />
        <MiniStat label="On-time streak" value="6 mo" />
        <MiniStat label="To goal" value="~14 mo" />
      </div>

      {/* CTA */}
      <button
        type="button"
        className="mt-4 w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background transition-transform active:scale-[0.99]"
      >
        View your Clear Deed
      </button>
    </div>
  );
}
