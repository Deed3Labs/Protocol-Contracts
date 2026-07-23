import { useState } from 'react';
import {
  TrendingUp, Calendar, Bell, DollarSign, Plus, Home, Zap, CreditCard, Music, Clapperboard,
  Smartphone, Dumbbell, ShieldCheck, Receipt, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UpcomingItem {
  id: string;
  name: string;
  amount: number;
  day: number;
  direction: 'in' | 'out';
}

const weekDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const headerIcons: LucideIcon[] = [TrendingUp, Calendar, Bell];
const formatAmount = (a: number) => (a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`);
const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Each upcoming item gets a colored icon by kind. Classes are written out in full so Tailwind keeps them.
type UpcomingKind = 'income' | 'rent' | 'utility' | 'phone' | 'video' | 'music' | 'card' | 'insurance' | 'fitness' | 'bill';
const KIND_STYLE: Record<UpcomingKind, { icon: LucideIcon; bg: string; fg: string; label: string }> = {
  income:    { icon: DollarSign,   bg: 'bg-emerald-500/15', fg: 'text-emerald-500', label: 'Income' },
  rent:      { icon: Home,         bg: 'bg-amber-500/15',   fg: 'text-amber-500',   label: 'Rent' },
  utility:   { icon: Zap,          bg: 'bg-sky-500/15',     fg: 'text-sky-500',     label: 'Utilities' },
  phone:     { icon: Smartphone,   bg: 'bg-cyan-500/15',    fg: 'text-cyan-500',    label: 'Phone' },
  video:     { icon: Clapperboard, bg: 'bg-violet-500/15',  fg: 'text-violet-500',  label: 'Streaming' },
  music:     { icon: Music,        bg: 'bg-pink-500/15',    fg: 'text-pink-500',    label: 'Music' },
  card:      { icon: CreditCard,   bg: 'bg-rose-500/15',    fg: 'text-rose-500',    label: 'Card / loan' },
  insurance: { icon: ShieldCheck,  bg: 'bg-teal-500/15',    fg: 'text-teal-500',    label: 'Insurance' },
  fitness:   { icon: Dumbbell,     bg: 'bg-orange-500/15',  fg: 'text-orange-500',  label: 'Fitness' },
  bill:      { icon: Receipt,      bg: 'bg-secondary',      fg: 'text-muted-foreground', label: 'Bill' },
};

/** Classify an upcoming item into a kind (for its icon/color) from its direction + merchant name. */
function classifyUpcoming(item: UpcomingItem): UpcomingKind {
  if (item.direction === 'in') return 'income';
  const n = item.name.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  if (has('netflix', 'hulu', 'disney', 'hbo', ' max', 'youtube', 'prime video', 'paramount', 'peacock', 'apple tv', 'sling', 'fubo')) return 'video';
  if (has('spotify', 'apple music', 'tidal', 'pandora', 'soundcloud', 'amazon music', 'deezer', 'audible')) return 'music';
  if (has('rent', 'apartment', 'landlord', 'mortgage', 'lease', 'realty', 'property')) return 'rent';
  if (has('verizon', 'at&t', 't-mobile', 'mint mobile', 'sprint', 'cricket', 'boost mobile')) return 'phone';
  if (has('electric', 'water', 'energy', 'utility', 'pg&e', 'con ed', 'duke', 'sewer', 'waste', 'internet', 'comcast', 'xfinity', 'spectrum', 'fiber', 'broadband')) return 'utility';
  if (has('insurance', 'geico', 'allstate', 'state farm', 'progressive', 'nationwide', 'liberty mutual')) return 'insurance';
  if (has('credit card', 'card payment', 'visa', 'mastercard', 'amex', 'american express', 'loan', 'financing', 'affirm', 'klarna', 'afterpay', 'synchrony', 'capital one', 'discover')) return 'card';
  if (has('gym', 'fitness', 'peloton', 'crunch', 'equinox', 'anytime')) return 'fitness';
  return 'bill';
}

/**
 * Upcoming recurring bills/income calendar — the old portfolio UpcomingTransactions
 * layout (day cells with dot clusters + day totals), reskinned to neutral. A solid dot
 * is a bill, a hollow $ dot is income, "+" marks overflow. Hover or tap a day to see
 * the transactions and amounts scheduled for it.
 */
export default function UpcomingCalendar({
  items,
  className,
}: {
  items: UpcomingItem[];
  className?: string;
}) {
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const monthName = today.toLocaleDateString('en-US', { month: 'long' });

  const upcoming = items.filter((i) => i.day >= currentDay);
  const totalOut = upcoming.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);

  const allDays: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Anchor the day tooltip to the cell edge for the outer columns so it never overflows the card
  // (a centered tooltip on the leftmost column slid under the fixed sidebar).
  const tipPos = (day: number) => {
    const col = (startDow + day - 1) % 7;
    if (col <= 1) return 'left-0';
    if (col >= 5) return 'right-0';
    return 'left-1/2 -translate-x-1/2';
  };

  return (
    <div className={cn('flex flex-col rounded-xl border border-border p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Upcoming transactions</span>
        <div className="flex items-center gap-1">
          {headerIcons.map((Icon, i) => (
            <button key={i} type="button" className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {allDays.map((day, idx) => {
          if (day === null) return <div key={`p${idx}`} className="min-h-14" aria-hidden />;
          const dayItems = items.filter((i) => i.day === day);
          const isToday = day === currentDay;
          const isPast = day < currentDay;
          const dayOut = dayItems.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);
          const overflow = dayItems.length > 3;
          const shown = overflow ? dayItems.slice(0, 2) : dayItems.slice(0, 3);
          const hasItems = dayItems.length > 0;
          const isActive = activeDay === day && hasItems;
          return (
            <div
              key={day}
              role={hasItems ? 'button' : undefined}
              tabIndex={hasItems ? 0 : undefined}
              onMouseEnter={() => hasItems && setActiveDay(day)}
              onMouseLeave={() => setActiveDay((d) => (d === day ? null : d))}
              onFocus={() => hasItems && setActiveDay(day)}
              onBlur={() => setActiveDay((d) => (d === day ? null : d))}
              onClick={() => hasItems && setActiveDay((d) => (d === day ? null : day))}
              className={cn(
                'relative flex min-h-14 min-w-0 flex-col items-center justify-between rounded-[6px] border p-1 outline-none',
                isPast ? 'border-border/50 opacity-60' : 'border-border',
                isToday && 'bg-secondary/40 ring-1 ring-foreground/40',
                hasItems && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-foreground/60',
              )}
            >
              <span className={cn('text-[10px] font-medium', isToday ? 'flex h-4 w-4 items-center justify-center rounded-lg bg-foreground text-[9px] text-background' : 'text-foreground')}>
                {day}
              </span>
              {hasItems ? (
                <div className="flex items-center -space-x-1">
                  {shown.map((it) => {
                    const st = KIND_STYLE[classifyUpcoming(it)];
                    const Icon = st.icon;
                    return (
                      <span key={it.id} className={cn('flex h-4 w-4 items-center justify-center rounded-lg border border-foreground/20', st.bg)}>
                        <Icon className={cn('h-2.5 w-2.5', st.fg)} />
                      </span>
                    );
                  })}
                  {overflow && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-lg border border-foreground/20 bg-secondary text-secondary-foreground">
                      <Plus className="h-2 w-2" />
                    </span>
                  )}
                </div>
              ) : (
                <span className="h-4" />
              )}
              <span className="w-full truncate text-center text-[9px] font-medium text-muted-foreground">
                {dayOut > 0 ? formatAmount(dayOut) : ' '}
              </span>

              {isActive && (
                <div
                  className={cn('absolute bottom-full z-50 mb-1.5 w-48 rounded-lg border border-border bg-card p-2.5 text-left shadow-xl', tipPos(day))}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{monthName} {day}</div>
                  <div className="space-y-1.5">
                    {dayItems.map((it) => {
                      const st = KIND_STYLE[classifyUpcoming(it)];
                      const Icon = st.icon;
                      return (
                        <div key={it.id} className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-lg border border-foreground/20', st.bg)}>
                              <Icon className={cn('h-2.5 w-2.5', st.fg)} />
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">{it.name}</span>
                          </span>
                          <span className={cn('shrink-0 text-[11px] font-medium tabular-nums', it.direction === 'in' ? 'text-positive' : 'text-foreground')}>
                            {it.direction === 'in' ? '+' : '−'}{fmtMoney(it.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {monthName} {currentDay} – {daysInMonth}
        </span>
        <span className="text-xs text-muted-foreground">{upcoming.length} upcoming</span>
      </div>
    </div>
  );
}
