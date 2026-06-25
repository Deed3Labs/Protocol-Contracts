import { Home, FileText, SendHorizontal, ArrowDownLeft, Zap, Wifi, CreditCard, Smartphone, Calendar, CircleCheck, TrendingUp, Flame } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import ActionTile from '@/components/app-ui/ActionTile';
import RentEquityAnalyticsChart from '@/components/app-ui/charts/RentEquityAnalyticsChart';
import BillTimeline, { type TimelineBill } from '@/components/app-ui/BillTimeline';
import CardVisual from '@/components/app-ui/CardVisual';

const BILLS: TimelineBill[] = [
  { id: 'electric', name: 'Electric — ConEd', dateLabel: 'Jun 28', amount: 124, icon: Zap },
  { id: 'internet', name: 'Internet — Verizon', dateLabel: 'Jun 30', amount: 80, icon: Wifi },
  { id: 'rent', name: 'Rent — Maple Apartments', dateLabel: 'Jul 1', amount: 1850, icon: Home },
  { id: 'card', name: 'Card — Amex', dateLabel: 'Jul 3', amount: 320, icon: CreditCard },
  { id: 'phone', name: 'Phone — Verizon', dateLabel: 'Jul 5', amount: 65, icon: Smartphone },
];

/** Pay — Clear Pay's rent/bill core, send/request, card, and rent-to-equity viz. */
export default function PayPage() {
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
            <ActionTile icon={Home} label="Pay rent" hint="Schedule or pay now" primary />
            <ActionTile icon={FileText} label="Pay a bill" hint="Utilities, cards & more" />
            <ActionTile icon={SendHorizontal} label="Send" hint="To anyone" />
            <ActionTile icon={ArrowDownLeft} label="Request" hint="Get paid" />
          </div>
        </div>
        <CardVisual />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <RentEquityAnalyticsChart className="lg:col-span-2" />
        <BillTimeline bills={BILLS} />
      </div>
    </div>
  );
}
