import { useEffect, useMemo, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import ActivityDetailModal, { type DetailInfo } from '@/components/app-ui/ActivityDetailModal';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import { usePay, creditsFor, type Bill, type BillType } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { getPayBillerPayments, type PayBillerPayment } from '@/utils/apiClient';
import { matchPortal, type BillPortal } from '@/data/billPortals';

/*
 * Bill detail: maps a Bill + its payment history into the unified ActivityDetailModal, with the two pay
 * actions ("Pay from balance" = ACH via the existing Pay flow; "Pay on their site" = the biller's portal
 * with the Clear card). See ActivityDetailModal (presentational) + PayContext.
 */
const nInt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_TINT: Record<BillType, string> = {
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  utility: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  subscription: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  card: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  phone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  other: 'bg-secondary text-foreground',
};
const TYPE_LABEL: Record<BillType, string> = {
  rent: 'Rent', utility: 'Utility', subscription: 'Subscription', card: 'Credit card', phone: 'Phone', other: 'Bill',
};

export default function BillDetailModal({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { address } = useAppKitAccount();
  const { openPay, streak, setReminders } = usePay();
  const { accelerated } = useMemberProfile();
  const [payments, setPayments] = useState<PayBillerPayment[]>([]);
  const [reminders, setLocalReminders] = useState(true);
  const [portal, setPortal] = useState<BillPortal | null>(null);

  useEffect(() => {
    setLocalReminders(bill?.reminders ?? true);
    if (!bill || !address) { setPayments([]); return; }
    let cancelled = false;
    void getPayBillerPayments(address, bill.id).then((p) => { if (!cancelled) setPayments(p); });
    return () => { cancelled = true; };
  }, [bill, address]);

  // Prefer a portal the user saved on the biller; else best-effort match by name.
  const matched: BillPortal | undefined = useMemo(() => {
    if (!bill) return undefined;
    if (bill.portalUrl) return { id: bill.id, name: bill.name, category: 'utilities', url: bill.portalUrl };
    return matchPortal(bill.payee || bill.name);
  }, [bill]);

  const info: DetailInfo | null = useMemo(() => {
    if (!bill) return null;
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const count = payments.length;
    const avg = count ? total / count : bill.amount;
    const creditsEarned = payments.reduce((s, p) => s + creditsFor({ type: bill.type, amount: p.amount }, streak, p.amount, accelerated), 0);
    const oldest = payments.length ? new Date(payments[payments.length - 1].paidAt) : null;
    const months = oldest ? Math.max(1, Math.round((Date.now() - oldest.getTime()) / (30 * 864e5))) : 0;

    return {
      icon: bill.icon,
      iconTint: TYPE_TINT[bill.type],
      title: bill.name,
      subtitle: 'Bill',
      typeLabel: TYPE_LABEL[bill.type],
      status: { label: 'Active', tone: 'positive' },
      nextDue: bill.dueLabel || null,
      address: bill.address,
      portalHost: matched ? new URL(matched.url).host : null,
      onPortal: matched ? () => setPortal(matched) : undefined,
      notifications: {
        enabled: reminders,
        onToggle: (v: boolean) => { setLocalReminders(v); setReminders(bill.id, v); },
      },
      metrics: [
        { label: 'Total paid', value: nInt(total), unit: 'USD' },
        { label: 'Credits earned', value: nInt(creditsEarned) },
        { label: 'Payments', value: String(count) },
        months
          ? { label: 'Active since', value: String(months), unit: 'mo' }
          : { label: 'Avg payment', value: nInt(avg), unit: 'USD' },
      ],
      historyTitle: 'Payment history',
      history: payments.map((p) => ({
        id: p.id,
        title: 'Payment successful',
        subtitle: new Date(p.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) + (p.onTime ? '' : ' · late'),
        value: n2(p.amount),
        unit: 'USD',
        success: true,
      })),
      actions: [
        { label: 'Pay from balance', primary: true, onClick: () => { onClose(); openPay(bill.id); } },
        { label: 'Pay on their site', disabled: !matched, onClick: () => matched && setPortal(matched) },
      ],
    };
  }, [bill, payments, matched, reminders, streak, accelerated, openPay, onClose, setReminders]);

  return (
    <>
      <ActivityDetailModal open={!!bill} onOpenChange={(o) => !o && onClose()} item={info} />
      <BillPortalBrowser portal={portal} onClose={() => setPortal(null)} />
    </>
  );
}
