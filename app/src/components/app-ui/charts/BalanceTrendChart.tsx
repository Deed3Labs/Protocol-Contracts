import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const config = {
  value: { label: 'Balance', color: 'var(--chart-1)' },
} satisfies ChartConfig;

interface Point {
  label: string;
  value: number;
}

/** Total-balance trend (shadcn area chart). Tooltip carries exact values. */
export default function BalanceTrendChart({
  data,
  className,
}: {
  data: Point[];
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={cn('aspect-auto h-[170px]', className)}>
      <AreaChart data={data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillBalance" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.18} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis hide domain={['dataMin - 1500', 'dataMax + 1500']} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill="url(#fillBalance)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
