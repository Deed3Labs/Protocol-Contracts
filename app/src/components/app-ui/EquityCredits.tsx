import { Flame, PiggyBank, Home, Receipt, Sparkles } from 'lucide-react';
import { usePay, rewardMultiplier, MAX_MULTIPLIER } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * Equity credits — what you've earned, where it came from, and what's boosting it.
 *
 * Every number here is real (PaySummary): `sources` answers "from what", `vested` vs `pending` shows
 * the 30-day settlement window, and the multiplier comes from the same formula the backend awards
 * with, so the "next bonus" line can't drift from what actually gets credited.
 *
 * Credits are NOT interest or yield — they only count toward the Clear Deed milestone.
 */
const nInt = (n: number) => Math.round(n).toLocaleString('en-US');

const SOURCES = [
  { key: 'match' as const, label: 'Savings match', icon: PiggyBank, tint: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  { key: 'rent' as const, label: 'Rent', icon: Home, tint: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500' },
  { key: 'bills' as const, label: 'Bills', icon: Receipt, tint: 'text-violet-600 dark:text-violet-400', bar: 'bg-violet-500' },
];

export default function EquityCredits() {
  const { summary, streak } = usePay();
  const { accelerated } = useMemberProfile();

  const total = summary?.totalEquity ?? 0;
  const vested = summary?.vestedEquity ?? 0;
  const pending = summary?.pendingEquity ?? 0;
  const thisMonth = summary?.equityThisMonth ?? 0;
  const sources = summary?.sources ?? { match: 0, rent: 0, bills: 0 };
  const sourceTotal = sources.match + sources.rent + sources.bills;

  const multiplier = rewardMultiplier(streak, accelerated);
  const atMax = multiplier >= MAX_MULTIPLIER;
  // Standard members gain +0.25× every 6 on-time months; Accelerated members are already at the cap.
  const nextTierAt = (Math.floor(Math.max(streak, 0) / 6) + 1) * 6;
  const monthsToNext = Math.max(0, nextTierAt - streak);

  const vestedPct = total > 0 ? Math.round((vested / total) * 100) : 0;

  return (
    <section className="rounded-2xl border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">Equity credits</h3>
          <div className="mt-1 font-display text-3xl tracking-tight text-foreground tabular-nums">{nInt(total)}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {thisMonth > 0 ? `+${nInt(thisMonth)} this month` : 'Pay a bill on time to start earning'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            atMax ? 'bg-positive/10 text-positive' : 'bg-secondary text-foreground',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" /> {multiplier}× earning
        </span>
      </div>

      {/* Vesting: credits settle after 30 days, so show what's locked in vs still maturing. */}
      {total > 0 && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${vestedPct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span><span className="font-medium text-foreground tabular-nums">{nInt(vested)}</span> vested</span>
            {pending > 0 && <span><span className="font-medium text-foreground tabular-nums">{nInt(pending)}</span> still vesting</span>}
          </div>
        </div>
      )}

      {/* Where they came from. */}
      {sourceTotal > 0 && (
        <div className="mt-5 space-y-2.5 border-t border-border pt-4">
          <div className="text-[11px] font-medium text-muted-foreground">Where they came from</div>
          {SOURCES.map((s) => {
            const value = sources[s.key];
            if (value <= 0) return null;
            const pct = Math.round((value / sourceTotal) * 100);
            return (
              <div key={s.key} className="flex items-center gap-3">
                <s.icon className={cn('h-4 w-4 shrink-0', s.tint)} />
                <span className="w-24 shrink-0 truncate text-xs text-foreground">{s.label}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span className={cn('block h-full rounded-full transition-[width] duration-500', s.bar)} style={{ width: `${pct}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{nInt(value)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Streak + what unlocks the next bonus. */}
      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', streak > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-secondary text-muted-foreground')}>
          <Flame className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {streak > 0 ? `${streak}-month on-time streak` : 'No streak yet'}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {accelerated
              ? "Accelerated plan — you're earning the maximum 1.5×."
              : atMax
                ? "You've hit the maximum 1.5× earning rate."
                : `Pay on time for ${monthsToNext} more ${monthsToNext === 1 ? 'month' : 'months'} to reach ${Math.min(multiplier + 0.25, MAX_MULTIPLIER)}×.`}
          </div>
        </div>
      </div>
    </section>
  );
}
