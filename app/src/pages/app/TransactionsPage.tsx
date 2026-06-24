import { useState } from 'react';
import { Bell, ShoppingBag, Coffee, Music, ArrowDownLeft, type LucideIcon } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import SegmentedControl from '@/components/app-ui/SegmentedControl';
import SectionCard from '@/components/app-ui/SectionCard';

type Range = 'week' | 'month' | 'year';

const SERIES: Record<Range, { bars: number[]; labels: string[]; total: string; caption: string }> = {
  week: { bars: [40, 65, 30, 80, 55, 70, 45], labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], total: '$842.10', caption: 'Spent this week' },
  month: { bars: [52, 70, 44, 86, 60, 74, 50], labels: ['W1', 'W2', 'W3', 'W4', 'W5', '', ''], total: '$3,284.10', caption: 'Spent this month' },
  year: { bars: [30, 48, 60, 42, 70, 55, 80], labels: ['J', 'F', 'M', 'A', 'M', 'J', 'J'], total: '$38,902.55', caption: 'Spent this year' },
};

function CategoryCard({ label, amount, pct }: { label: string; amount: string; pct: string }) {
  return (
    <div className="rounded-3xl border border-black/[0.06] bg-card p-4 dark:border-white/[0.06]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl tracking-tight text-foreground tabular-nums">{amount}</div>
      <div className="mt-0.5 text-[11px] font-medium text-accent-foreground">{pct} of spend</div>
    </div>
  );
}

function Tx({ icon, title, sub, amount, incoming }: { icon: LucideIcon; title: string; sub: string; amount: string; incoming?: boolean }) {
  return (
    <SectionCard
      icon={icon}
      tint={incoming ? 'cash' : 'neutral'}
      title={title}
      subtitle={sub}
      amount={amount}
    />
  );
}

/**
 * Transactions — visual-first. Spending hero + range chart + category breakdown
 * + recent list. Scaffold: CSS bars + sample data; recharts + Plaid wiring TODO.
 */
export default function TransactionsPage() {
  const [range, setRange] = useState<Range>('month');
  const series = SERIES[range];

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

      <div className="mb-4">
        <span className="text-[13px] text-muted-foreground">{series.caption}</span>
        <div className="font-display text-5xl leading-none tracking-tight text-foreground tabular-nums">
          {series.total}
        </div>
      </div>

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
        <div className="lg:col-span-8">
          <div className="rounded-3xl border border-border bg-card p-5">
            <div className="flex h-36 items-end justify-between gap-2 lg:h-52">
              {series.bars.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full bg-primary/80 transition-all duration-500"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="mt-3 flex justify-between text-[10px] text-muted-foreground">
              {series.labels.map((d, i) => (
                <span key={i} className="flex-1 text-center">{d}</span>
              ))}
            </div>
          </div>

          <h3 className="mb-3 mt-7 text-xs font-medium text-muted-foreground">Top categories</h3>
          <div className="grid grid-cols-2 gap-3">
            <CategoryCard label="Shopping" amount="$1,204" pct="37%" />
            <CategoryCard label="Food & drink" amount="$842" pct="26%" />
          </div>
        </div>

        <div className="mt-7 lg:col-span-4 lg:mt-0">
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
