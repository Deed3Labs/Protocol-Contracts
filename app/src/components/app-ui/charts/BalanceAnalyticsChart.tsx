import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useClearPortfolioHistory } from '@/hooks/useClearPortfolioHistory';
import { useClearTransactions, type CashFlow } from '@/hooks/useClearTransactions';
import { flowBuckets } from '@/lib/cashflow';
import type { PortfolioHistoryPoint } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

const METRICS = ['Balance', 'Income', 'Spending', 'Net'] as const;
const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] as const;
type Metric = (typeof METRICS)[number];
type Range = (typeof RANGES)[number];

/** Per-metric accent: Balance=blue, Income=green, Spending=red, Net=green (bars recolor by sign). */
const METRIC_COLOR: Record<Metric, string> = {
  Balance: 'rgb(var(--info))',
  Income: 'rgb(var(--positive))',
  Spending: 'rgb(var(--negative))',
  Net: 'rgb(var(--positive))',
};

const DAY = 86_400_000;
function cutoffFor(range: Range): number {
  const now = Date.now();
  if (range === 'All') return 0;
  if (range === 'YTD') return Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const days: Record<string, number> = { '1D': 1, '1W': 7, '1M': 31, '3M': 93, '6M': 186, '1Y': 366 };
  return now - (days[range] ?? 31) * DAY;
}
const dlabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Balance = daily total level from backend snapshots; flat at the real current total when empty. */
function buildBalanceSeries(range: Range, points: PortfolioHistoryPoint[], currentTotal: number) {
  const cutoff = cutoffFor(range);
  const pts = points.filter((p) => Date.parse(p.date) >= cutoff);
  if (pts.length === 0) {
    return [
      { label: '', value: currentTotal },
      { label: 'Now', value: currentTotal },
    ];
  }
  // Anchor the latest value to the live total (same source as the balance cards) so the chart's
  // current figure never disagrees with them — historical snapshots provide the trend leading up.
  return [...pts.map((p) => ({ label: dlabel(p.date), value: p.totalUsd })), { label: 'Now', value: currentTotal }];
}

/** Income/Spending/Net per bucket from real transaction flows (on-chain + Plaid). */
function buildFlowSeries(metric: Metric, range: Range, flows: CashFlow[]) {
  return flowBuckets(range).map((b) => {
    const inB = flows.filter((f) => f.ts >= b.start && f.ts <= b.end);
    let value: number;
    if (metric === 'Income') value = inB.filter((f) => f.usd > 0).reduce((s, f) => s + f.usd, 0);
    else if (metric === 'Spending') value = Math.abs(inB.filter((f) => f.usd < 0).reduce((s, f) => s + f.usd, 0));
    else value = inB.reduce((s, f) => s + f.usd, 0); // Net
    return { label: b.label, value: Math.round(value * 100) / 100 };
  });
}

const fmtMoney = (v: number) =>
  `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tick = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `$${Math.round(a / 1000)}k` : `$${a}`;
  return v < 0 ? `-${s}` : s;
};

const MARGIN = { left: 0, right: 8, top: 8, bottom: 0 };

/**
 * Diverging bar shape for the Net tab — rounds the corner away from the zero baseline
 * (top for gains, bottom for losses) and colors by sign. Recharts' array `radius`
 * mis-renders bars that cross zero, so we draw the rounded rect path ourselves.
 */
function DivergingBar(props: { x?: number; y?: number; width?: number; height?: number; payload?: { value: number } }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const v = payload?.value ?? 0;
  const yTop = Math.min(y, y + height);
  const h = Math.abs(height);
  if (h <= 0 || width <= 0) return null;
  const r = Math.max(0, Math.min(3, width / 2, h));
  const fill = v >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))';
  const d =
    v >= 0
      ? `M${x},${yTop + h} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + width - r},${yTop} Q${x + width},${yTop} ${x + width},${yTop + r} L${x + width},${yTop + h} Z`
      : `M${x},${yTop} L${x},${yTop + h - r} Q${x},${yTop + h} ${x + r},${yTop + h} L${x + width - r},${yTop + h} Q${x + width},${yTop + h} ${x + width},${yTop + h - r} L${x + width},${yTop} Z`;
  return <path d={d} fill={fill} />;
}

/**
 * Main analytics chart. Metric tabs choose the most fitting viz: Balance as an
 * area chart (a running level over time), Income/Spending/Net as bars (per-period
 * flows; Net bars go up/down and turn red when negative). Full 1D…All range selector.
 */
export default function BalanceAnalyticsChart({ className }: { className?: string }) {
  const [metric, setMetric] = useState<Metric>('Balance');
  const [range, setRange] = useState<Range>('1M');
  const { points, currentTotal } = useClearPortfolioHistory();
  const { flows } = useClearTransactions();
  const data = useMemo(
    () => (metric === 'Balance' ? buildBalanceSeries(range, points, currentTotal) : buildFlowSeries(metric, range, flows)),
    [metric, range, points, currentTotal, flows],
  );
  const config = useMemo(
    () => ({ value: { label: metric, color: METRIC_COLOR[metric] } }) satisfies ChartConfig,
    [metric],
  );

  const isBalance = metric === 'Balance';
  const total = data.reduce((s, d) => s + d.value, 0);
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const heroValue = isBalance ? last : total;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;
  const up = change >= 0;

  return (
    <div className={cn('flex flex-col rounded-xl border border-border p-5', className)}>
      <div className="flex flex-wrap gap-5 border-b border-border pb-3 text-sm">
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            className={cn(
              'relative -mb-3 border-b-2 pb-3 font-medium transition-colors',
              metric === m ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="font-display text-3xl tracking-tight text-foreground tabular-nums">{fmtMoney(heroValue)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          {isBalance ? (
            <>
              <span className={cn('font-medium', up ? 'text-positive' : 'text-negative')}>
                {up ? '↑' : '↓'} {fmtMoney(Math.abs(change))} ({up ? '+' : ''}
                {changePct.toFixed(2)}%)
              </span>
              <span className="text-muted-foreground">over {range}</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              total {metric.toLowerCase()} over {range}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex-1 min-h-0">
        <ChartContainer config={config} height={220} fill>
          {isBalance ? (
            <AreaChart data={data} margin={MARGIN}>
              <defs>
                <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
              <ChartTooltip content={<ChartTooltipContent formatter={fmtMoney} />} />
              <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="url(#balFill)" />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
              <ChartTooltip content={<ChartTooltipContent formatter={fmtMoney} />} />
              {metric === 'Net' && <ReferenceLine y={0} stroke="rgb(var(--border))" />}
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
                shape={metric === 'Net' ? <DivergingBar /> : undefined}
              />
            </BarChart>
          )}
        </ChartContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              range === r ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
