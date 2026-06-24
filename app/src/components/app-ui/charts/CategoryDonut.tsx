import { Cell, Pie, PieChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const data = [
  { name: 'Shopping', value: 1204 },
  { name: 'Food & drink', value: 842 },
  { name: 'Transport', value: 418 },
  { name: 'Subscriptions', value: 286 },
  { name: 'Other', value: 534 },
];
const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const config = {} satisfies ChartConfig;

/** Spending-by-category donut with a legend (matches the reference dashboards). */
export default function CategoryDonut({ className }: { className?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className={cn('rounded-3xl border border-border bg-card p-5', className)}>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Spending by category</h3>
      <div className="flex items-center gap-4">
        <ChartContainer config={config} height={136} className="w-[136px] shrink-0">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={2} strokeWidth={0}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex-1 space-y-2">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i] }} />
                {d.name}
              </span>
              <span className="tabular-nums text-foreground">{Math.round((d.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
