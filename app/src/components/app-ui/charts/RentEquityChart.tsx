import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const config = {
  equity: { label: 'Equity from rent', color: 'rgb(var(--positive))' },
} satisfies ChartConfig;

interface Point {
  label: string;
  equity: number;
}

const tick = (v: number) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`);

/**
 * Equity credits earned each month from on-time rent (Clear Pay). Bars show the
 * monthly accrual; a missed/late month would read as a short bar — useful, not decorative.
 */
export default function RentEquityChart({
  data,
  className,
}: {
  data: Point[];
  className?: string;
}) {
  return (
    <ChartContainer config={config} height={190} className={className}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={48} fontSize={11} tickMargin={6} tickFormatter={tick} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="equity" fill="var(--color-equity)" radius={[6, 6, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ChartContainer>
  );
}
