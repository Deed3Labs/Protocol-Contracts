import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const METRICS = ['Balance', 'Income', 'Spending', 'Net'] as const;
const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] as const;
type Metric = (typeof METRICS)[number];
type Range = (typeof RANGES)[number];

const POINTS: Record<Range, number> = { '1D': 24, '1W': 7, '1M': 30, '3M': 13, '6M': 26, YTD: 24, '1Y': 12, All: 24 };
const BASE: Record<Metric, number> = { Balance: 41016, Income: 5640, Spending: 3284, Net: 2356 };
/** Per-metric accent: Balance=blue, Income=green, Spending=red, Net=green (bars recolor by sign). */
const METRIC_COLOR: Record<Metric, string> = {
  Balance: 'rgb(var(--info))',
  Income: 'rgb(var(--positive))',
  Spending: 'rgb(var(--negative))',
  Net: 'rgb(var(--positive))',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function labelFor(range: Range, i: number, n: number): string {
  if (range === '1D') return `${String(Math.round((i / Math.max(1, n - 1)) * 24)).padStart(2, '0')}:00`;
  if (range === '1W') return DAYS[i] ?? '';
  if (range === '1Y' || range === 'YTD' || range === 'All') return MONTHS[i % 12] ?? '';
  return `${i + 1}`;
}

/** Months each range spans — scales per-bucket flow amounts so range totals stay realistic. */
const RANGE_MONTHS: Record<Range, number> = { '1D': 1 / 30, '1W': 0.25, '1M': 1, '3M': 3, '6M': 6, YTD: 6, '1Y': 12, All: 24 };

/** Balance is a cumulative level (area); Income/Spending/Net are per-period flows (bars). */
function buildSeries(metric: Metric, range: Range) {
  const n = POINTS[range];
  const base = BASE[metric];
  const out: { label: string; value: number }[] = [];

  if (metric === 'Balance') {
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const wave = Math.sin(i * 0.8) * 0.035 + Math.sin(i * 0.31 + 1) * 0.025;
      out.push({ label: labelFor(range, i, n), value: Math.round(base * (0.95 + 0.1 * t + wave)) });
    }
    return out;
  }

  // Flows: scale per bucket so the total over the range ≈ base × months spanned.
  const perBucket = (base * RANGE_MONTHS[range]) / n;
  for (let i = 0; i < n; i++) {
    let value: number;
    if (metric === 'Net') {
      const swing = Math.sin(i * 0.9) * 1.0 + Math.sin(i * 0.45 + 2) * 0.7;
      value = perBucket * (1 + swing); // net flow — can dip negative
    } else {
      const seed = metric === 'Spending' ? 1.5 : 0;
      value = perBucket * (0.6 + 0.8 * (0.5 + 0.5 * Math.sin(i * 0.7 + seed)));
    }
    out.push({ label: labelFor(range, i, n), value: Math.round(value) });
  }
  return out;
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
  const data = useMemo(() => buildSeries(metric, range), [metric, range]);
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
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
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

      <div className="mt-3 flex-1">
        <ChartContainer config={config} height={220}>
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
