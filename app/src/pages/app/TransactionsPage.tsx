import { useMemo, useState } from 'react';
import { Receipt, ArrowDownLeft, TrendingUp, Hash } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import SpendingChart from '@/components/app-ui/charts/SpendingChart';
import CategoryRadial from '@/components/app-ui/charts/CategoryRadial';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar from '@/components/app-ui/UpcomingCalendar';
import BudgetGoals from '@/components/app-ui/BudgetGoals';
import { useClearTransactions, type CashFlow } from '@/hooks/useClearTransactions';
import { useUpcoming } from '@/hooks/useUpcoming';
import { flowBuckets, spendingIn, type FlowRange } from '@/lib/cashflow';
import { cn } from '@/lib/utils';

const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] as const;
type Range = (typeof RANGES)[number];

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Real spending trend (current vs prior equal-length period) from transaction flows. */
function buildSpend(range: Range, flows: CashFlow[]) {
  const buckets = flowBuckets(range as FlowRange);
  const span = buckets.length ? buckets[buckets.length - 1].end - buckets[0].start : 0;
  const data = buckets.map((b) => ({
    label: b.label,
    spending: Math.round(spendingIn(flows, b)),
    previous: Math.round(spendingIn(flows, { start: b.start - span, end: b.end - span, label: '' })),
  }));
  const total = data.reduce((s, b) => s + b.spending, 0);
  const prev = data.reduce((s, b) => s + b.previous, 0);
  const pct = prev ? Math.round(((total - prev) / prev) * 100) : 0;
  const budget = total > 0 ? Math.round(total * 1.25) : 100; // placeholder until user budgets exist
  return {
    buckets: data,
    budget,
    caption: `Spent · ${range}`,
    total: fmt(total),
    delta: { text: prev > 0 ? `${Math.abs(pct)}% vs prev` : 'no prior data', positive: total <= prev },
    insight: total <= budget ? 'under budget' : 'over budget',
  };
}

/** Transactions — visual-first dashboard: stat row, spending chart, category donut, activity, heatmap. */
export default function TransactionsPage() {
  const [range, setRange] = useState<Range>('1M');
  const { flows, items } = useClearTransactions();
  const upcoming = useUpcoming();

  const s = useMemo(() => buildSpend(range, flows), [range, flows]);

  const stats = useMemo(() => {
    const now = new Date();
    const inMonth = (ts: number) => {
      const d = new Date(ts);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const month = flows.filter((f) => inMonth(f.ts));
    const spent = Math.abs(month.filter((f) => f.usd < 0).reduce((a, f) => a + f.usd, 0));
    const income = month.filter((f) => f.usd > 0).reduce((a, f) => a + f.usd, 0);
    const byDay: Record<number, number> = {};
    for (const f of month) {
      if (f.usd >= 0) continue;
      const day = new Date(f.ts).getDate();
      byDay[day] = (byDay[day] || 0) + Math.abs(f.usd);
    }
    return { spent, income, net: income - spent, byDay };
  }, [flows]);

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track and visualize where your money moves.</p>
      </header>

      <StatBar
        stats={[
          { label: 'Spent this month', value: fmt(stats.spent), icon: Receipt },
          { label: 'Income this month', value: fmt(stats.income), icon: ArrowDownLeft },
          { label: 'Net flow', value: `${stats.net >= 0 ? '+' : '-'}${fmt(Math.abs(stats.net))}`, icon: TrendingUp },
          { label: 'Transactions', value: String(items.length), icon: Hash },
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

      <RecentActivity />

      <div className="grid gap-5 lg:grid-cols-3">
        <UpcomingCalendar items={upcoming} />
        <SpendHeatmap spendingByDay={stats.byDay} />
        <BudgetGoals />
      </div>
    </div>
  );
}
