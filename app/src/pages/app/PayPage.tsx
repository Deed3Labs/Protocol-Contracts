import { Bell, Home, FileText, ArrowUpRight, ArrowDownLeft, Zap, Wifi, type LucideIcon } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import SectionCard from '@/components/app-ui/SectionCard';
import { cn } from '@/lib/utils';

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
          : 'border-black/[0.06] bg-card text-foreground dark:border-white/[0.06]',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-2xl',
          primary ? 'bg-white/20' : 'bg-accent text-accent-foreground',
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
      className="flex items-center gap-3 rounded-3xl border border-black/[0.06] bg-card p-4 text-left text-foreground transition-transform active:scale-[0.99] dark:border-white/[0.06]"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[15px] font-medium">{title}</span>
    </button>
  );
}

/**
 * Pay — built around Clear Pay's rent/bill-pay core, with Send/Request secondary.
 * Scaffold: placeholder bills, live Plaid recurring data TODO.
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
        <div className="lg:col-span-7">
          <div className="mb-6">
            <h2 className="font-display text-4xl leading-[0.95] tracking-tight text-foreground lg:text-5xl">
              Pay rent &amp; bills,
              <br />
              send to anyone.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Clear Pay handles your recurring rent and bills — plus one-off transfers when you need them.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <BigTile icon={Home} title="Pay rent" subtitle="Schedule or pay now" primary />
            <BigTile icon={FileText} title="Pay a bill" subtitle="Utilities, cards & more" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <SmallTile icon={ArrowUpRight} title="Send" />
            <SmallTile icon={ArrowDownLeft} title="Request" />
          </div>
        </div>

        <div className="mt-7 lg:col-span-5 lg:mt-0">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">Upcoming</h3>
          <div className="space-y-2.5">
            <SectionCard icon={Home} tint="primary" title="Rent — Maple Apartments" subtitle="Due Jul 1" amount="$1,850.00" />
            <SectionCard icon={Zap} tint="neutral" title="Electric — ConEd" subtitle="Due Jun 28" amount="$124.30" />
            <SectionCard icon={Wifi} tint="neutral" title="Internet — Verizon" subtitle="Due Jun 30" amount="$79.99" />
          </div>
        </div>
      </div>
    </div>
  );
}
