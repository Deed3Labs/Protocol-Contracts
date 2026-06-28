import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const METRICS = ['Equity', 'Rent', 'Total equity'] as const;
const RANGES = ['3M', '6M', '12M', 'YTD', 'All'] as const;
type Metric = (typeof METRICS)[number];
type Range = (typeof RANGES)[number];

export interface RentEquityPoint {
  label: string;
  rent: number; // rent paid that month
  equity: number; // cumulative equity credits through that month
}

const YTD_MONTHS = Math.max(1, new Date().getMonth() + 1);
const POINTS: Record<Range, number> = { '3M': 3, '6M': 6, '12M': 12, YTD: YTD_MONTHS, All: 12 };

/** Equity & Total-equity are positive (green); Rent paid is a neutral flow. */
const METRIC_COLOR: Record<Metric, string> = {
  Equity: 'rgb(var(--positive))',
  Rent: 'var(--chart-1)',
  'Total equity': 'rgb(var(--positive))',
};

/** Equity = per-month earned (delta of cumulative), Rent = per-month paid, Total equity = cumulative. */
function deriveData(series: RentEquityPoint[], metric: Metric, range: Range) {
  if (!series.length) return [];
  const withFlow = series.map((s, i) => ({
    label: s.label,
    rent: s.rent,
    cumEquity: s.equity,
    flowEquity: i === 0 ? s.equity : Math.max(0, s.equity - series[i - 1].equity),
  }));
  const n = Math.min(POINTS[range], withFlow.length);
  return withFlow.slice(-n).map((d) => ({
    label: d.label,
    value: metric === 'Equity' ? d.flowEquity : metric === 'Rent' ? d.rent : d.cumEquity,
  }));
}

const fmtMoney = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tick = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);
const MARGIN = { left: 0, right: 8, top: 8, bottom: 0 };

/**
 * Rent → equity analytics. Metric tabs (Equity / Rent / Total equity) pick the viz:
 * per-month flows render as bars, the running Total equity as an area. Hero figure +
 * change, plus a 6M/1Y/All range selector — same treatment as the Accounts chart.
 */
export default function RentEquityAnalyticsChart({ className, series = [] }: { className?: string; series?: RentEquityPoint[] }) {
  const [metric, setMetric] = useState<Metric>('Equity');
  const [range, setRange] = useState<Range>('6M');
  const data = useMemo(() => deriveData(series, metric, range), [series, metric, range]);
  const config = useMemo(
    () => ({ value: { label: metric, color: METRIC_COLOR[metric] } }) satisfies ChartConfig,
    [metric],
  );

  const isLevel = metric === 'Total equity';
  const total = data.reduce((s, d) => s + d.value, 0);
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const heroValue = isLevel ? last : total;
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
          <span className={cn('font-medium', up ? 'text-positive' : 'text-negative')}>
            {up ? '↑' : '↓'} {fmtMoney(Math.abs(change))} ({up ? '+' : ''}
            {changePct.toFixed(1)}%)
          </span>
          <span className="text-muted-foreground">
            {isLevel ? `over ${range}` : `total ${metric.toLowerCase()} over ${range}`}
          </span>
        </div>
      </div>

      <div className="mt-3 flex-1 min-h-0">
        <ChartContainer config={config} height={210} fill>
          {isLevel ? (
            <AreaChart data={data} margin={MARGIN}>
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
              <ChartTooltip content={<ChartTooltipContent formatter={fmtMoney} />} />
              <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="url(#eqFill)" />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
              <ChartTooltip content={<ChartTooltipContent formatter={fmtMoney} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={30} />
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
