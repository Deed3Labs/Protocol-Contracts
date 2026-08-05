import { usePay } from '@/context/PayContext';
import type { PaySummary } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Equity Sources — what actually built the member's title, from PaySummary.sources.
 *
 * The band shows the thing growing; this explains what makes it grow. Both are real data
 * (sources / vestedEquity / pendingEquity all come back from /api/pay/:wallet/summary).
 *
 * Flat list, hairline dividers, no card.
 */
export default function EquitySources({
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

  const sources = summary?.sources;
  const rows = [
    {
      key: 'rent',
      label: 'Rent payments',
      hint: 'Every on-time month converts to credits',
      value: sources?.rent ?? 0,
    },
    {
      key: 'match',
      label: 'Savings match',
      hint: 'Matched 1:1 by the co-op',
      value: sources?.match ?? 0,
    },
    {
      key: 'bills',
      label: 'Bills on time',
      hint: 'Utilities and recurring bills',
      value: sources?.bills ?? 0,
    },
  ];

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const vested = summary?.vestedEquity ?? 0;
  const pending = summary?.pendingEquity ?? 0;

  return (
    <section className={cn('py-6', className)}>
      <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        Equity sources
      </h2>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[2rem] font-light leading-none tracking-tight tabular-nums text-foreground">
          {loading ? '—' : fmt(total)}
        </span>
        <span className="text-sm text-muted-foreground">credits earned</span>
      </div>

      <div className="mt-4">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-baseline justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block text-sm font-normal text-foreground">{row.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{row.hint}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-base font-normal tabular-nums text-foreground">
                {fmt(row.value)}
              </span>
              {total > 0 && (
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {Math.round((row.value / total) * 100)}%
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* vesting split — real, and the distinction members actually ask about */}
      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">
          Vested <span className="font-normal tabular-nums text-foreground">{fmt(vested)}</span>
        </span>
        <span className="text-muted-foreground">
          Pending <span className="font-normal tabular-nums text-foreground">{fmt(pending)}</span>
        </span>
      </div>
    </section>
  );
}
