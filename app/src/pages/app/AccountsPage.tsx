import { Bell, Plus, ArrowLeftRight, Banknote, PiggyBank, Landmark, Home } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import BalanceHero from '@/components/app-ui/BalanceHero';
import SectionCard from '@/components/app-ui/SectionCard';

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
          <span>{pct}% to milestone</span>
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
        <div className="lg:col-span-7 xl:col-span-8">
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

          <h2 className="mb-3 mt-7 text-xs font-medium text-muted-foreground">Your accounts</h2>
          <div className="space-y-2.5">
            <SectionCard
              icon={Banknote}
              tint="cash"
              title="Cash"
              subtitle="USDC · available now"
              amount="$12,480.20"
            />
            <SectionCard
              icon={PiggyBank}
              tint="savings"
              title="Savings"
              subtitle="CLRUSD · redeemable"
              amount="$24,092.67"
            />
            <SectionCard
              icon={Landmark}
              tint="external"
              title="External accounts"
              subtitle="Chase ··6152 · Amex ··2791"
              amount="$4,443.80"
              chevron
            />
          </div>

          <button
            type="button"
            className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground lg:w-auto"
          >
            <Plus className="h-3.5 w-3.5" /> Link a bank with Plaid
          </button>
        </div>

        <div className="mt-7 lg:col-span-5 lg:mt-0 xl:col-span-4">
          <ClearDeedCard />
        </div>
      </div>
    </div>
  );
}
