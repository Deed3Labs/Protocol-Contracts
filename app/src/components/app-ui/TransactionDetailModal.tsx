import { useEffect, useMemo, useState } from 'react';
import { Wallet, Hash, TrendingUp, Clock } from 'lucide-react';
import { useAppKitAccount } from '@/lib/walletCompat';
import ActivityDetailModal, { type DetailInfo, type Tone } from '@/components/app-ui/ActivityDetailModal';
import { CATEGORY } from '@/components/app-ui/RecentActivity';
import { getMerchantMeta, setMerchantMeta, type MerchantMeta } from '@/utils/apiClient';
import type { ActivityItem, ActivityStatus } from '@/hooks/useClearTransactions';

/*
 * Transaction detail: the same unified ActivityDetailModal as bills, but for a transaction — no pay
 * buttons, and the "history" is ALL activity with that same merchant (grouped by name). Portal + address
 * come from the shared per-merchant store (keyed by merchant name), inline-editable — so a portal added
 * here also shows on the matching bill. Metrics summarize the relationship (total, count, average, last).
 */
const usd0 = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const usd2 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_TONE: Record<ActivityStatus, Tone> = { completed: 'positive', pending: 'pending', failed: 'negative' };
const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function dayGroup(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - 864e5) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const acctLabel = (source: string, primary?: string) =>
  source === 'bank'
    ? 'Bank account'
    : primary && source === primary.toLowerCase()
      ? 'Cash · Clear Account'
      : /^0x/.test(source)
        ? `External · •••• ${source.slice(-4)}`
        : source;
function shareTx(name: string, amount: number) {
  const text = `${name} — ${usd2(amount)}`;
  if (typeof navigator !== 'undefined' && navigator.share) void navigator.share({ title: 'Receipt', text }).catch(() => {});
  else void navigator.clipboard?.writeText(text).catch(() => {});
}

export default function TransactionDetailModal({
  tx,
  allItems,
  onClose,
}: {
  tx: ActivityItem | null;
  allItems: ActivityItem[];
  onClose: () => void;
}) {
  const { address } = useAppKitAccount();
  const [meta, setMeta] = useState<MerchantMeta | null>(null);
  const merchantName = tx?.name ?? '';

  useEffect(() => {
    setMeta(null);
    if (!tx || !address) return;
    let cancelled = false;
    void getMerchantMeta(address, tx.name).then((m) => { if (!cancelled) setMeta(m); });
    return () => { cancelled = true; };
  }, [tx, address]);

  const savePortal = (v: string) => { setMeta((m) => ({ portalUrl: v || null, address: m?.address ?? null })); if (address) void setMerchantMeta(address, merchantName, { portalUrl: v || null }); };
  const saveAddress = (v: string) => { setMeta((m) => ({ portalUrl: m?.portalUrl ?? null, address: v || null })); if (address) void setMerchantMeta(address, merchantName, { address: v || null }); };

  const info: DetailInfo | null = useMemo(() => {
    if (!tx) return null;
    const key = tx.name.trim().toLowerCase();
    const related = allItems.filter((i) => i.name.trim().toLowerCase() === key).sort((a, b) => b.ts - a.ts);
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
      reference: `#${tx.id}`,
      account: acctLabel(tx.source, address),
      dateTime: new Date(tx.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      portal: {
        url: meta?.portalUrl ?? null,
        onOpen: meta?.portalUrl ? () => window.open(meta.portalUrl!, '_blank', 'noopener,noreferrer') : undefined,
        onSave: savePortal,
      },
      address: { value: meta?.address ?? null, onSave: saveAddress },
      metrics: [
        { label: count > 1 ? 'Total' : 'Amount', value: usd0(total), icon: Wallet },
        { label: 'Transactions', value: String(count), icon: Hash },
        { label: 'Average', value: usd0(avg), icon: TrendingUp },
        { label: 'Last', value: last.date, icon: Clock },
      ],
      receipt: {
        lines: [{ label: tx.amount > 0 ? 'Received' : 'Amount', value: usd2(tx.amount), tone: (tx.amount > 0 ? 'positive' : 'muted') as Tone }],
        total: { label: 'Total', value: usd2(tx.amount) },
        onShare: () => shareTx(tx.name, tx.amount),
      },
      historyTitle: 'Activity',
      history: items.map((i) => ({
        id: i.id,
        title: i.amount > 0 ? 'Received' : 'Payment',
        subtitle: timeOf(i.ts),
        value: usd2(i.amount),
        tone: (i.amount > 0 ? 'positive' : 'muted') as Tone,
        direction: (i.amount > 0 ? 'in' : 'out') as 'in' | 'out',
        group: dayGroup(i.ts),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, allItems, meta, address]);

  return <ActivityDetailModal open={!!tx} onOpenChange={(o) => !o && onClose()} item={info} />;
}
