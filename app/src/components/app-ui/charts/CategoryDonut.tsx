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

/** Spending-by-category donut with a legend. Content fills the card height. */
export default function CategoryDonut({ className }: { className?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Spending by category</h3>
      <div className="flex flex-1 items-center gap-5">
        <ChartContainer config={config} height={164} className="w-[164px] shrink-0">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-1 flex-col justify-center gap-3">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[i] }} />
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
