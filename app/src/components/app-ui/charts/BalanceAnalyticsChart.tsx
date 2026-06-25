import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const METRICS = ['Balance', 'Income', 'Spending', 'Net'] as const;
const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] as const;
type Metric = (typeof METRICS)[number];
type Range = (typeof RANGES)[number];

const POINTS: Record<Range, number> = { '1D': 24, '1W': 7, '1M': 30, '3M': 13, '6M': 26, YTD: 24, '1Y': 12, All: 24 };
const BASE: Record<Metric, number> = { Balance: 41016, Income: 5640, Spending: 3284, Net: 2356 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function labelFor(range: Range, i: number, n: number): string {
  if (range === '1D') return `${String(Math.round((i / Math.max(1, n - 1)) * 24)).padStart(2, '0')}:00`;
  if (range === '1W') return DAYS[i] ?? '';
  if (range === '1Y' || range === 'YTD' || range === 'All') return MONTHS[i % 12] ?? '';
  return `${i + 1}`;
}

function buildSeries(metric: Metric, range: Range) {
  const n = POINTS[range];
  const base = BASE[metric];
  const growth = metric === 'Spending' ? -0.04 : metric === 'Balance' ? 0.1 : 0.06;
  const out: { label: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const wave = Math.sin(i * 0.8) * 0.035 + Math.sin(i * 0.31 + 1) * 0.025;
    out.push({ label: labelFor(range, i, n), value: Math.max(0, Math.round(base * (1 - growth / 2 + growth * t + wave))) });
  }
  return out;
}

const fmtMoney = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tick = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);

/**
 * Main analytics chart — modeled on the old portfolio/brokerage chart: metric tabs,
 * a hero figure + change %, an area chart, and a full range selector (1D…All).
 */
export default function BalanceAnalyticsChart({ className }: { className?: string }) {
  const [metric, setMetric] = useState<Metric>('Balance');
  const [range, setRange] = useState<Range>('1M');
  const data = useMemo(() => buildSeries(metric, range), [metric, range]);
  const config = useMemo(
    () => ({ value: { label: metric, color: 'var(--chart-1)' } }) satisfies ChartConfig,
    [metric],
  );

  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1]?.value ?? 0;
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
        <div className="font-display text-3xl tracking-tight text-foreground tabular-nums">{fmtMoney(last)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          <span className={cn('font-medium', up ? 'text-foreground' : 'text-destructive')}>
            {up ? '↑' : '↓'} {fmtMoney(Math.abs(change))} ({up ? '+' : ''}
            {changePct.toFixed(2)}%)
          </span>
          <span className="text-muted-foreground">over {range}</span>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <ChartContainer config={config} height={220}>
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
            <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
            <ChartTooltip content={<ChartTooltipContent formatter={fmtMoney} />} />
            <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="url(#balFill)" />
          </AreaChart>
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
