import { useState } from 'react';
import { Bell, ShoppingBag, Coffee, Music, ArrowDownLeft, type LucideIcon } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import SegmentedControl from '@/components/app-ui/SegmentedControl';
import SectionCard from '@/components/app-ui/SectionCard';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import SpendingChart from '@/components/app-ui/charts/SpendingChart';

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
    total: '$842.10',
    caption: 'Spent this week',
    delta: { text: '8% vs last week', positive: false },
    insight: '$108 under budget',
    budget: 150,
    buckets: [
      { label: 'M', spending: 120, previous: 110 },
      { label: 'T', spending: 86, previous: 95 },
      { label: 'W', spending: 40, previous: 60 },
      { label: 'T', spending: 150, previous: 140 },
      { label: 'F', spending: 95, previous: 120 },
      { label: 'S', spending: 210, previous: 180 },
      { label: 'S', spending: 141, previous: 150 },
    ],
  },
  month: {
    total: '$3,284.10',
    caption: 'Spent this month',
    delta: { text: '5% vs last month', positive: false },
    insight: '$416 under budget',
    budget: 900,
    buckets: [
      { label: 'W1', spending: 820, previous: 900 },
      { label: 'W2', spending: 910, previous: 860 },
      { label: 'W3', spending: 640, previous: 700 },
      { label: 'W4', spending: 914, previous: 980 },
    ],
  },
  year: {
    total: '$38,902.55',
    caption: 'Spent this year',
    delta: { text: '3% vs last year', positive: true },
    insight: 'tracking to budget',
    budget: 6500,
    buckets: [
      { label: 'Jan', spending: 5200, previous: 4800 },
      { label: 'Feb', spending: 6100, previous: 5600 },
      { label: 'Mar', spending: 5400, previous: 6000 },
      { label: 'Apr', spending: 7200, previous: 5900 },
      { label: 'May', spending: 6800, previous: 7000 },
      { label: 'Jun', spending: 8200, previous: 7600 },
    ],
  },
};

function CategoryRow({ label, amount, pct, change, up }: { label: string; amount: string; pct: number; change: string; up: boolean }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="font-display text-xl tracking-tight text-foreground tabular-nums">{amount}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{pct}% of spend</span>
        <span>{up ? '↑' : '↓'} {change} vs last month</span>
      </div>
    </div>
  );
}

function Tx({ icon, title, sub, amount, incoming }: { icon: LucideIcon; title: string; sub: string; amount: string; incoming?: boolean }) {
  return <SectionCard icon={icon} tint={incoming ? 'cash' : 'neutral'} title={title} subtitle={sub} amount={amount} />;
}

/**
 * Transactions — visual-first. Insight-led spending chart (vs budget + last period),
 * category breakdown with change, and recent activity. Scaffold: sample data.
 */
export default function TransactionsPage() {
  const [range, setRange] = useState<Range>('month');
  const s = SERIES[range];

  return (
    <div className="animate-fade-in">
      <ScreenHeader
        title="Transactions"
        action={
          <button
            type="button"
            aria-label="Notifications"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          >
            <Bell className="h-[18px] w-[18px]" />
          </button>
        }
      />

      <SegmentedControl
        className="mb-5 lg:max-w-xs"
        value={range}
        onChange={setRange}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="space-y-6 lg:col-span-7">
          <ChartCard label={s.caption} value={s.total} delta={s.delta} insight={s.insight}>
            <SpendingChart data={s.buckets} budget={s.budget} />
          </ChartCard>

          <div>
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">Top categories</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CategoryRow label="Shopping" amount="$1,204" pct={37} change="8%" up />
              <CategoryRow label="Food & drink" amount="$842" pct={26} change="4%" up={false} />
              <CategoryRow label="Transport" amount="$418" pct={13} change="2%" up={false} />
              <CategoryRow label="Subscriptions" amount="$286" pct={9} change="0%" up />
            </div>
          </div>
        </div>

        <div className="mt-6 lg:col-span-5 lg:mt-0">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">Recent</h3>
          <div className="space-y-2.5">
            <Tx icon={ShoppingBag} title="Amazon" sub="Today · 4:12 PM" amount="-$9.50" />
            <Tx icon={Coffee} title="Blue Bottle" sub="Today · 9:03 AM" amount="-$5.25" />
            <Tx icon={Music} title="Spotify" sub="Yesterday" amount="-$11.99" />
            <Tx icon={ArrowDownLeft} title="Payroll — Acme" sub="Yesterday" amount="+$3,200.00" incoming />
          </div>
        </div>
      </div>
    </div>
  );
}
