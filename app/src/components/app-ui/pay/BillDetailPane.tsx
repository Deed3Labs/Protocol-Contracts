import { useEffect, useState } from 'react';
import { Globe, Landmark, Sparkles, TrendingUp, CalendarClock, Wallet, AlertCircle } from 'lucide-react';
import { billTiming } from '@/lib/billStatus';
import { STATUS_PILL } from '@/components/app-ui/pay/statusStyle';
import { CATEGORY_TINT } from '@/components/app-ui/pay/categoryStyle';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useKyc } from '@/context/KycContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPayBillerPayments, type PayBillerPayment } from '@/utils/apiClient';
import BillActivity from '@/components/app-ui/pay/BillActivity';
import { cn } from '@/lib/utils';

/*
 * The "detail" half. Amount and paying lead; the equity a bill has generated sits alongside rather
 * than in a separate widget, so money and credits read as one picture.
 *
 * With nothing selected this deliberately stays calm — a short summary of the month instead of
 * auto-selecting a bill, so opening the page isn't an immediate demand for attention.
 */
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nInt = (n: number) => Math.round(n).toLocaleString('en-US');
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const openPortal = (url: string) =>
  window.open(/^https?:\/\//i.test(url) ? url : `https://${url}`, '_blank', 'noopener,noreferrer');

function EmptyState({ bills, onSelect }: { bills: Bill[]; onSelect?: (id: string) => void }) {
  const { summary } = usePay();

  const stats = [
    { icon: CalendarClock, label: 'Due', value: `$${money(summary?.dueThisMonth ?? 0)}`, tone: 'text-foreground' },
    { icon: Wallet, label: 'Paid · 30 days', value: `$${money(summary?.paid30 ?? 0)}`, tone: 'text-foreground' },
    { icon: TrendingUp, label: 'Credits', value: `+${nInt(summary?.equityThisMonth ?? 0)}`, tone: 'text-positive' },
  ];

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      <div className="text-xs font-medium text-muted-foreground">This month</div>

      {/* Across the top rather than a narrow centred stack — the pane is wide, so use it. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-secondary/50 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <s.icon className="h-3.5 w-3.5" />
              <span className="truncate">{s.label}</span>
            </div>
            <div className={cn('mt-1 font-display text-lg tabular-nums tracking-tight', s.tone)}>{s.value}</div>
          </div>
        ))}
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <p className="text-sm font-medium text-foreground">No bills yet</p>
          <p className="mt-1 max-w-[24ch] text-xs text-muted-foreground">
            Add your rent, utilities and subscriptions to track them and earn equity.
          </p>
        </div>
      ) : (
        <div className="mt-5 min-h-0 flex-1 border-t border-border pt-4">
          <BillActivity bare onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

export default function BillDetailPane({ bill, bills, onSelect }: { bill: Bill | null; bills: Bill[]; onSelect?: (id: string) => void }) {
  const { address } = useAppKitAccount();
  const { openPay, streak } = usePay();
  const { verified } = useKyc();
  const { accelerated } = useMemberProfile();
  const [payments, setPayments] = useState<PayBillerPayment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bill || !address) {
      setPayments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getPayBillerPayments(address, bill.id)
      .then((rows) => !cancelled && setPayments(rows))
      .catch(() => !cancelled && setPayments([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [bill, address]);

  if (!bill) return <EmptyState bills={bills} onSelect={onSelect} />;

  const timing = billTiming(bill.dueDay, bill.lastPaidAt);
  const earns = creditsFor(bill, streak, bill.amount, accelerated);
  const paidToDate = payments.reduce((n, p) => n + p.amount, 0);
  // Credits are awarded per on-time payment; recompute rather than guess so it matches the ledger.
  const creditsToDate = payments.filter((p) => p.onTime).reduce((n, p) => n + creditsFor(bill, streak, p.amount, accelerated), 0);
  const balance = timing.status === 'paid' ? 0 : bill.amount;

  // The bar is DOLLARS ONLY — paid to date vs what's still owed. Credits are points, not money, so
  // they're reported beside it; mixing the two in one proportional bar makes the widths meaningless.
  const barTotal = Math.max(1, paidToDate + balance);
  const seg = (v: number) => `${(v / barTotal) * 100}%`;

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-center gap-3">
        {/* Category colour, matching the row and the month bar; status lives on the pill. */}
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', CATEGORY_TINT[bill.type])}>
          <bill.icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold tracking-tight text-foreground">{bill.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {bill.payee && bill.payee !== bill.name ? `${bill.payee} · ` : ''}
            {bill.dueDay ? 'Monthly' : 'No schedule'}
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium', STATUS_PILL[timing.status])}>
          {timing.label || 'No due date'}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <span className="font-display text-3xl tracking-tight tabular-nums text-foreground">{money(bill.amount).split('.')[0]}</span>
        <span className="text-sm text-muted-foreground">.{money(bill.amount).split('.')[1]}</span>
        {earns > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-positive" /> earns <span className="font-medium text-positive">+{nInt(earns)}</span>
          </span>
        )}
      </div>

      {(paidToDate > 0 || balance > 0) && (
        <div className="mt-3">
          <div className="flex h-2 gap-1 overflow-hidden">
            {paidToDate > 0 && <span className="rounded-full bg-positive" style={{ width: seg(paidToDate) }} />}
            {balance > 0 && <span className="rounded-full bg-muted-foreground/30" style={{ width: seg(balance) }} />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {paidToDate > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-xs font-medium text-positive">
                Paid <span className="tabular-nums">${money(paidToDate)}</span>
              </span>
            )}
            {balance > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Due <span className="tabular-nums">${money(balance)}</span>
              </span>
            )}
            {creditsToDate > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-positive" />
                <span className="font-medium tabular-nums text-positive">{nInt(creditsToDate)}</span> credits earned
              </span>
            )}
          </div>
        </div>
      )}

      {/* What's actually at stake when a bill runs late. Not a risk score — the streak really does
          reset, and the multiplier really does drop back to 1x. */}
      {timing.status === 'overdue' && streak > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-negative/10 p-2.5">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-negative" />
          <p className="text-[11px] leading-relaxed text-negative">
            Paying late ends your {streak}-month streak and drops earning back to 1×.
          </p>
        </div>
      )}

      {/* Verified members can pay from Cash; everyone else goes to the biller's own site. */}
      <div className="mt-4 flex gap-2">
        {verified ? (
          <>
            <button
              type="button"
              onClick={() => openPay(bill.id)}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Pay ${money(bill.amount)}
            </button>
            <button
              type="button"
              disabled={!bill.portalUrl}
              onClick={() => bill.portalUrl && openPortal(bill.portalUrl)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
            >
              <Globe className="h-4 w-4" /> Their site
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!bill.portalUrl}
              onClick={() => bill.portalUrl && openPortal(bill.portalUrl)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              <Globe className="h-4 w-4" /> Pay on their site
            </button>
            <button
              type="button"
              onClick={() => openPay(bill.id)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Landmark className="h-4 w-4" /> Verify
            </button>
          </>
        )}
      </div>

      <div className="mt-5 min-h-0 flex-1 border-t border-border pt-3">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">Payment history</div>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-secondary" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {payments.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-border py-1.5 text-xs last:border-0">
                <span className="text-muted-foreground">{shortDate(p.paidAt)}</span>
                <span className="tabular-nums text-foreground">
                  ${money(p.amount)}
                  {p.onTime && <span className="ml-1.5 text-positive">+{nInt(creditsFor(bill, streak, p.amount, accelerated))}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
