import { useEffect, useState } from 'react';
import {
  ArrowLeft, Award, Calendar, Check, ChevronDown, CreditCard, Landmark, Loader2, Lock, Pencil, Plus, Sparkles,
  Trash2, Wallet, Zap,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { usePay, creditsFor, streakMultiplier, BILL_TYPES, type Bill, type BillType } from '@/context/PayContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { getBridgeVirtualAccount, type BridgeVirtualAccount } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

/*
 * "Pay" — one adaptive flow for rent + bills (Clear Pay). Rent gets the equity / Clear Deed
 * treatment; utility/card bills are lighter but still earn on-time Equity Credits. Crypto is
 * abstracted; credits are NON-redeemable and only count toward the Clear Deed milestone.
 *
 * SEAM: wire to the Clear Pay rent-routing + biller backend; on-time payment writes the credit
 * accrual + credit-bureau report. Funding !== balance converts to USDC first (see Add money).
 */

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n: number) => n.toLocaleString('en-US');

interface Source {
  id: string;
  name: string;
  detail: string;
  icon: typeof Wallet;
  disabled?: boolean; // e.g. card issuance — coming soon
}

type Draft = { name: string; payee: string; amount: string; dueDay: string; type: BillType };
const emptyDraft: Draft = { name: '', payee: '', amount: '', dueDay: '', type: 'other' };

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function PayModal({
  open,
  onOpenChange,
  initialBillId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialBillId?: string;
}) {
  const { bills, getBill, addBiller, updateBiller, removeBiller, setBillerPayout, payViaUsdc, streak, recordBillPayment } = usePay();
  const { accounts } = useExternalAccounts();
  const bal = useClearBalances();
  const { email } = useMemberProfile();
  const [va, setVa] = useState<BridgeVirtualAccount | null>(null);
  const sources: Source[] = [
    // Cash = USDC balance, exposed as a Bridge virtual account (account/routing) for ACH-style pulls.
    {
      id: 'balance',
      name: 'Cash · USDC',
      detail: va?.available ? `Acct ••${va.accountLast4} · RTN ${va.routingNumber}` : `Virtual account · ${fmt(bal.cash)}`,
      icon: Wallet,
    },
    ...accounts.map((a) => ({ id: a.id, name: `${a.name} ••${a.mask}`, detail: `${a.type} · Plaid`, icon: Landmark })),
    { id: 'card', name: 'Card', detail: 'Coming soon', icon: CreditCard, disabled: true },
  ];
  const [step, setStep] = useState<'choose' | 'addBiller' | 'payoutDetails' | 'review' | 'status'>('choose');
  const [billId, setBillId] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [sourceId, setSourceId] = useState('balance');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [when, setWhen] = useState<'now' | 'due'>('now');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payoutForm, setPayoutForm] = useState({ account: '', routing: '', bank: '' });
  const [savingPayout, setSavingPayout] = useState(false);

  const selectBill = (b: Bill) => {
    setBillId(b.id);
    setAmountStr(String(b.amount));
    setStep('review');
  };

  const startAddBiller = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setStep('addBiller');
  };

  // Edit an existing (manual-only) biller: prefill the form and remember which one we're editing.
  const startEditBiller = (b: Bill) => {
    setEditingId(b.id);
    setDraft({ name: b.name, payee: b.payee, amount: String(b.amount), dueDay: b.dueDay ? String(b.dueDay) : '', type: b.type });
    setStep('addBiller');
  };

  useEffect(() => {
    if (!open) return;
    setSourceId('balance');
    setSourceOpen(false);
    setWhen('now');
    setDraft(emptyDraft);
    setEditingId(null);
    setPayError(null);
    setPayoutForm({ account: '', routing: '', bank: '' });
    const preset = initialBillId ? getBill(initialBillId) : undefined;
    if (preset) {
      setBillId(preset.id);
      setAmountStr(String(preset.amount));
      setStep('review');
    } else {
      setBillId(null);
      setAmountStr('');
      setStep('choose');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBillId]);

  // Execute the payment. Pay-now from Cash·USDC on a payable biller does a real Bridge ACH payout;
  // scheduled payments (and the not-yet-wired bank source) stay an optimistic record for now.
  const handlePay = async () => {
    if (!bill) return;
    setStep('status');
    setDone(false);
    setPayError(null);
    if (when === 'now' && sourceId === 'balance' && bill.payable) {
      const res = await payViaUsdc(bill.id, amount, email);
      if (res.success) setDone(true);
      else setPayError(res.message || 'Payment failed.');
      return;
    }
    if (when === 'now') await recordBillPayment(bill, amount);
    setTimeout(() => setDone(true), 1200);
  };

  const savePayoutDetails = async () => {
    if (!bill) return;
    const account = payoutForm.account.replace(/\s/g, '');
    const routing = payoutForm.routing.replace(/\s/g, '');
    if (!/^\d{4,17}$/.test(account) || !/^\d{9}$/.test(routing)) return;
    setSavingPayout(true);
    const ok = await setBillerPayout(bill.id, { accountNumber: account, routingNumber: routing, bankName: payoutForm.bank.trim() || undefined });
    setSavingPayout(false);
    if (ok) {
      setPayoutForm({ account: '', routing: '', bank: '' });
      setStep('review');
    }
  };

  // Pull the user's Bridge virtual account (account/routing) to show on the Cash · USDC source.
  useEffect(() => {
    if (!open || !email) return;
    let cancelled = false;
    getBridgeVirtualAccount(email)
      .then((r) => {
        if (!cancelled) setVa(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, email]);

  const amount = Number(amountStr) || 0;
  const bill = billId ? getBill(billId) : undefined;
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const isRent = bill?.type === 'rent';
  const credits = bill ? creditsFor(bill, streak) : 0;
  const mult = streakMultiplier(streak);

  const saveBiller = () => {
    const amt = Number(draft.amount) || 0;
    if (!draft.name.trim() || amt <= 0) return;
    const day = Math.min(Math.max(parseInt(draft.dueDay, 10) || 0, 0), 31) || null;
    const fields = {
      name: draft.name.trim(),
      payee: draft.payee.trim() || draft.name.trim(),
      type: draft.type,
      amount: amt,
      dueLabel: day ? `Due on the ${ordinal(day)}` : 'Due soon',
      dueDay: day,
    };
    if (editingId) {
      updateBiller(editingId, fields);
      setEditingId(null);
      setStep('choose');
      return;
    }
    const id = addBiller(fields);
    setBillId(id);
    setAmountStr(String(amt));
    setStep('review');
  };

  const creditsBadge = (b: Bill) => (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium text-positive">
      <Sparkles className="h-3 w-3" /> +{fmtInt(creditsFor(b, streak))}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
        {/* ---- CHOOSE A BILL ---- */}
        {step === 'choose' && (
          <div className="p-5">
            <div className="mb-1 text-base font-semibold text-foreground">Pay a bill</div>
            <p className="mb-4 text-xs text-muted-foreground">On-time payments earn Equity Credits toward your Clear Deed.</p>
            <div className="max-h-[46vh] space-y-1.5 overflow-y-auto">
              {bills.map((b) => {
                const Icon = b.icon;
                return (
                  <div key={b.id} className="flex items-center rounded-xl border border-border pr-1 transition-colors hover:bg-secondary/50">
                    <button type="button" onClick={() => selectBill(b)} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', b.type === 'rent' ? 'bg-info/10 text-info' : 'bg-secondary text-foreground')}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{b.name}</span>
                          {b.type === 'rent' && <span className="shrink-0 rounded bg-info/10 px-1 text-[9px] font-semibold uppercase text-info">Rent</span>}
                        </span>
                        <span className="block text-xs text-muted-foreground">Due {b.dueLabel}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-foreground">{fmt(b.amount)}</span>
                        {creditsBadge(b)}
                      </span>
                    </button>
                    {b.source === 'manual' && (
                      <button
                        type="button"
                        onClick={() => startEditBiller(b)}
                        aria-label={`Edit ${b.name}`}
                        className="ml-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeBiller(b.id)}
                      aria-label={`Remove ${b.name}`}
                      className="ml-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={startAddBiller}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Add a biller
            </button>
          </div>
        )}

        {/* ---- ADD A BILLER ---- */}
        {step === 'addBiller' && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => { setEditingId(null); setStep('choose'); }} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">{editingId ? 'Edit biller' : 'Add a biller'}</span>
            </div>
            <div className="space-y-3">
              <Labeled label="Biller name" required>
                <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Water — City Utilities" className={inputCls} />
              </Labeled>
              <Labeled label="Account / payee">
                <input value={draft.payee} onChange={(e) => setDraft((d) => ({ ...d, payee: e.target.value }))} placeholder="City Utilities" className={inputCls} />
              </Labeled>
              <Labeled label="Type">
                <div className="grid grid-cols-3 gap-2">
                  {BILL_TYPES.map((t) => {
                    const Icon = t.icon;
                    const active = draft.type === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, type: t.value }))}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11px] font-medium transition-colors',
                          active ? 'border-foreground bg-secondary/60 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/40',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </Labeled>
              <div className="grid grid-cols-2 gap-3">
                <Labeled label="Amount" required>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="0" className={cn(inputCls, 'pl-7 tabular-nums')} />
                  </div>
                </Labeled>
                <Labeled label="Due day of month">
                  <input
                    inputMode="numeric"
                    value={draft.dueDay}
                    onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
                    placeholder="1–31"
                    className={cn(inputCls, 'tabular-nums')}
                  />
                </Labeled>
              </div>
            </div>
            <button
              type="button"
              onClick={saveBiller}
              disabled={!draft.name.trim() || !(Number(draft.amount) > 0)}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              {editingId ? 'Save changes' : 'Continue'}
            </button>
          </div>
        )}

        {/* ---- ADD PAYOUT DETAILS (ACH destination) ---- */}
        {step === 'payoutDetails' && bill && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setStep('review')} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Payout details</span>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Where should <span className="font-medium text-foreground">{bill.payee || bill.name}</span> be paid? We send an ACH transfer to this bank account.
            </p>
            <div className="space-y-3">
              <Labeled label="Bank name">
                <input value={payoutForm.bank} onChange={(e) => setPayoutForm((f) => ({ ...f, bank: e.target.value }))} placeholder="e.g. Chase" className={inputCls} />
              </Labeled>
              <Labeled label="Routing number" required>
                <input inputMode="numeric" value={payoutForm.routing} onChange={(e) => setPayoutForm((f) => ({ ...f, routing: e.target.value.replace(/[^0-9]/g, '').slice(0, 9) }))} placeholder="9 digits" className={cn(inputCls, 'tabular-nums')} />
              </Labeled>
              <Labeled label="Account number" required>
                <input inputMode="numeric" value={payoutForm.account} onChange={(e) => setPayoutForm((f) => ({ ...f, account: e.target.value.replace(/[^0-9]/g, '').slice(0, 17) }))} placeholder="Account number" className={cn(inputCls, 'tabular-nums')} />
              </Labeled>
            </div>
            <button
              type="button"
              onClick={savePayoutDetails}
              disabled={savingPayout || !/^\d{9}$/.test(payoutForm.routing) || !/^\d{4,17}$/.test(payoutForm.account)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              {savingPayout && <Loader2 className="h-4 w-4 animate-spin" />}
              Save payout details
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" /> Account number is encrypted
            </p>
          </div>
        )}

        {/* ---- REVIEW ---- */}
        {step === 'review' && bill && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(initialBillId ? 'review' : 'choose')}
                aria-label="Back"
                className={cn('-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground', initialBillId && 'invisible')}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">{isRent ? 'Pay rent' : 'Pay bill'}</span>
            </div>

            {/* payee + editable amount */}
            <div className="flex items-center gap-3">
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', isRent ? 'bg-info/10 text-info' : 'bg-secondary text-foreground')}>
                <bill.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{bill.payee}</div>
                <div className="text-xs text-muted-foreground">{bill.name}</div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-border p-3">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 font-display text-2xl text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-full bg-transparent pl-6 font-display text-3xl tabular-nums text-foreground focus:outline-none"
                />
              </div>
            </div>

            {/* funding source */}
            <div className="relative mt-3">
              <button
                type="button"
                onClick={() => setSourceOpen((o) => !o)}
                className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <source.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-muted-foreground">Pay from</span>
                  <span className="block truncate text-sm font-medium text-foreground">{source.name}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="hidden text-xs text-muted-foreground sm:inline">{source.detail}</span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', sourceOpen && 'rotate-180')} />
                </span>
              </button>
              {sourceOpen && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={s.disabled}
                      onClick={() => {
                        if (s.disabled) return;
                        setSourceId(s.id);
                        setSourceOpen(false);
                      }}
                      className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm', s.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-secondary')}
                    >
                      <s.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">{s.detail}</span>
                      </span>
                      {s.disabled ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        s.id === sourceId && <Check className="h-4 w-4 shrink-0 text-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Clear Pay credits callout */}
            <div className="mt-3 overflow-hidden rounded-xl border border-positive/20 bg-positive/5 p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-positive/15 text-positive">
                  <Sparkles className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">+{fmtInt(credits)} Equity Credits</div>
                  <div className="text-[11px] text-muted-foreground">Pay on time · {streak}-mo streak ({mult.toFixed(2)}×)</div>
                </div>
                <Award className="h-4 w-4 shrink-0 text-positive" />
              </div>
              <div className="mt-2 border-t border-positive/15 pt-2 text-[11px] text-muted-foreground">
                {isRent ? 'Counts toward your Clear Deed down-payment.' : 'Builds equity + reports to your credit history.'}
              </div>
            </div>

            {/* when */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { id: 'now' as const, label: 'Pay now' },
                { id: 'due' as const, label: `On ${bill.dueLabel}` },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWhen(opt.id)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition-colors',
                    when === opt.id ? 'border-foreground bg-secondary/50 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/40',
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" /> {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={amount < 1}
              onClick={() => {
                // A biller needs ACH payout details before it can be paid; otherwise pay it.
                if (!bill.payable) {
                  setPayoutForm({ account: '', routing: '', bank: bill.payee || '' });
                  setStep('payoutDetails');
                  return;
                }
                void handlePay();
              }}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              {!bill.payable ? 'Add payout details' : when === 'now' ? `Pay ${fmt(amount)}` : `Schedule ${fmt(amount)}`}
            </button>
            {!bill.payable && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">Add the biller's bank account to pay it via ACH.</p>
            )}
          </div>
        )}

        {/* ---- STATUS ---- */}
        {step === 'status' && bill && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {payError ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-negative/10">
                  <Lock className="h-7 w-7 text-negative" />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">Payment failed</div>
                <div className="mt-1 max-w-[280px] text-sm text-muted-foreground">{payError}</div>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Try again
                </button>
              </>
            ) : !done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">{when === 'now' ? 'Paying…' : 'Scheduling…'}</div>
                <div className="mt-1 text-sm text-muted-foreground">{fmt(amount)} to {bill.payee}.</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{when === 'now' ? 'Payment sent' : `Scheduled for ${bill.dueLabel}`}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(amount)}</span> {when === 'now' ? 'paid to' : 'to'} {bill.payee}.
                </div>

                <div className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-positive/20 bg-positive/5 p-3 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-positive/15 text-positive">
                    <Sparkles className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">+{fmtInt(credits)} Equity Credits earned</div>
                    <div className="text-[11px] text-muted-foreground">
                      {isRent ? 'Toward your Clear Deed · ' : ''}On-time streak now {streak + (when === 'now' ? 1 : 0)} months
                    </div>
                  </div>
                  <Zap className="h-4 w-4 shrink-0 text-positive" />
                </div>

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

function Labeled({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-negative">*</span>}
      </span>
      {children}
    </label>
  );
}
