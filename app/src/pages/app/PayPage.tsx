import { Home, FileText, ArrowUpRight, ArrowDownLeft, Zap, Wifi, CreditCard, Smartphone, Calendar, CircleCheck, TrendingUp, Flame, type LucideIcon } from 'lucide-react';
import StatCard from '@/components/app-ui/StatCard';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import RentEquityChart from '@/components/app-ui/charts/RentEquityChart';
import BillTimeline, { type TimelineBill } from '@/components/app-ui/BillTimeline';
import CardVisual from '@/components/app-ui/CardVisual';
import { cn } from '@/lib/utils';

const RENT_EQUITY = [
  { label: 'Jan', equity: 280 },
  { label: 'Feb', equity: 310 },
  { label: 'Mar', equity: 330 },
  { label: 'Apr', equity: 360 },
  { label: 'May', equity: 390 },
  { label: 'Jun', equity: 490 },
];

const BILLS: TimelineBill[] = [
  { id: 'electric', name: 'Electric — ConEd', dateLabel: 'Jun 28', amount: 124, icon: Zap },
  { id: 'internet', name: 'Internet — Verizon', dateLabel: 'Jun 30', amount: 80, icon: Wifi },
  { id: 'rent', name: 'Rent — Maple Apartments', dateLabel: 'Jul 1', amount: 1850, icon: Home },
  { id: 'card', name: 'Card — Amex', dateLabel: 'Jul 3', amount: 320, icon: CreditCard },
  { id: 'phone', name: 'Phone — Verizon', dateLabel: 'Jul 5', amount: 65, icon: Smartphone },
];

function ActionTile({ icon: Icon, label, sub, primary }: { icon: LucideIcon; label: string; sub: string; primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-[112px] flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-transform active:scale-[0.99]',
        primary ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-secondary/40 text-foreground hover:bg-secondary',
      )}
    >
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', primary ? 'bg-white/20' : 'bg-background text-foreground')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-auto">
        <span className="block text-sm font-medium">{label}</span>
        <span className={cn('mt-0.5 block text-xs', primary ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{sub}</span>
      </span>
    </button>
  );
}

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Due this month" value="$2,439.00" icon={Calendar} />
        <StatCard label="Paid · 30 days" value="$4,512.00" change="8% vs last mo" icon={CircleCheck} />
        <StatCard label="Equity from rent" value="$2,160" change="+$490 this mo" icon={TrendingUp} />
        <StatCard label="On-time streak" value="6 months" icon={Flame} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">Make a payment</h3>
          <div className="grid grid-cols-2 gap-3">
            <ActionTile icon={Home} label="Pay rent" sub="Schedule or pay now" primary />
            <ActionTile icon={FileText} label="Pay a bill" sub="Utilities, cards & more" />
            <ActionTile icon={ArrowUpRight} label="Send" sub="To anyone" />
            <ActionTile icon={ArrowDownLeft} label="Request" sub="Get paid" />
          </div>
        </div>
        <CardVisual />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          label="Equity earned from rent"
          value="$2,160"
          delta={{ text: '+$490 this month', positive: true }}
          insight="6 on-time payments → equity"
        >
          <RentEquityChart data={RENT_EQUITY} />
        </ChartCard>
        <BillTimeline bills={BILLS} />
      </div>
    </div>
  );
}
