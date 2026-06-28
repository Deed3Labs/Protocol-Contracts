import { useMemo, useState } from 'react';
import { Cell, Label, Pie, PieChart, type PieLabelRenderProps } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import type { Category } from '@/components/app-ui/TransactionFilterModal';
import { cn } from '@/lib/utils';

type Range = 'week' | 'month' | 'year';
const RANGES: { value: Range; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
const WINDOW_DAYS: Record<Range, number> = { week: 7, month: 30, year: 365 };
const SUB: Record<Range, string> = { week: 'this week', month: 'this month', year: 'this year' };

// Per-category slice colors (spending categories are the outflow ones).
const CATEGORY_COLORS: Record<Category, string> = {
  Card: 'rgb(var(--info))',
  Bill: '#8b5cf6',
  Subscription: '#06b6d4',
  Transfer: '#f59e0b',
  Deposit: '#10b981',
  Payroll: '#22c55e',
};

const config = {} satisfies ChartConfig;
const fmtTotal = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n).toLocaleString()}`);

/** Elbow leader-line geometry: slice edge → short radial leg → horizontal leg to the label. */
function elbow(cx: number, cy: number, midAngle: number, outerRadius: number) {
  const RADIAN = Math.PI / 180;
  const cos = Math.cos(-midAngle * RADIAN);
  const sin = Math.sin(-midAngle * RADIAN);
  const dir = cos >= 0 ? 1 : -1;
  const edge = { x: cx + outerRadius * cos, y: cy + outerRadius * sin };
  const bend = { x: cx + (outerRadius + 12) * cos, y: cy + (outerRadius + 12) * sin };
  const end = { x: bend.x + dir * 18, y: bend.y };
  return { edge, bend, end, dir };
}

/**
 * Spending-by-category donut from real transaction history (useClearTransactions). Sums outflows by
 * category over the selected window, with the period total in the middle and leader-line labels
 * (name + %) pointing from each slice. Week/Month/Year switcher in the footer.
 */
export default function CategoryRadial({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>('month');
  const { items, loading } = useClearTransactions();

  const data = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS[range] * 86_400_000;
    const byCat = new Map<Category, number>();
    for (const it of items) {
      if (it.amount < 0 && it.ts > 0 && it.ts >= cutoff) {
        byCat.set(it.category, (byCat.get(it.category) ?? 0) + Math.abs(it.amount));
      }
    }
    return [...byCat.entries()]
      .map(([name, value]) => ({ name, value, fill: CATEGORY_COLORS[name] ?? '#94a3b8' }))
      .sort((a, b) => b.value - a.value);
  }, [items, range]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const isEmpty = data.length === 0 || total <= 0;
  // A single muted ring stands in for the donut when there's nothing to show.
  const chartData = isEmpty ? [{ name: 'none', value: 1, fill: 'rgb(var(--muted))' }] : data;

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <h3 className="text-xs font-medium text-muted-foreground">Spending by category</h3>

      <div className="flex flex-1 items-center justify-center">
        <ChartContainer config={config} height={360} className="mx-auto w-full max-w-[520px]">
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            {!isEmpty && (
              <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v) => `$${Number(v).toLocaleString()}`} />} />
            )}
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius="52%"
              outerRadius="74%"
              paddingAngle={isEmpty ? 0 : 2}
              strokeWidth={2}
              stroke="rgb(var(--card))"
              isAnimationActive={!isEmpty}
              labelLine={
                isEmpty
                  ? false
                  : (p) => {
                      const { edge, bend, end } = elbow(Number(p.cx ?? 0), Number(p.cy ?? 0), Number(p.midAngle ?? 0), Number(p.outerRadius ?? 0));
                      return (
                        <polyline
                          points={`${edge.x},${edge.y} ${bend.x},${bend.y} ${end.x},${end.y}`}
                          stroke="rgb(var(--border))"
                          strokeWidth={1}
                          fill="none"
                        />
                      );
                    }
              }
              label={
                isEmpty
                  ? false
                  : (p: PieLabelRenderProps) => {
                      const { end, dir } = elbow(Number(p.cx ?? 0), Number(p.cy ?? 0), Number(p.midAngle ?? 0), Number(p.outerRadius ?? 0));
                      return (
                        <text
                          x={end.x + dir * 4}
                          y={end.y}
                          textAnchor={dir >= 0 ? 'start' : 'end'}
                          dominantBaseline="central"
                          className="fill-foreground"
                          fontSize={11}
                          fontWeight={500}
                        >
                          {`${p.payload?.name ?? ''} ${Math.round((p.percent ?? 0) * 100)}%`}
                        </text>
                      );
                    }
              }
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && typeof viewBox.cx === 'number' && typeof viewBox.cy === 'number') {
                    const { cx, cy } = viewBox;
                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                        <tspan x={cx} y={cy - 10} className="fill-foreground font-display" style={{ fontSize: 30, fontWeight: 600 }}>
                          {fmtTotal(isEmpty ? 0 : total)}
                        </tspan>
                        <tspan x={cx} y={cy + 17} className="fill-muted-foreground" style={{ fontSize: 12 }}>
                          {loading && isEmpty ? 'loading…' : `spent ${SUB[range]}`}
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

      {isEmpty && <p className="-mt-1 text-center text-xs text-muted-foreground">No spending {SUB[range]}.</p>}

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
