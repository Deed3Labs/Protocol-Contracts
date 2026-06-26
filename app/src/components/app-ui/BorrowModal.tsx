import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCredit, BASE_DRAW_FEE } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

/*
 * Borrow / Repay against the base Stable Credit line, scoped to a PURPOSE LINE (a named
 * allocation of the one base line). Crypto + mutual-credit plumbing abstracted to "borrow USD
 * against your limit." Borrow = overdraft (flat fee, no interest); repay = return toward $0 to
 * keep full borrowing power within the credit cycle.
 *
 * SEAM: wire to the StableCredit ledger (borrow = overdraft transfer to the user's USDC balance;
 * repay = transfer USDC/CLRUSD to burn the negative balance). Purpose lines are UI-only buckets.
 */

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BorrowModal({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: 'borrow' | 'repay';
}) {
  const { lines, activeLineId, available, cycleDaysLeft, baseLimit, borrow, repay } = useCredit();
  const [step, setStep] = useState<'amount' | 'review' | 'status'>('amount');
  const [amountStr, setAmountStr] = useState('');
  const [lineId, setLineId] = useState(activeLineId);
  const [lineOpen, setLineOpen] = useState(false);
  const [done, setDone] = useState(false);

  const isBorrow = mode === 'borrow';

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmountStr('');
    setLineId(activeLineId);
    setLineOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  const lineRoom = line ? Math.max(0, line.limit - line.used) : 0;
  const max = isBorrow ? Math.min(lineRoom, available) : line?.used ?? 0;

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    const t = setTimeout(() => {
      const amt = Number(amountStr) || 0;
      if (isBorrow) borrow(amt, lineId);
      else repay(amt, lineId);
      setDone(true);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const amount = Number(amountStr) || 0;
  const fee = isBorrow ? amount * BASE_DRAW_FEE : 0;
  const valid = amount >= 1 && amount <= max && !!line;
  const newLineUsed = isBorrow ? (line?.used ?? 0) + amount : Math.max(0, (line?.used ?? 0) - amount);
  const quick = isBorrow
    ? [100, 250, 500, Math.floor(max)].filter((n, i, a) => n > 0 && a.indexOf(n) === i)
    : [Math.round((line?.used ?? 0) / 2), line?.used ?? 0].filter((n, i, a) => n > 0 && a.indexOf(n) === i);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        {step === 'amount' && line && (
          <div className="p-5">
            <div className="mb-3 text-base font-semibold text-foreground">{isBorrow ? 'Borrow' : 'Repay'}</div>

            {/* line picker */}
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{isBorrow ? 'Borrow into' : 'Repay from'}</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLineOpen((o) => !o)}
                className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <line.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{line.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {isBorrow ? `${fmt(Math.min(lineRoom, available))} available` : `${fmt(line.used)} borrowed`}
                  </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', lineOpen && 'rotate-180')} />
              </button>
              {lineOpen && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-md">
                  {lines.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setLineId(l.id);
                        setLineOpen(false);
                        setAmountStr('');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary"
                    >
                      <l.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{l.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {isBorrow ? fmt(Math.max(0, l.limit - l.used)) : fmt(l.used)}
                      </span>
                      {l.id === lineId && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl text-muted-foreground">$</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl border border-border bg-background py-3 pl-9 pr-4 font-display text-3xl tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex gap-2">
              {quick.map((q, i) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmountStr(String(q))}
                  className={cn(
                    'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors',
                    amount === q ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {!isBorrow && i === quick.length - 1 ? 'All' : `$${q.toLocaleString()}`}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={!valid}
              onClick={() => setStep('review')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Review
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {amount > max ? `Max ${fmt(max)}` : isBorrow ? 'No interest · small flat fee · no fixed due date' : 'Lowers what you owe and restores your power'}
            </p>
          </div>
        )}

        {step === 'review' && line && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setStep('amount')} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Review</span>
            </div>

            <div className="text-center">
              <div className="text-xs text-muted-foreground">{isBorrow ? "You're borrowing" : "You're repaying"}</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{isBorrow ? 'into' : 'from'} {line.name}</div>
            </div>

            <div className="mt-5 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              {isBorrow ? (
                <>
                  <Row label="Deposited to your balance" value={fmt(amount)} />
                  <Row label="Flat fee (1%)" value={fmt(fee)} />
                  <Row label={`${line.name} balance after`} value={fmt(newLineUsed + fee)} strong border />
                </>
              ) : (
                <>
                  <Row label={`${line.name} owed`} value={fmt(line.used)} />
                  <Row label="Repaying" value={`– ${fmt(amount)}`} />
                  <Row label="Remaining" value={fmt(newLineUsed)} strong border />
                </>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-info/20 bg-info/5 p-3">
              <RefreshCw className="h-4 w-4 shrink-0 text-info" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {isBorrow
                  ? `No fixed due date. Balance back to $0 within your cycle (${cycleDaysLeft} days left) to keep full borrowing power.`
                  : 'Repaying within your cycle keeps your borrowing power at full strength.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep('status')}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              {isBorrow ? `Borrow ${fmt(amount)}` : `Repay ${fmt(amount)}`}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> {isBorrow ? `Backed by your ${fmt(baseLimit)} in savings` : 'Settled instantly'}
            </p>
          </div>
        )}

        {step === 'status' && line && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">{isBorrow ? 'Borrowing…' : 'Repaying…'}</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{isBorrow ? 'Money borrowed' : 'Repayment complete'}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {isBorrow ? (
                    <><span className="font-medium text-foreground">{fmt(amount)}</span> is in your balance, from {line.name}.</>
                  ) : (
                    <>{line.name} now owes <span className="font-medium text-foreground">{fmt(newLineUsed)}</span>{newLineUsed === 0 && ' — balanced 🎉'}.</>
                  )}
                </div>
                {isBorrow && (
                  <div className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-border bg-secondary/40 p-3 text-left">
                    <Sparkles className="h-4 w-4 shrink-0 text-info" />
                    <p className="text-[11px] text-muted-foreground">No fixed due date — repay any time within your {cycleDaysLeft}-day cycle to keep full power.</p>
                  </div>
                )}
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

function Row({ label, value, strong, border }: { label: string; value: string; strong?: boolean; border?: boolean }) {
  return (
    <div className={cn('flex justify-between', border && 'border-t border-border pt-1.5', strong && 'font-medium')}>
      <span className={strong ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
