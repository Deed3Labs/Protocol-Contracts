import { useEffect, useMemo } from 'react';
import { Home, SendHorizontal, ArrowDownLeft, Repeat, Calendar, AlertCircle, TrendingUp, Flame } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import MonthProgress from '@/components/app-ui/pay/MonthProgress';
import BillWorkspace from '@/components/app-ui/pay/BillWorkspace';
import { billTiming } from '@/lib/billStatus';
import { usePay, rewardMultiplier } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useMoneyActions } from '@/context/MoneyActionsContext';

/**
 * Pay — a workspace for the member's bills.
 *
 * Metrics (animated, the same treatment as Accounts) → how the month is going → the bills themselves.
 * Paying from the Clear balance needs verification; adding and tracking bills does not.
 */
export default function PayPage() {
  const { bills, summary, openPay, reconcile, loading } = usePay();
  const { accelerated } = useMemberProfile();
  const { openSend, openRequest, openAutoSave } = useMoneyActions();

  // Detect on-time recurring payments from Plaid when the Pay page opens (Plaid call kept off other pages).
  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  const overdue = useMemo(() => {
    let amount = 0;
    let count = 0;
    for (const b of bills) {
      if (billTiming(b.dueDay, b.lastPaidAt).status === 'overdue') {
        amount += b.amount || 0;
        count += 1;
      }
    }
    return { amount, count };
  }, [bills]);

  const streak = summary?.streak ?? 0;
  const multiplier = rewardMultiplier(streak, accelerated);

  return (
    <div className="animate-fade-in space-y-4">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Pay</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {bills.length === 0
            ? 'Track your rent and bills — and earn equity for paying on time.'
            : `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} tracked`}
        </p>
      </header>

      <StatBar
        loading={loading}
        stats={[
          { label: 'Due this month', value: summary?.dueThisMonth ?? 0, icon: Calendar },
          {
            label: 'Overdue',
            value: overdue.amount,
            change: overdue.count > 0 ? `${overdue.count} ${overdue.count === 1 ? 'bill' : 'bills'}` : undefined,
            changePositive: false,
            icon: AlertCircle,
          },
          {
            label: 'Equity credits',
            value: summary?.totalEquity ?? 0,
            change: summary?.equityThisMonth ? `+${summary.equityThisMonth.toLocaleString()} this month` : undefined,
            icon: TrendingUp,
          },
          {
            label: 'On-time streak',
            value: `${streak} ${streak === 1 ? 'month' : 'months'}`,
            change: `${multiplier}× earning`,
            icon: Flame,
          },
        ]}
      />

      <MonthProgress />

      <BillWorkspace />

      {/* Slim rail: reachable, never dominant. */}
      <div className="flex flex-wrap gap-2">
        {[
          { icon: Home, label: 'Pay rent', onClick: () => openPay('rent') },
          { icon: SendHorizontal, label: 'Send', onClick: openSend },
          { icon: ArrowDownLeft, label: 'Request', onClick: openRequest },
          { icon: Repeat, label: 'Auto-save', onClick: openAutoSave },
        ].map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
