import { Bell, Home, FileText, ArrowUpRight, ArrowDownLeft, Zap, Wifi, CreditCard, Smartphone, type LucideIcon } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import ChartCard from '@/components/app-ui/charts/ChartCard';
import RentEquityChart from '@/components/app-ui/charts/RentEquityChart';
import BillTimeline, { type TimelineBill } from '@/components/app-ui/BillTimeline';
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

function BigTile({
  icon: Icon,
  title,
  subtitle,
  primary,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-[124px] flex-col items-start gap-3 rounded-3xl border p-4 text-left transition-transform active:scale-[0.99]',
        primary
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-2xl',
          primary ? 'bg-white/20' : 'bg-secondary text-secondary-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-auto">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className={cn('mt-0.5 block text-xs', primary ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function SmallTile({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-3xl border border-border bg-card p-4 text-left text-foreground transition-transform active:scale-[0.99]"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[15px] font-medium">{title}</span>
    </button>
  );
}

/**
 * Pay — Clear Pay's rent/bill-pay core, with Send/Request and data viz: a
 * rent-to-equity chart (on-time rent earns equity credits) and a bill timeline.
 */
export default function PayPage() {
  return (
    <div className="animate-fade-in">
      <ScreenHeader
        title="Pay"
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
          <div>
            <h2 className="font-display text-4xl leading-[0.95] tracking-tight text-foreground lg:text-5xl">
              Pay rent &amp; bills,
              <br />
              send to anyone.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Clear Pay handles your recurring rent and bills — and every on-time rent payment earns
              equity credits toward your Clear Deed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <BigTile icon={Home} title="Pay rent" subtitle="Schedule or pay now" primary />
            <BigTile icon={FileText} title="Pay a bill" subtitle="Utilities, cards & more" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SmallTile icon={ArrowUpRight} title="Send" />
            <SmallTile icon={ArrowDownLeft} title="Request" />
          </div>

          <ChartCard
            label="Equity earned from rent"
            value="$2,160"
            delta={{ text: '+$490 this month', positive: true }}
            insight="6 on-time payments → equity"
          >
            <RentEquityChart data={RENT_EQUITY} />
          </ChartCard>
        </div>

        <div className="mt-6 lg:col-span-5 lg:mt-0">
          <BillTimeline bills={BILLS} />
        </div>
      </div>
    </div>
  );
}
