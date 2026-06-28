import { Wallet, Banknote, PiggyBank, Landmark, ShieldCheck } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { useKyc } from '@/context/KycContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
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
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsPage() {
  const { verified, openKyc } = useKyc();
  const bal = useClearBalances();
  const ext = useExternalAccounts();
  const dash = (v: number) => (bal.loading ? '—' : fmtUsd(v));
  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Good morning, Steven</h1>
        <p className="mt-1 text-sm text-muted-foreground">Here's where your money stands today.</p>
      </div>

      {!verified && (
        <button
          type="button"
          onClick={() => openKyc()}
          className="flex w-full items-center gap-3 rounded-xl border border-info/20 bg-info/5 p-3 text-left transition-colors hover:bg-info/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Verify your identity</span>
            <span className="block text-xs text-muted-foreground">Unlock bank deposits, withdrawals, transfers &amp; bill pay.</span>
          </span>
          <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Verify</span>
        </button>
      )}

      <StatBar
        stats={[
          { label: 'Total balance', value: dash(bal.cash + bal.savings + ext.totalBalance), change: '2.1% this week', icon: Wallet },
          { label: 'Cash · USDC', value: dash(bal.cash), change: '0.4%', icon: Banknote },
          { label: 'Savings · CLRUSD', value: dash(bal.savings), change: '1.8%', icon: PiggyBank },
          { label: 'External · Plaid', value: fmtUsd(ext.totalBalance), change: '0.6%', changePositive: false, icon: Landmark },
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
        <UpcomingCalendar items={UPCOMING} />
        <SpendHeatmap spendingByDay={SPEND_BY_DAY} />
        <ClearDeedCard />
      </div>

      <RecentActivity limit={5} />
    </div>
  );
}
