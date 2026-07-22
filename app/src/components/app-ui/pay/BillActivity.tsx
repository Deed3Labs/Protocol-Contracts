import { useMemo } from 'react';
import { Check, Clock, AlertCircle, Sparkles, type LucideIcon } from 'lucide-react';
import { billTiming } from '@/lib/billStatus';
import { usePay, creditsFor } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * What's coming and what just happened — the reason to open this page mid-week rather than only when
 * something is due.
 *
 * Built entirely from data already loaded: due dates come from each bill's timing, and recent
 * payments from `lastPaidAt` (joined onto the biller list). No extra fetch, so it can't be stale
 * relative to the list beside it.
 */
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const nInt = (n: number) => Math.round(n).toLocaleString('en-US');
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

interface Row {
  id: string;
  icon: LucideIcon;
  tint: string;
  title: string;
  detail: string;
  meta: string;
  onClick?: () => void;
}

function Column({ heading, rows, empty }: { heading: string; rows: Row[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{heading}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map((r) => {
            const Tag = r.onClick ? 'button' : 'div';
            return (
              <Tag
                key={r.id}
                {...(r.onClick ? { type: 'button' as const, onClick: r.onClick } : {})}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg p-2 text-left',
                  r.onClick && 'transition-colors hover:bg-secondary/60',
                )}
              >
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', r.tint)}>
                  <r.icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{r.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{r.detail}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{r.meta}</span>
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BillActivity({ onSelect }: { onSelect?: (id: string) => void }) {
  const { bills, streak } = usePay();
  const { accelerated } = useMemberProfile();

  const { upcoming, recent } = useMemo(() => {
    const up: Row[] = [];
    const rec: { row: Row; at: number }[] = [];

    for (const bill of bills) {
      const t = billTiming(bill.dueDay, bill.lastPaidAt);

      if (t.status === 'overdue' || t.status === 'due-soon' || t.status === 'upcoming') {
        up.push({
          id: `due-${bill.id}`,
          icon: t.status === 'overdue' ? AlertCircle : Clock,
          tint: t.status === 'overdue' ? 'bg-negative/10 text-negative' : 'bg-secondary text-muted-foreground',
          title: bill.name,
          detail: t.label,
          meta: money(bill.amount),
          onClick: onSelect ? () => onSelect(bill.id) : undefined,
        });
      }

      if (bill.lastPaidAt) {
        const at = new Date(bill.lastPaidAt).getTime();
        if (!Number.isNaN(at)) {
          const earned = creditsFor(bill, streak, bill.amount, accelerated);
          rec.push({
            at,
            row: {
              id: `paid-${bill.id}`,
              icon: Check,
              tint: 'bg-positive/10 text-positive',
              title: bill.name,
              detail: earned > 0 ? `Paid · +${nInt(earned)} credits` : 'Paid',
              meta: shortDate(new Date(at)),
              onClick: onSelect ? () => onSelect(bill.id) : undefined,
            },
          });
        }
      }
    }

    // Soonest first for what's coming; newest first for what's done.
    const byDue = (a: Row, b: Row) => a.id.localeCompare(b.id);
    up.sort((a, b) => {
      const ab = bills.find((x) => `due-${x.id}` === a.id);
      const bb = bills.find((x) => `due-${x.id}` === b.id);
      const at = ab ? (billTiming(ab.dueDay, ab.lastPaidAt).daysUntil ?? 999) : 999;
      const bt = bb ? (billTiming(bb.dueDay, bb.lastPaidAt).daysUntil ?? 999) : 999;
      return at - bt || byDue(a, b);
    });
    rec.sort((a, b) => b.at - a.at);

    return { upcoming: up.slice(0, 4), recent: rec.slice(0, 4).map((r) => r.row) };
  }, [bills, streak, accelerated, onSelect]);

  if (bills.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 lg:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Activity</span>
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Column heading="Coming up" rows={upcoming} empty="Nothing scheduled." />
        <Column heading="Recently paid" rows={recent} empty="No payments recorded yet." />
      </div>
    </div>
  );
}
