import { Wallet, Banknote, PiggyBank, Landmark, Home } from 'lucide-react';
import StatCard from '@/components/app-ui/StatCard';
import QuickActions from '@/components/app-ui/QuickActions';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar, { type UpcomingItem } from '@/components/app-ui/UpcomingCalendar';
import BalanceAnalyticsChart from '@/components/app-ui/charts/BalanceAnalyticsChart';

const SPEND_BY_DAY: Record<number, number> = {
  1: 1850, 2: 42, 3: 18, 4: 96, 5: 210, 6: 64, 8: 12, 9: 140, 10: 38,
  11: 9, 12: 75, 13: 320, 15: 54, 16: 22, 17: 88, 18: 240, 19: 16,
  20: 130, 21: 47, 22: 8, 23: 162, 24: 31,
};

const UPCOMING: UpcomingItem[] = [
  { id: 'rent', name: 'Rent', amount: 1850, day: 1, direction: 'out' },
  { id: 'gym', name: 'Gym', amount: 45, day: 5, direction: 'out' },
  { id: 'spotify', name: 'Spotify', amount: 12, day: 12, direction: 'out' },
  { id: 'payroll', name: 'Payroll', amount: 3200, day: 15, direction: 'in' },
  { id: 'netflix', name: 'Netflix', amount: 18, day: 15, direction: 'out' },
  { id: 'icloud', name: 'iCloud', amount: 3, day: 15, direction: 'out' },
  { id: 'card', name: 'Card', amount: 320, day: 22, direction: 'out' },
  { id: 'insurance', name: 'Insurance', amount: 140, day: 25, direction: 'out' },
  { id: 'internet', name: 'Internet', amount: 80, day: 25, direction: 'out' },
  { id: 'phone', name: 'Phone', amount: 65, day: 25, direction: 'out' },
  { id: 'water', name: 'Water', amount: 40, day: 25, direction: 'out' },
  { id: 'electric', name: 'Electric', amount: 124, day: 28, direction: 'out' },
  { id: 'hoa', name: 'HOA dues', amount: 210, day: 28, direction: 'out' },
];

/** Equity Credits → Clear Deed progress (non-redeemable). */
function ClearDeedCard() {
  const pct = 25;
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <Home className="h-5 w-5" />
        </span>
        <div>
          <div className="text-[15px] font-medium text-foreground">Clear Deed progress</div>
          <div className="text-xs text-muted-foreground">Credits + savings toward your home</div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Equity credits</div>
      <div className="font-display text-4xl tracking-tight text-foreground tabular-nums">$6,240</div>
      <div className="mt-1 text-[11px] text-muted-foreground">Non-withdrawable · applied at conversion</div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{pct}% to milestone · ~14 mo at this pace</span>
          <span>$25,000</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="mt-4 rounded-2xl bg-secondary p-3 text-xs leading-relaxed text-muted-foreground">
        Earn 1:1 equity credits on your CLRUSD savings (up to $1,500/mo), plus credits for on-time
        rent. Credits convert into your Clear Deed — they can't be cashed out.
      </p>
    </div>
  );
}

/**
 * Accounts — the dashboard. Stat row (Total / Cash / Savings / External), a big
 * balance-analytics chart, quick actions, recent activity, Clear Deed progress,
 * and the upcoming/spend calendars. Scaffold: placeholder figures.
 */
export default function AccountsPage() {
  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Good morning, Steven</h1>
        <p className="mt-1 text-sm text-muted-foreground">Here's where your money stands today.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total balance" value="$41,016.67" change="2.1% this week" icon={Wallet} />
        <StatCard label="Cash · USDC" value="$12,480.20" change="0.4%" icon={Banknote} />
        <StatCard label="Savings · CLRUSD" value="$24,092.67" change="1.8%" icon={PiggyBank} />
        <StatCard label="External · Plaid" value="$4,443.80" change="0.6%" changePositive={false} icon={Landmark} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <BalanceAnalyticsChart className="lg:col-span-2" />
        <QuickActions />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <RecentActivity className="lg:col-span-2" />
        <ClearDeedCard />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <UpcomingCalendar items={UPCOMING} />
        <SpendHeatmap spendingByDay={SPEND_BY_DAY} />
      </div>
    </div>
  );
}
