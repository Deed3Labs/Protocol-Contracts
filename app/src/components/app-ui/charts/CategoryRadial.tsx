import { useState } from 'react';
import { Cell, Label, Pie, PieChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

type Range = 'week' | 'month' | 'year';
const RANGES: { value: Range; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const NAMES = ['Shopping', 'Food', 'Transport', 'Subs', 'Other'];
const COLORS = ['rgb(var(--info))', '#8b5cf6', '#06b6d4', '#f59e0b', '#94a3b8'];
const VALUES: Record<Range, number[]> = {
  week: [280, 196, 92, 66, 124],
  month: [1204, 842, 418, 286, 534],
  year: [13800, 9650, 4920, 3420, 6180],
};
const SUB: Record<Range, string> = { week: 'this week', month: 'this month', year: 'this year' };

const config = {} satisfies ChartConfig;
const fmtTotal = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString()}`);

/**
 * Spending-by-category donut — fills the card with the period total in the middle and
 * leader-line labels (name + %) pointing from each slice instead of a legend. A
 * Week/Month/Year switcher sits in the footer.
 */
export default function CategoryRadial({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>('month');
  const data = NAMES.map((name, i) => ({ name, value: VALUES[range][i], fill: COLORS[i] }));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <h3 className="text-xs font-medium text-muted-foreground">Spending by category</h3>

      <div className="flex flex-1 items-center justify-center">
        <ChartContainer config={config} height={270} className="w-full">
          <PieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
            <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v) => `$${Number(v).toLocaleString()}`} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={2}
              strokeWidth={2}
              stroke="rgb(var(--card))"
              labelLine={{ stroke: 'rgb(var(--border))' }}
              label={(p: { x: number; y: number; cx: number; percent: number; payload: { name: string } }) => (
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor={p.x > p.cx ? 'start' : 'end'}
                  dominantBaseline="central"
                  className="fill-foreground"
                  fontSize={10}
                  fontWeight={500}
                >
                  {`${p.payload.name} ${Math.round(p.percent * 100)}%`}
                </text>
              )}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && typeof viewBox.cx === 'number' && typeof viewBox.cy === 'number') {
                    const { cx, cy } = viewBox;
                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                        <tspan x={cx} y={cy - 8} className="fill-foreground font-display" style={{ fontSize: 21, fontWeight: 600 }}>
                          {fmtTotal(total)}
                        </tspan>
                        <tspan x={cx} y={cy + 13} className="fill-muted-foreground" style={{ fontSize: 10 }}>
                          {SUB[range]}
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </div>

      {/* range footer */}
      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              range === r.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
