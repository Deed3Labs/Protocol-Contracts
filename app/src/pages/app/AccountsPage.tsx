import { useMemo } from 'react';
import { Wallet, Banknote, PiggyBank, Landmark, ShieldCheck } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { useKyc } from '@/context/KycContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useLinkedWalletBalances } from '@/hooks/useLinkedWalletBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useClearPortfolioHistory } from '@/hooks/useClearPortfolioHistory';
import { useUpcoming } from '@/hooks/useUpcoming';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import QuickActions from '@/components/app-ui/QuickActions';
import CtaStack from '@/components/app-ui/CtaStack';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar from '@/components/app-ui/UpcomingCalendar';
import BalanceAnalyticsChart from '@/components/app-ui/charts/BalanceAnalyticsChart';
import ClearDeedCard from '@/components/app-ui/ClearDeedCard';

/**
 * Accounts — the dashboard. Stat row (Total / Cash / Savings / External), a big
 * balance-analytics chart, quick actions, recent activity, Clear Deed progress,
 * and the upcoming/spend calendars.
 */
export default function AccountsPage() {
  const { verified, openKyc } = useKyc();
  const bal = useClearBalances();
  const ext = useExternalAccounts();
  const { externalWallets } = useLinkedWallets();
  const { balances: linkedBalances } = useLinkedWalletBalances(
    externalWallets.map((w) => w.address),
    externalWallets.length > 0,
  );
  const { items } = useClearTransactions();
  const history = useClearPortfolioHistory();
  const upcoming = useUpcoming();
  const { firstName } = useMemberProfile();

  // Real trailing-7-day change for a metric, from the backend balance-history series (returns nothing
  // until there's enough history to compare). Cash/Savings share the on-chain series — we snapshot the
  // combined on-chain total, not each token, so both reflect the same on-chain trend.
  const weekChange = (field: 'totalUsd' | 'onchainUsd' | 'bankUsd'): { change?: string; changePositive?: boolean } => {
    const pts = history.points;
    if (pts.length < 2) return {};
    const last = pts[pts.length - 1];
    const target = new Date(last.date);
    target.setDate(target.getDate() - 7);
    let past = pts[0][field];
    for (const p of pts) {
      if (new Date(p.date).getTime() <= target.getTime()) past = p[field];
      else break;
    }
    if (!past) return {};
    const pct = ((last[field] - past) / Math.abs(past)) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < 0.05) return {};
    return { change: `${Math.abs(pct).toFixed(1)}% this week`, changePositive: pct >= 0 };
  };

  // Cash/Savings = the Clear (smart) wallet PLUS every linked wallet, aggregated. (This is a holdings
  // view; movable Cash in the Transfer/Send flows stays the smart wallet only — linked funds need their
  // own wallet to sign.)
  const linkedTotals = useMemo(() => {
    let usdc = 0;
    let clrusd = 0;
    for (const w of externalWallets) {
      const b = linkedBalances[w.address.toLowerCase()];
      if (b) {
        usdc += b.usdc;
        clrusd += b.clrusd;
      }
    }
    return { usdc, clrusd };
  }, [externalWallets, linkedBalances]);
  const cash = bal.cash + linkedTotals.usdc;
  const savings = bal.savings + linkedTotals.clrusd;

  // This month's outflows grouped by day-of-month — total per day (heatmap intensity) plus a
  // by-category breakdown per day (for the hover/press tooltip).
  const { spendByDay, spendDetailByDay } = useMemo(() => {
    const now = new Date();
    const totals: Record<number, number> = {};
    const byCat: Record<number, Record<string, number>> = {};
    for (const it of items) {
      if (it.amount >= 0) continue;
      const d = new Date(it.ts);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) continue;
      const day = d.getDate();
      const amt = Math.abs(it.amount);
      totals[day] = (totals[day] || 0) + amt;
      (byCat[day] ||= {})[it.category] = (byCat[day][it.category] || 0) + amt;
    }
    const detail: Record<number, { category: string; amount: number }[]> = {};
    for (const [day, cats] of Object.entries(byCat)) {
      detail[Number(day)] = Object.entries(cats)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount);
    }
    return { spendByDay: totals, spendDetailByDay: detail };
  }, [items]);
  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Good morning, {firstName}</h1>
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
        loading={bal.loading}
        stats={[
          { label: 'Total balance', value: cash + savings + ext.totalBalance, icon: Wallet, ...weekChange('totalUsd') },
          { label: 'Cash · USDC', value: cash, icon: Banknote, ...weekChange('onchainUsd') },
          { label: 'Savings · CLRUSD', value: savings, icon: PiggyBank, ...weekChange('onchainUsd') },
          { label: 'External · Plaid', value: ext.totalBalance, icon: Landmark, ...weekChange('bankUsd') },
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
        <UpcomingCalendar items={upcoming} />
        <SpendHeatmap spendingByDay={spendByDay} detailByDay={spendDetailByDay} />
        <ClearDeedCard />
      </div>

      <RecentActivity limit={5} />
    </div>
  );
}
