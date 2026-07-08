import { useMemo } from 'react';
import { Wallet, Hash, TrendingUp, Clock } from 'lucide-react';
import ActivityDetailModal, { type DetailInfo, type Tone } from '@/components/app-ui/ActivityDetailModal';
import { CATEGORY } from '@/components/app-ui/RecentActivity';
import type { ActivityItem, ActivityStatus } from '@/hooks/useClearTransactions';

/*
 * Transaction detail: the same unified ActivityDetailModal as bills, but for a transaction — no pay
 * buttons, and the "history" is ALL activity with that same merchant (grouped by name). Metrics summarize
 * the relationship (total, count, average, last).
 */
const usd0 = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const usd2 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_TONE: Record<ActivityStatus, Tone> = { completed: 'positive', pending: 'pending', failed: 'negative' };

export default function TransactionDetailModal({
  tx,
  allItems,
  onClose,
}: {
  tx: ActivityItem | null;
  allItems: ActivityItem[];
  onClose: () => void;
}) {
  const info: DetailInfo | null = useMemo(() => {
    if (!tx) return null;
    const key = tx.name.trim().toLowerCase();
    const related = allItems
      .filter((i) => i.name.trim().toLowerCase() === key)
      .sort((a, b) => b.ts - a.ts);
    const items = related.length ? related : [tx];

    const total = items.reduce((s, i) => s + Math.abs(i.amount), 0);
    const count = items.length;
    const avg = count ? total / count : Math.abs(tx.amount);
    const last = items[0];
    const { icon, tint } = CATEGORY[tx.category];

    return {
      icon,
      iconTint: tint,
      title: tx.name,
      subtitle: 'Transaction',
      typeLabel: `${tx.spendCategory || tx.category}${tx.internal ? ' · transfer' : ''}`,
      status: { label: tx.status, tone: STATUS_TONE[tx.status] },
      metrics: [
        { label: count > 1 ? 'Total' : 'Amount', value: usd0(total), icon: Wallet },
        { label: 'Transactions', value: String(count), icon: Hash },
        { label: 'Average', value: usd0(avg), icon: TrendingUp },
        { label: 'Last', value: last.date, icon: Clock },
      ],
      historyTitle: 'Activity',
      history: items.map((i) => ({
        id: i.id,
        title: i.amount > 0 ? 'Received' : 'Payment',
        subtitle: `${i.category} · ${i.date}`,
        value: usd2(i.amount),
        tone: (i.amount > 0 ? 'positive' : 'muted') as Tone,
        success: i.status === 'completed',
      })),
    };
  }, [tx, allItems]);

  return <ActivityDetailModal open={!!tx} onOpenChange={(o) => !o && onClose()} item={info} />;
}
