import { Wallet, Banknote, PiggyBank, Landmark } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import QuickActions from '@/components/app-ui/QuickActions';
import CtaStack from '@/components/app-ui/CtaStack';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar, { type UpcomingItem } from '@/components/app-ui/UpcomingCalendar';
import BalanceAnalyticsChart from '@/components/app-ui/charts/BalanceAnalyticsChart';
import ClearDeedCard from '@/components/app-ui/ClearDeedCard';

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

      <StatBar
        stats={[
          { label: 'Total balance', value: '$41,016.67', change: '2.1% this week', icon: Wallet },
          { label: 'Cash · USDC', value: '$12,480.20', change: '0.4%', icon: Banknote },
          { label: 'Savings · CLRUSD', value: '$24,092.67', change: '1.8%', icon: PiggyBank },
          { label: 'External · Plaid', value: '$4,443.80', change: '0.6%', changePositive: false, icon: Landmark },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <BalanceAnalyticsChart className="lg:col-span-2" />
        <div className="flex flex-col gap-5">
          <CtaStack />
          <QuickActions />
        </div>
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
