import { useState } from 'react';
import { Receipt, ArrowDownLeft, TrendingUp, Hash } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import SpendingChart from '@/components/app-ui/charts/SpendingChart';
import CategoryRadial from '@/components/app-ui/charts/CategoryRadial';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import { cn } from '@/lib/utils';

const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] as const;
type Range = (typeof RANGES)[number];

const SPEND_META: Record<Range, { labels: string[]; base: number; budget: number; caption: string }> = {
  '1D': { labels: ['12a', '4a', '8a', '12p', '4p', '8p'], base: 42, budget: 70, caption: 'Spent today' },
  '1W': { labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], base: 120, budget: 160, caption: 'Spent this week' },
  '1M': { labels: ['W1', 'W2', 'W3', 'W4'], base: 820, budget: 900, caption: 'Spent this month' },
  '3M': { labels: ['Apr', 'May', 'Jun'], base: 3100, budget: 3400, caption: 'Spent · 3 months' },
  '6M': { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], base: 3150, budget: 3400, caption: 'Spent · 6 months' },
  YTD: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], base: 3250, budget: 3400, caption: 'Spent · YTD' },
  '1Y': { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], base: 3200, budget: 3400, caption: 'Spent · 1 year' },
  All: { labels: ['2021', '2022', '2023', '2024', '2025', '2026'], base: 34000, budget: 40000, caption: 'Spent · all time' },
};

function buildSpend(range: Range) {
  const { labels, base, budget, caption } = SPEND_META[range];
  const buckets = labels.map((label, i) => ({
    label,
    spending: Math.round(base * (0.78 + 0.42 * (0.5 + 0.5 * Math.sin(i * 0.95 + 0.6)))),
    previous: Math.round(base * (0.82 + 0.36 * (0.5 + 0.5 * Math.sin(i * 0.7 + 1.7)))),
  }));
  const total = buckets.reduce((sum, b) => sum + b.spending, 0);
  const prev = buckets.reduce((sum, b) => sum + b.previous, 0);
  const pct = prev ? Math.round(((total - prev) / prev) * 100) : 0;
  const over = buckets.filter((b) => b.spending > budget).length;
  return {
    buckets,
    budget,
    caption,
    total: `$${total.toLocaleString()}`,
    delta: { text: `${Math.abs(pct)}% vs prev`, positive: total <= prev },
    insight: over > 0 ? `${over} over budget` : 'under budget',
  };
}

const SPEND_BY_DAY: Record<number, number> = {
  1: 1850, 2: 42, 3: 18, 4: 96, 5: 210, 6: 64, 8: 12, 9: 140, 10: 38,
  11: 9, 12: 75, 13: 320, 15: 54, 16: 22, 17: 88, 18: 240, 19: 16,
  20: 130, 21: 47, 22: 8, 23: 162, 24: 31,
};

/** Transactions — visual-first dashboard: stat row, spending chart, category donut, activity, heatmap. */
export default function TransactionsPage() {
  const [range, setRange] = useState<Range>('1M');
  const s = buildSpend(range);

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track and visualize where your money moves.</p>
      </header>

      <StatBar
        stats={[
          { label: 'Spent this month', value: '$3,284.10', change: '5% vs last mo', changePositive: false, icon: Receipt },
          { label: 'Income this month', value: '$5,640.00', change: '3% vs last mo', icon: ArrowDownLeft },
          { label: 'Net flow', value: '+$2,355.90', change: 'on track', icon: TrendingUp },
          { label: 'Transactions', value: '84', icon: Hash },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          label={s.caption}
          value={s.total}
          delta={s.delta}
          insight={s.insight}
          footer={
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    range === r ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          }
        >
          <SpendingChart data={s.buckets} budget={s.budget} />
        </ChartCard>
        <CategoryRadial />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RecentActivity />
        <SpendHeatmap spendingByDay={SPEND_BY_DAY} />
      </div>
    </div>
  );
}
