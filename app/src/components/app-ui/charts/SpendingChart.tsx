import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const config = {
  spending: { label: 'This period', color: 'var(--chart-1)' },
  previous: { label: 'Last period', color: 'var(--chart-3)' },
} satisfies ChartConfig;

interface Bucket {
  label: string;
  spending: number;
  previous: number;
}

const tick = (v: number) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`);

/**
 * Spending per bucket vs. last period (dashed line) with a budget reference line.
 * Real axis values + comparison context — answers "am I over budget / spending more?".
 */
export default function SpendingChart({
  data,
  budget,
  className,
}: {
  data: Bucket[];
  budget: number;
  className?: string;
}) {
  return (
    <ChartContainer config={config} height={210} className={className}>
      <ComposedChart data={data} margin={{ left: 0, right: 10, top: 14, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={38} fontSize={11} tickFormatter={tick} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ReferenceLine
          y={budget}
          stroke="var(--color-previous)"
          strokeDasharray="5 4"
          strokeWidth={1}
          label={{ value: 'Budget', position: 'insideTopRight', fontSize: 10, fill: 'var(--color-previous)' }}
        />
        <Bar dataKey="spending" fill="var(--color-spending)" radius={[6, 6, 0, 0]} maxBarSize={30} />
        <Line
          dataKey="previous"
          type="monotone"
          stroke="var(--color-previous)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
