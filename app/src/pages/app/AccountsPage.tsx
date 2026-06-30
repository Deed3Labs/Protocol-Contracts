import { useMemo } from 'react';
import { Wallet, Banknote, PiggyBank, Landmark, ShieldCheck } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { useKyc } from '@/context/KycContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useLinkedWalletBalances } from '@/hooks/useLinkedWalletBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
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
 * and the upcoming/spend calendars. Scaffold: placeholder figures.
 */
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsPage() {
  const { verified, openKyc } = useKyc();
  const bal = useClearBalances();
  const ext = useExternalAccounts();
  const { externalWallets } = useLinkedWallets();
  const { balances: linkedBalances } = useLinkedWalletBalances(
    externalWallets.map((w) => w.address),
    externalWallets.length > 0,
  );
  const { flows } = useClearTransactions();
  const upcoming = useUpcoming();
  const { firstName } = useMemberProfile();
  const dash = (v: number) => (bal.loading ? '—' : fmtUsd(v));

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

  // This month's outflows grouped by day-of-month (for the spend heatmap).
  const spendByDay = useMemo(() => {
    const now = new Date();
    const out: Record<number, number> = {};
    for (const f of flows) {
      if (f.usd >= 0) continue;
      const d = new Date(f.ts);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) continue;
      out[d.getDate()] = (out[d.getDate()] || 0) + Math.abs(f.usd);
    }
    return out;
  }, [flows]);
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
        stats={[
          { label: 'Total balance', value: dash(cash + savings + ext.totalBalance), change: '2.1% this week', icon: Wallet },
          { label: 'Cash · USDC', value: dash(cash), change: '0.4%', icon: Banknote },
          { label: 'Savings · CLRUSD', value: dash(savings), change: '1.8%', icon: PiggyBank },
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
        <UpcomingCalendar items={upcoming} />
        <SpendHeatmap spendingByDay={spendByDay} />
        <ClearDeedCard />
      </div>

      <RecentActivity limit={5} />
    </div>
  );
}
