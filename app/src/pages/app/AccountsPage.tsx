import { useMemo } from 'react';
import { Wallet, Banknote, PiggyBank, Landmark } from 'lucide-react';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useLinkedWalletBalances } from '@/hooks/useLinkedWalletBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useClearPortfolioHistory } from '@/hooks/useClearPortfolioHistory';
import { useUpcoming } from '@/hooks/useUpcoming';
import QuickActions from '@/components/app-ui/QuickActions';
import RecentActivity from '@/components/app-ui/RecentActivity';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar from '@/components/app-ui/UpcomingCalendar';
import BalanceAnalyticsChart from '@/components/app-ui/charts/BalanceAnalyticsChart';
import MetricRow from '@/components/app-ui/accounts/MetricRow';
import PathToOwnership from '@/components/app-ui/accounts/PathToOwnership';
import EquitySources from '@/components/app-ui/accounts/EquitySources';
import VerifyPopdown from '@/components/app-ui/accounts/VerifyPopdown';

/**
 * Accounts — the dashboard.
 *
 * Flat, divider-based layout: no card wrappers around content groups. Regions are separated by
 * 1px hairlines and the 8/16/24 whitespace system, and the same hairline recurs inside the data
 * displays (calendar, heatmap, band) so the grid language holds at every scale.
 *
 * Path to Ownership is the hero — it's the reason a member opens this over Monarch or Origin —
 * so it spans the full width and the balance chart is demoted beside Equity Sources.
 *
 * Note: the shared StatBar/RecentActivity are deliberately NOT used or modified here. They're
 * rendered by four other pages, and rewriting them is what forced the previous flat-design
 * attempt (49d513e) to be reverted. Accounts uses its own MetricRow instead.
 */
export default function AccountsPage() {
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

  // Real trailing-7-day change for a metric. Prefers the backend balance-history series (exact, and
  // it includes external); falls back to net 7-day transaction flow when history isn't backfilled yet
  // — for stablecoins there's no price movement, so net flow == the balance change. Cash/Savings share
  // the on-chain figure (we snapshot the combined on-chain total, not each token).
  const fmtPct = (pct: number) => ({ change: `${Math.abs(pct).toFixed(1)}% this week`, changePositive: pct >= 0 });
  const weekChange = (
    field: 'totalUsd' | 'onchainUsd' | 'bankUsd',
    current: number,
  ): { change?: string; changePositive?: boolean } => {
    const pts = history.points;
    if (pts.length >= 2) {
      const last = pts[pts.length - 1];
      const target = new Date(last.date);
      target.setDate(target.getDate() - 7);
      let past = pts[0][field];
      for (const p of pts) {
        if (new Date(p.date).getTime() <= target.getTime()) past = p[field];
        else break;
      }
      if (Math.abs(past) >= 0.01) {
        const pct = ((last[field] - past) / Math.abs(past)) * 100;
        if (Number.isFinite(pct)) return fmtPct(pct);
      }
    }
    // Fallback: net signed flow over the last 7 days, scoped to the metric's accounts.
    const cutoff = Date.now() - 7 * 86_400_000;
    let net = 0;
    for (const it of items) {
      if (it.ts < cutoff || it.internal) continue; // internal transfers aren't income/spending
      const isBank = it.source === 'bank';
      const include = field === 'totalUsd' ? true : field === 'bankUsd' ? isBank : !isBank;
      if (include) net += it.amount;
    }
    const past = current - net;
    if (Math.abs(past) < 0.01) return {};
    const pct = (net / Math.abs(past)) * 100;
    return Number.isFinite(pct) ? fmtPct(pct) : {};
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
      if (it.amount >= 0 || it.internal) continue; // exclude internal transfers from spend
      const d = new Date(it.ts);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) continue;
      const day = d.getDate();
      const amt = Math.abs(it.amount);
      totals[day] = (totals[day] || 0) + amt;
      const cat = it.spendCategory || 'Misc';
      (byCat[day] ||= {})[cat] = (byCat[day][cat] || 0) + amt;
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
    // Bleeds out of the shell's horizontal padding so every hairline runs edge to edge; each
    // region re-applies the padding to its own content.
    <div className="animate-fade-in -mx-5 -mt-6 lg:-mx-8">
      <VerifyPopdown />

      <MetricRow
        loading={bal.loading}
        metrics={[
          { label: 'Total balance', value: cash + savings + ext.totalBalance, icon: Wallet, ...weekChange('totalUsd', cash + savings + ext.totalBalance) },
          { label: 'Cash · USDC', value: cash, icon: Banknote, ...weekChange('onchainUsd', cash + savings) },
          { label: 'Savings · CLRUSD', value: savings, icon: PiggyBank, ...weekChange('onchainUsd', cash + savings) },
          { label: 'External · Plaid', value: ext.totalBalance, icon: Landmark, ...weekChange('bankUsd', ext.totalBalance) },
        ]}
      />

      {/* Row 2 — matches the Figma split: the ownership band left, the balance chart right. */}
      <div className="grid border-b border-border lg:grid-cols-3">
        <PathToOwnership className="px-5 lg:col-span-2 lg:border-r lg:border-border lg:px-8" />
        <BalanceAnalyticsChart className="border-t border-border px-5 lg:border-t-0 lg:px-8" />
      </div>

      {/* Row 3 — the trackers, three columns as in the Figma. Equity Sources fills the slot the
          Figma left empty. */}
      <div className="grid border-b border-border lg:grid-cols-3">
        <UpcomingCalendar flat items={upcoming} className="px-5 lg:border-r lg:border-border lg:px-8" />
        <SpendHeatmap
          flat
          spendingByDay={spendByDay}
          detailByDay={spendDetailByDay}
          className="border-t border-border px-5 lg:border-t-0 lg:border-r lg:border-border lg:px-8"
        />
        <EquitySources className="border-t border-border px-5 lg:border-t-0 lg:px-8" />
      </div>

      {/* Money movement stays reachable from home — actions are controls, not content cards. */}
      <div className="border-b border-border px-5 py-6 lg:px-8">
        <QuickActions />
      </div>

      <div className="px-5 pt-6 lg:px-8">
        <RecentActivity limit={5} />
      </div>
    </div>
  );
}
