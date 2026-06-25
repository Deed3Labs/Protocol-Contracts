import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const config = {
  spending: { label: 'This period', color: 'rgb(var(--positive))' },
  previous: { label: 'Last period', color: 'var(--chart-4)' },
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
        <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ReferenceLine
          y={budget}
          stroke="rgb(var(--info))"
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{ value: 'Budget', position: 'insideTopRight', fontSize: 10, fill: 'rgb(var(--info))' }}
        />
        <Bar dataKey="spending" fill="var(--color-spending)" radius={[6, 6, 0, 0]} maxBarSize={30}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.spending > budget ? 'rgb(var(--negative))' : 'var(--color-spending)'} />
          ))}
        </Bar>
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
