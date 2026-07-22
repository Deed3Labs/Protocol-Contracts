import { useMemo } from 'react';
import { Flame, type LucideIcon } from 'lucide-react';
import { billTiming } from '@/lib/billStatus';
import { rewardMultiplier, MAX_MULTIPLIER, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * The status strip at the top of Pay.
 *
 * Follows StatBar's treatment — one hairline-divided container of neutral cells — because that's how
 * every other summary in the app reads. Urgency is carried by a small pill on the value, not by
 * tinting whole cards: saturated blocks shout far louder than anything else on the page.
 */
const fmt = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function Cell({
  label,
  value,
  hint,
  pill,
  pillTone,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  pill?: string;
  pillTone?: 'negative' | 'amber' | 'positive';
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn('bg-card p-4 text-left lg:p-5', onClick && 'transition-colors hover:bg-secondary/40')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-display text-2xl tracking-tight tabular-nums text-foreground">{value}</span>
        {pill && (
          <span
            className={cn(
              'rounded-lg px-1.5 py-0.5 text-[11px] font-medium',
              pillTone === 'negative' && 'bg-negative/10 text-negative',
              pillTone === 'amber' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
              pillTone === 'positive' && 'bg-positive/10 text-positive',
            )}
          >
            {pill}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </Tag>
  );
}

export default function BillAttentionBand({
  bills,
  streak,
  onSelect,
}: {
  bills: Bill[];
  streak: number;
  onSelect?: (id: string) => void;
}) {
  const { accelerated } = useMemberProfile();

  const { overdue, dueSoon, upcomingNext, dueTotal } = useMemo(() => {
    const o: Bill[] = [];
    const d: Bill[] = [];
    let next: { bill: Bill; label: string; days: number } | null = null;
    let total = 0;
    for (const bill of bills) {
      const t = billTiming(bill.dueDay, bill.lastPaidAt);
      if (t.status === 'overdue') o.push(bill);
      else if (t.status === 'due-soon') d.push(bill);
      if (t.status !== 'paid') total += bill.amount || 0;
      if (t.status !== 'paid' && t.daysUntil != null && (!next || t.daysUntil < next.days)) {
        next = { bill, label: t.label, days: t.daysUntil };
      }
    }
    return { overdue: o, dueSoon: d, upcomingNext: next, dueTotal: total };
  }, [bills]);

  const multiplier = rewardMultiplier(streak, accelerated);
  const atMax = multiplier >= MAX_MULTIPLIER;
  const nextTierIn = Math.max(0, (Math.floor(Math.max(streak, 0) / 6) + 1) * 6 - streak);
  const sum = (rows: Bill[]) => rows.reduce((n, b) => n + (b.amount || 0), 0);

  // Middle cell adapts: overdue when there is any, otherwise what's next.
  const middle = overdue.length
    ? {
        label: 'Overdue',
        value: fmt(sum(overdue)),
        pill: `${overdue.length}`,
        pillTone: 'negative' as const,
        hint: overdue.map((b) => b.name).slice(0, 2).join(' · '),
        onClick: () => onSelect?.(overdue[0].id),
      }
    : dueSoon.length
      ? {
          label: 'Due this week',
          value: fmt(sum(dueSoon)),
          pill: `${dueSoon.length}`,
          pillTone: 'amber' as const,
          hint: dueSoon.map((b) => b.name).slice(0, 2).join(' · '),
          onClick: () => onSelect?.(dueSoon[0].id),
        }
      : {
          label: 'Next due',
          value: upcomingNext ? fmt(upcomingNext.bill.amount) : '—',
          hint: upcomingNext ? `${upcomingNext.bill.name} · ${upcomingNext.label.toLowerCase()}` : 'Nothing scheduled',
          onClick: upcomingNext ? () => onSelect?.(upcomingNext.bill.id) : undefined,
        };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-border">
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
        <Cell label="Due this month" value={fmt(dueTotal)} hint={`${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} tracked`} />
        <Cell {...middle} />
        <Cell
          label="On-time streak"
          value={`${streak} ${streak === 1 ? 'mo' : 'mos'}`}
          icon={Flame}
          pill={`${multiplier}×`}
          pillTone={streak > 0 ? 'positive' : undefined}
          hint={accelerated || atMax ? 'Earning the maximum' : `${Math.min(multiplier + 0.25, MAX_MULTIPLIER)}× after ${nextTierIn} more on time`}
        />
      </div>
    </div>
  );
}
