import { Home, FileText, SendHorizontal, ArrowDownLeft, Calendar, CircleCheck, TrendingUp, Flame } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import ActionTile from '@/components/app-ui/ActionTile';
import RentEquityAnalyticsChart from '@/components/app-ui/charts/RentEquityAnalyticsChart';
import BillTimeline, { type TimelineBill } from '@/components/app-ui/BillTimeline';
import CardVisual from '@/components/app-ui/CardVisual';
import { usePay } from '@/context/PayContext';
import { useMoneyActions } from '@/context/MoneyActionsContext';

/** Pay — Clear Pay's rent/bill core, send/request, card, and rent-to-equity viz. */
export default function PayPage() {
  const { bills, openPay } = usePay();
  const { openSend, openRequest } = useMoneyActions();
  const timelineBills: TimelineBill[] = bills.map((b) => ({ id: b.id, name: b.name, dateLabel: b.dueLabel, amount: b.amount, icon: b.icon }));
  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Pay</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pay rent &amp; bills — and build equity with every on-time payment.
        </p>
      </header>

      <StatBar
        stats={[
          { label: 'Due this month', value: '$2,439.00', icon: Calendar },
          { label: 'Paid · 30 days', value: '$4,512.00', change: '8% vs last mo', icon: CircleCheck },
          { label: 'Equity from rent', value: '$2,160', change: '+$490 this mo', icon: TrendingUp },
          { label: 'On-time streak', value: '6 months', icon: Flame },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">Make a payment</h3>
          <div className="grid grid-cols-2 gap-3">
            <ActionTile icon={Home} label="Pay rent" hint="Schedule or pay now" primary onClick={() => openPay('rent')} />
            <ActionTile icon={FileText} label="Pay a bill" hint="Utilities, cards & more" onClick={() => openPay()} />
            <ActionTile icon={SendHorizontal} label="Send" hint="To anyone" onClick={openSend} />
            <ActionTile icon={ArrowDownLeft} label="Request" hint="Get paid" onClick={openRequest} />
          </div>
        </div>
        <CardVisual />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <RentEquityAnalyticsChart className="lg:col-span-2" />
        <BillTimeline bills={timelineBills} onPay={openPay} />
      </div>
    </div>
  );
}
