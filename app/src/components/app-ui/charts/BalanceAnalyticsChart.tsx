import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

type Range = '1W' | '1M' | '1Y';

const config = {
  inflow: { label: 'Money in', color: 'var(--chart-1)' },
  outflow: { label: 'Money out', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const SERIES: Record<Range, { label: string; inflow: number; outflow: number }[]> = {
  '1W': [
    { label: 'Mon', inflow: 420, outflow: 315 },
    { label: 'Tue', inflow: 380, outflow: 290 },
    { label: 'Wed', inflow: 460, outflow: 250 },
    { label: 'Thu', inflow: 410, outflow: 360 },
    { label: 'Fri', inflow: 520, outflow: 300 },
    { label: 'Sat', inflow: 300, outflow: 210 },
    { label: 'Sun', inflow: 360, outflow: 180 },
  ],
  '1M': [
    { label: 'W1', inflow: 3200, outflow: 2400 },
    { label: 'W2', inflow: 3600, outflow: 2900 },
    { label: 'W3', inflow: 3100, outflow: 2600 },
    { label: 'W4', inflow: 4200, outflow: 3100 },
  ],
  '1Y': [
    { label: 'Q1', inflow: 38000, outflow: 31000 },
    { label: 'Q2', inflow: 42000, outflow: 35000 },
    { label: 'Q3', inflow: 39500, outflow: 33000 },
    { label: 'Q4', inflow: 46000, outflow: 37000 },
  ],
};

const ranges: Range[] = ['1W', '1M', '1Y'];
const tick = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);

/** Big balance-analytics area chart with money-in / money-out series + range tabs. */
export default function BalanceAnalyticsChart({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>('1M');
  const data = SERIES[range];

  return (
    <div className={cn('rounded-3xl border border-border bg-card p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Balance analytics</div>
          <div className="mt-1 font-display text-2xl tracking-tight text-foreground tabular-nums">$43,897.50</div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-1)' }} /> Money in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-3)' }} /> Money out
            </span>
          </div>
        </div>
        <div className="flex gap-1 rounded-full bg-secondary p-1">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                range === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <ChartContainer config={config} className="aspect-auto h-[240px]">
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fillIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-inflow)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--color-inflow)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillOut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-outflow)" stopOpacity={0.16} />
              <stop offset="95%" stopColor="var(--color-outflow)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={tick} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area dataKey="inflow" type="monotone" stroke="var(--color-inflow)" strokeWidth={2} fill="url(#fillIn)" />
          <Area dataKey="outflow" type="monotone" stroke="var(--color-outflow)" strokeWidth={2} fill="url(#fillOut)" />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
