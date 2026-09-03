import { useEffect, useMemo, useState } from 'react';
import { Globe, Wallet, TrendingUp, Hash, Calendar } from 'lucide-react';
import { useAppKitAccount } from '@/lib/walletCompat';
import ActivityDetailModal, { type DetailInfo } from '@/components/app-ui/ActivityDetailModal';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import { useKyc } from '@/context/KycContext';
import { usePay, creditsFor, type Bill, type BillType } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { getPayBillerPayments, getMerchantMeta, setMerchantMeta, type PayBillerPayment, type MerchantMeta } from '@/utils/apiClient';
import { matchPortal, type BillPortal } from '@/data/billPortals';

/*
 * Bill detail: maps a Bill + its payment history into the unified ActivityDetailModal. Portal + address
 * come from the shared per-merchant store (getMerchantMeta), falling back to the biller record / a
 * directory match; they're inline-editable (setMerchantMeta, keyed by merchant name, so edits also show
 * on the matching transactions). Two pay actions: "Pay from balance" (ACH) + "Pay on their site" (portal).
 */
const nInt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function shareReceipt(name: string, amount: number) {
  const text = `${name} — $${n2(amount)} paid via Clear`;
  if (typeof navigator !== 'undefined' && navigator.share) void navigator.share({ title: 'Receipt', text }).catch(() => {});
  else void navigator.clipboard?.writeText(text).catch(() => {});
}

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
  const { verified } = useKyc();
  const { accelerated } = useMemberProfile();
  const [payments, setPayments] = useState<PayBillerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<MerchantMeta | null>(null);
  const [reminders, setLocalReminders] = useState(true);
  const [portal, setPortal] = useState<BillPortal | null>(null);
  const merchantName = bill ? bill.payee || bill.name : '';

  useEffect(() => {
    setLocalReminders(bill?.reminders ?? true);
    setMeta(null);
    if (!bill || !address) { setPayments([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void getPayBillerPayments(address, bill.id).then((p) => { if (!cancelled) { setPayments(p); setLoading(false); } });
    void getMerchantMeta(address, bill.payee || bill.name).then((m) => { if (!cancelled) setMeta(m); });
    return () => { cancelled = true; };
  }, [bill, address]);

  // Effective portal: user-set (merchant store) → biller record → directory match.
  const portalUrl = meta?.portalUrl ?? bill?.portalUrl ?? (bill ? matchPortal(bill.payee || bill.name)?.url ?? null : null);
  const addressVal = meta?.address ?? bill?.address ?? null;

  const openPortal = () => {
    if (!bill || !portalUrl) return;
    setPortal({ id: bill.id, name: bill.name, category: 'utilities', url: portalUrl });
  };
  const savePortal = (v: string) => { setMeta((m) => ({ portalUrl: v || null, address: m?.address ?? addressVal })); if (address) void setMerchantMeta(address, merchantName, { portalUrl: v || null }); };
  const saveAddress = (v: string) => { setMeta((m) => ({ portalUrl: m?.portalUrl ?? portalUrl, address: v || null })); if (address) void setMerchantMeta(address, merchantName, { address: v || null }); };

  const info: DetailInfo | null = useMemo(() => {
    if (!bill) return null;
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const count = payments.length;
    const avg = count ? total / count : bill.amount;
    const creditsEarned = payments.reduce((s, p) => s + creditsFor({ type: bill.type, amount: p.amount }, streak, p.amount, accelerated), 0);
    const oldest = payments.length ? new Date(payments[payments.length - 1].paidAt) : null;
    const months = oldest ? Math.max(1, Math.round((Date.now() - oldest.getTime()) / (30 * 864e5))) : 0;
    const latest = payments[0];
    const latestCredits = latest ? creditsFor({ type: bill.type, amount: latest.amount }, streak, latest.amount, accelerated) : 0;

    return {
      icon: bill.icon,
      iconTint: TYPE_TINT[bill.type],
      title: bill.name,
      subtitle: 'Bill',
      typeLabel: TYPE_LABEL[bill.type],
      status: { label: 'Active', tone: 'positive' },
      nextDue: bill.dueLabel || null,
      reference: latest ? `#${latest.id}` : null,
      account: 'Cash · Clear Account',
      dateTime: latest ? new Date(latest.paidAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null,
      portal: { url: portalUrl, onOpen: portalUrl ? openPortal : undefined, onSave: savePortal },
      address: { value: addressVal, onSave: saveAddress },
      receipt: latest
        ? {
            lines: [
              { label: 'Amount', value: `$${n2(latest.amount)}` },
              { label: 'Fee', value: 'Free', tone: 'positive' as const },
              { label: 'Credits earned', value: `+${latestCredits}`, tone: 'positive' as const },
            ],
            total: { label: 'Total', value: `$${n2(latest.amount)}` },
            onShare: () => shareReceipt(bill.name, latest.amount),
          }
        : undefined,
      notifications: {
        enabled: reminders,
        onToggle: (v: boolean) => { setLocalReminders(v); setReminders(bill.id, v); },
      },
      loading,
      metrics: [
        { label: 'Total paid', value: `$${nInt(total)}`, animateTo: total, format: (n: number) => `$${nInt(n)}`, icon: Wallet },
        { label: 'Credits earned', value: nInt(creditsEarned), animateTo: creditsEarned, format: (n: number) => nInt(n), icon: TrendingUp },
        { label: 'Payments', value: String(count), animateTo: count, format: (n: number) => String(Math.round(n)), icon: Hash },
        months
          ? { label: 'Active since', value: `${months} mo`, icon: Calendar }
          : { label: 'Avg payment', value: `$${nInt(avg)}`, animateTo: avg, format: (n: number) => `$${nInt(n)}`, icon: Calendar },
      ],
      historyTitle: 'Payment history',
      history: payments.map((p) => {
        const c = creditsFor({ type: bill.type, amount: p.amount }, streak, p.amount, accelerated);
        const d = new Date(p.paidAt);
        return {
          id: p.id,
          title: 'Payment successful',
          subtitle: `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${p.onTime ? '' : ' · late'}${c > 0 ? ` · +${c} credits` : ''}`,
          value: `$${n2(p.amount)}`,
          success: true,
          group: String(d.getFullYear()),
        };
      }),
      // Paying on the biller's own site needs nothing from us, so it leads for members who haven't
      // verified — the Clear-balance option stays visible as the upsell rather than disappearing.
      actions: verified
        ? [
            { label: 'Pay from balance', primary: true, onClick: () => { onClose(); openPay(bill.id); } },
            { label: 'Pay on their site', icon: Globe, disabled: !portalUrl, onClick: openPortal },
          ]
        : [
            { label: 'Pay on their site', primary: true, icon: Globe, disabled: !portalUrl, onClick: openPortal },
            { label: 'Pay from balance · Verify', onClick: () => { onClose(); openPay(bill.id); } },
          ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, payments, loading, portalUrl, addressVal, reminders, streak, accelerated, openPay, onClose, setReminders, verified]);

  return (
    <>
      <ActivityDetailModal open={!!bill} onOpenChange={(o) => !o && onClose()} item={info} />
      <BillPortalBrowser portal={portal} onClose={() => setPortal(null)} />
    </>
  );
}
