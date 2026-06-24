import { Bell, Plus, ArrowLeftRight, Banknote, PiggyBank, Landmark, Home } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import BalanceHero from '@/components/app-ui/BalanceHero';
import SectionCard from '@/components/app-ui/SectionCard';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import UpcomingCalendar, { type UpcomingItem } from '@/components/app-ui/UpcomingCalendar';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import BalanceTrendChart from '@/components/app-ui/charts/BalanceTrendChart';

const BALANCE_TREND = [
  { label: 'Jan', value: 34200 },
  { label: 'Feb', value: 36100 },
  { label: 'Mar', value: 35400 },
  { label: 'Apr', value: 38250 },
  { label: 'May', value: 39600 },
  { label: 'Jun', value: 41017 },
];

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
 * Equity Credits → Clear Deed progress. Credits accrue 1:1 on the member's CLRUSD
 * savings (up to $1,500/mo) but are NON-redeemable — applied only at deed conversion.
 */
function ClearDeedCard() {
  const credits = 6240;
  const milestone = 25000;
  const pct = Math.min(100, Math.round((credits / milestone) * 100));
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
          <span>${milestone.toLocaleString()}</span>
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
 * Accounts — the app home. Spendable total = Cash (USDC) + Savings (CLRUSD) + External (Plaid);
 * Equity Credits are shown separately as Clear Deed progress. Scaffold: placeholder figures.
 */
export default function AccountsPage() {
  return (
    <div className="animate-fade-in">
      <ScreenHeader
        title="Accounts"
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

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="space-y-6 lg:col-span-7">
          <div className="lg:rounded-3xl lg:border lg:border-border lg:bg-card lg:p-6">
            <BalanceHero label="Total balance" amount="$41,016.67" change="$421.03 this week" />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> Add money
              </button>
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-transform active:scale-[0.99]"
              >
                <ArrowLeftRight className="h-4 w-4" /> Move
              </button>
            </div>
          </div>

          <ChartCard
            label="Balance trend"
            delta={{ text: '4.2% over 6 months', positive: true }}
            insight="+$6,817 since January"
          >
            <BalanceTrendChart data={BALANCE_TREND} />
          </ChartCard>

          <div>
            <h2 className="mb-3 text-xs font-medium text-muted-foreground">Your accounts</h2>
            <div className="space-y-2.5">
              <SectionCard icon={Banknote} tint="cash" title="Cash" subtitle="USDC · available now" amount="$12,480.20" />
              <SectionCard icon={PiggyBank} tint="savings" title="Savings" subtitle="CLRUSD · redeemable" amount="$24,092.67" />
              <SectionCard icon={Landmark} tint="external" title="External accounts" subtitle="Chase ··6152 · Amex ··2791" amount="$4,443.80" chevron />
            </div>
            <button
              type="button"
              className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground lg:w-auto"
            >
              <Plus className="h-3.5 w-3.5" /> Link a bank with Plaid
            </button>
          </div>

          <SpendHeatmap spendingByDay={SPEND_BY_DAY} />
        </div>

        <div className="mt-6 space-y-6 lg:col-span-5 lg:mt-0">
          <ClearDeedCard />
          <UpcomingCalendar items={UPCOMING} />
        </div>
      </div>
    </div>
  );
}
