import { useEffect, useMemo } from 'react';
import { Home, SendHorizontal, ArrowDownLeft, Repeat, Calendar, AlertCircle, TrendingUp, Flame } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import ActionTile from '@/components/app-ui/ActionTile';
import MonthProgress from '@/components/app-ui/pay/MonthProgress';
import BillManager from '@/components/app-ui/pay/BillManager';
import BillActivity from '@/components/app-ui/pay/BillActivity';
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
        <p className="mt-0.5 text-sm text-muted-foreground">Manage your bills — rewarded for every on-time payment.</p>
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

      {/* Money moves + the month's shape, one section — the actions are the point of the page, so they
          get real tiles beside the bar rather than a footnote rail. Mirrors Borrow's credit-line row. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <MonthProgress className="lg:col-span-2" />
        <div className="grid grid-cols-2 gap-3">
          <ActionTile icon={Home} label="Pay rent" hint="Schedule or now" primary onClick={() => openPay('rent')} />
          <ActionTile icon={SendHorizontal} label="Send" hint="To anyone" onClick={openSend} />
          <ActionTile icon={ArrowDownLeft} label="Request" hint="Get paid" onClick={openRequest} />
          <ActionTile icon={Repeat} label="Auto-save" hint="Build equity" onClick={openAutoSave} />
        </div>
      </div>

      <BillManager />

      <BillActivity />
    </div>
  );
}
