import { Bell, Plus, ArrowLeftRight, Banknote, PiggyBank, Landmark } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import BalanceHero from '@/components/app-ui/BalanceHero';
import SectionCard from '@/components/app-ui/SectionCard';

/**
 * Accounts — the app home. Hero total, then Cash (USDC), Savings (CLRUSD),
 * and External accounts (Plaid). Scaffold: placeholder figures, live data TODO.
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
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-medium text-foreground transition-transform active:scale-[0.99] dark:border-white/10"
        >
          <ArrowLeftRight className="h-4 w-4" /> Move
        </button>
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
          subtitle={
            <span className="inline-flex items-center gap-1.5">
              CLRUSD
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                4.50% APY
              </span>
            </span>
          }
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
        className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Link a bank with Plaid
      </button>
    </div>
  );
}
