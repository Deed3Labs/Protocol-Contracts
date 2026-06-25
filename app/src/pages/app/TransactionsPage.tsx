import { useState } from 'react';
import { Receipt, ArrowDownLeft, TrendingUp, Hash } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import SegmentedControl from '@/components/app-ui/SegmentedControl';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import SpendingChart from '@/components/app-ui/charts/SpendingChart';
import CategoryRadar from '@/components/app-ui/charts/CategoryRadar';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';

type Range = 'week' | 'month' | 'year';

interface RangeData {
  total: string;
  caption: string;
  delta: { text: string; positive: boolean };
  insight: string;
  budget: number;
  buckets: { label: string; spending: number; previous: number }[];
}

const SERIES: Record<Range, RangeData> = {
  week: {
    total: '$842.10', caption: 'Spent this week', delta: { text: '8% vs last week', positive: false }, insight: '$108 under budget', budget: 150,
    buckets: [
      { label: 'M', spending: 120, previous: 110 }, { label: 'T', spending: 86, previous: 95 },
      { label: 'W', spending: 40, previous: 60 }, { label: 'T', spending: 150, previous: 140 },
      { label: 'F', spending: 95, previous: 120 }, { label: 'S', spending: 210, previous: 180 },
      { label: 'S', spending: 141, previous: 150 },
    ],
  },
  month: {
    total: '$3,284.10', caption: 'Spent this month', delta: { text: '5% vs last month', positive: false }, insight: '$416 under budget', budget: 900,
    buckets: [
      { label: 'W1', spending: 820, previous: 900 }, { label: 'W2', spending: 910, previous: 860 },
      { label: 'W3', spending: 640, previous: 700 }, { label: 'W4', spending: 914, previous: 980 },
    ],
  },
  year: {
    total: '$38,902.55', caption: 'Spent this year', delta: { text: '3% vs last year', positive: true }, insight: 'tracking to budget', budget: 6500,
    buckets: [
      { label: 'Jan', spending: 5200, previous: 4800 }, { label: 'Feb', spending: 6100, previous: 5600 },
      { label: 'Mar', spending: 5400, previous: 6000 }, { label: 'Apr', spending: 7200, previous: 5900 },
      { label: 'May', spending: 6800, previous: 7000 }, { label: 'Jun', spending: 8200, previous: 7600 },
    ],
  },
};

const SPEND_BY_DAY: Record<number, number> = {
  1: 1850, 2: 42, 3: 18, 4: 96, 5: 210, 6: 64, 8: 12, 9: 140, 10: 38,
  11: 9, 12: 75, 13: 320, 15: 54, 16: 22, 17: 88, 18: 240, 19: 16,
  20: 130, 21: 47, 22: 8, 23: 162, 24: 31,
};

/** Transactions — visual-first dashboard: stat row, spending chart, category donut, activity, heatmap. */
export default function TransactionsPage() {
  const [range, setRange] = useState<Range>('month');
  const s = SERIES[range];

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
          action={
            <SegmentedControl
              className="w-[210px]"
              value={range}
              onChange={setRange}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: 'year', label: 'Year' },
              ]}
            />
          }
        >
          <SpendingChart data={s.buckets} budget={s.budget} />
        </ChartCard>
        <CategoryRadar />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RecentActivity />
        <SpendHeatmap spendingByDay={SPEND_BY_DAY} />
      </div>
    </div>
  );
}
