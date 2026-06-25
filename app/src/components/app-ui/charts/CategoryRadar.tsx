import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const data = [
  { category: 'Shopping', current: 1204, previous: 980 },
  { category: 'Food', current: 842, previous: 910 },
  { category: 'Transport', current: 418, previous: 360 },
  { category: 'Subscriptions', current: 286, previous: 286 },
  { category: 'Other', current: 534, previous: 600 },
];

const config = {
  current: { label: 'This month', color: 'rgb(var(--info))' },
  previous: { label: 'Last month', color: 'rgb(var(--muted-foreground))' },
} satisfies ChartConfig;

/**
 * Spending-by-category radar — two layers (this vs last month) so the spend shape across
 * categories reads at a glance. Category names live on the axes (no detached legend) and
 * the chart fills the card. Restrained palette: a blue accent + neutral.
 */
export default function CategoryRadar({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Spending by category</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-info" />
            This month
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            Last
          </span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <ChartContainer config={config} height={320} className="w-full">
          <RadarChart data={data} outerRadius="74%" margin={{ top: 14, right: 18, bottom: 14, left: 18 }}>
            <ChartTooltip content={<ChartTooltipContent />} />
            <PolarGrid stroke="rgb(var(--border))" />
            <PolarAngleAxis dataKey="category" tick={{ fill: 'rgb(var(--foreground))', fontSize: 11 }} />
            <Radar dataKey="previous" fill="var(--color-previous)" fillOpacity={0.1} stroke="var(--color-previous)" strokeWidth={1.5} />
            <Radar
              dataKey="current"
              fill="var(--color-current)"
              fillOpacity={0.35}
              stroke="var(--color-current)"
              strokeWidth={2}
              dot={{ r: 2.5, fillOpacity: 1 }}
            />
          </RadarChart>
        </ChartContainer>
      </div>
    </div>
  );
}
