import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CreditCard, Landmark, Loader2, Smartphone, ShieldCheck, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { cn } from '@/lib/utils';

/*
 * "Add money" — a fiat → USDC top-up framed like a neobank / Cash App deposit. Crypto is
 * abstracted away: the user adds dollars and they land in their balance; "USDC on Base" is a
 * footnote and the provider is auto-picked (best rate) with an Advanced override.
 *
 * SEAMS for Onramper headless wiring (https://docs.onramper.com):
 *   METHODS  ← GET /supported + /payment-types (by country + USD→USDC)
 *   buildQuotes() ← GET /quotes/usd/usdc_base?amount=&paymentMethod=&walletAddress=
 *   confirm() ← POST checkout-intent { wallet, quote } → redirect to the returned URL,
 *               then reconcile via webhook. Destination = the selected linked wallet on Base.
 */

interface PayMethod {
  id: string;
  name: string;
  icon: LucideIcon;
  speed: string;
}
const METHODS: PayMethod[] = [
  { id: 'card', name: 'Debit or credit card', icon: CreditCard, speed: 'Instant' },
  { id: 'applepay', name: 'Apple Pay', icon: Smartphone, speed: 'Instant' },
  { id: 'bank', name: 'Bank transfer', icon: Landmark, speed: '1–3 business days' },
];

interface Provider {
  id: string;
  name: string;
  feeRate: number;
  fixed: number;
}
// Mock aggregated providers; replace with the /quotes response array.
const PROVIDERS: Provider[] = [
  { id: 'stripe', name: 'Stripe', feeRate: 0.029, fixed: 0.3 },
  { id: 'coinbase', name: 'Coinbase Pay', feeRate: 0.034, fixed: 0 },
  { id: 'transak', name: 'Transak', feeRate: 0.039, fixed: 0 },
  { id: 'moonpay', name: 'MoonPay', feeRate: 0.045, fixed: 0 },
];

const QUICK = [50, 100, 250, 500];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildQuotes(amount: number) {
  return PROVIDERS.map((p) => {
    const fee = amount > 0 ? amount * p.feeRate + p.fixed : 0;
    return { p, fee, payout: Math.max(0, amount - fee) };
  }).sort((a, b) => b.payout - a.payout);
}

export default function AddMoneyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<'amount' | 'review' | 'status'>('amount');
  const [amountStr, setAmountStr] = useState('');
  const [methodId, setMethodId] = useState('card');
  const [walletId, setWalletId] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null); // null = auto-best
  const [advanced, setAdvanced] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [done, setDone] = useState(false);
  const { wallets, primaryId, openManager } = useLinkedWallets();

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmountStr('');
    setMethodId('card');
    setWalletId(primaryId);
    setProviderId(null);
    setAdvanced(false);
    setWalletOpen(false);
  }, [open]);

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    const t = setTimeout(() => setDone(true), 1700);
    return () => clearTimeout(t);
  }, [step]);

  const amount = Number(amountStr) || 0;
  const quotes = useMemo(() => buildQuotes(amount), [amount]);
  const best = quotes[0];
  const selected = (providerId ? quotes.find((q) => q.p.id === providerId) : null) ?? best;
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0];
  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? { id: '', label: 'No wallet linked', address: '' };
  const amountValid = amount >= 10 && amount <= 10000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
        {step === 'amount' && (
          <div className="p-5">
            <div className="mb-5 text-base font-semibold text-foreground">Add money</div>

            <label className="mb-2 block text-xs font-medium text-muted-foreground">Amount</label>
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
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmountStr(String(q))}
                  className={cn(
                    'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors',
                    amount === q ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  ${q}
                </button>
              ))}
            </div>

            <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Pay with</label>
            <div className="space-y-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethodId(m.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-foreground bg-secondary/50' : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">{m.speed}</span>
                    </span>
                    <span className={cn('h-4 w-4 shrink-0 rounded-full border-2', active ? 'border-foreground bg-foreground' : 'border-border')}>
                      {active && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={!amountValid}
              onClick={() => setStep('review')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Review
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{amount > 10000 ? 'Max $10,000 per transaction' : 'Add $10–$10,000'}</p>
          </div>
        )}

        {step === 'review' && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setStep('amount')} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Review</span>
            </div>

            <div className="text-center">
              <div className="text-xs text-muted-foreground">You're adding</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
            </div>

            {/* deposit-to (linked wallets) + method */}
            <div className="mt-5 space-y-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setWalletOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] text-muted-foreground">Add to</span>
                    <span className="block truncate text-sm font-medium text-foreground">{wallet.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{wallet.address}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', walletOpen && 'rotate-180')} />
                  </span>
                </button>
                {walletOpen && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
                    {wallets.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          setWalletId(w.id);
                          setWalletOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{w.label}</span>
                          <span className="block text-xs text-muted-foreground">{w.address}</span>
                        </span>
                        {w.id === walletId && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setWalletOpen(false);
                        openManager();
                      }}
                      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Wallet className="h-3.5 w-3.5" /> Manage wallets
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStep('amount')}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
              >
                <span>
                  <span className="block text-[11px] text-muted-foreground">Pay with</span>
                  <span className="block text-sm font-medium text-foreground">{method.name}</span>
                </span>
                <span className="text-xs text-muted-foreground">Change</span>
              </button>
            </div>

            {/* cost breakdown */}
            <div className="mt-4 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="tabular-nums text-foreground">{fmt(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span className="tabular-nums text-foreground">{fmt(selected.fee)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-foreground">Added to balance</span>
                <span className="tabular-nums text-foreground">{fmt(selected.payout)}</span>
              </div>
            </div>

            {/* provider — auto best, advanced to change */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setAdvanced((a) => !a)}
                className="flex w-full items-center justify-between text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Best rate · via {selected.p.name}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  {advanced ? 'Hide' : 'Change'} <ChevronDown className={cn('h-3 w-3 transition-transform', advanced && 'rotate-180')} />
                </span>
              </button>
              {advanced && (
                <div className="mt-2 space-y-1">
                  {quotes.map((q, i) => {
                    const active = selected.p.id === q.p.id;
                    return (
                      <button
                        key={q.p.id}
                        type="button"
                        onClick={() => setProviderId(q.p.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                          active ? 'border-foreground bg-secondary/50' : 'border-border hover:bg-secondary/40',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{q.p.name}</span>
                          {i === 0 && <span className="rounded bg-positive/10 px-1 py-0.5 text-[9px] font-medium text-positive">Best</span>}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {fmt(q.payout)} <span className="text-[10px]">· {fmt(q.fee)} fee</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setStep('status')}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Add {fmt(amount)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Held as USDC, a regulated digital dollar, on Base
            </p>
          </div>
        )}

        {step === 'status' && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">Connecting to secure checkout…</div>
                <div className="mt-1 text-sm text-muted-foreground">Finishing your payment with {selected.p.name}.</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">You're all set</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(selected.payout)}</span> is on its way to {wallet.label}. We'll let you know when it lands.
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
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
