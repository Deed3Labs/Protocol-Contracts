import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CreditCard, Landmark, Loader2, Smartphone, ShieldCheck, Sparkles, Wallet, Zap, Send, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useBridge } from '@/context/BridgeContext';
import { useKyc } from '@/context/KycContext';
import DepositInstructions from '@/components/app-ui/DepositInstructions';
import { usePrivy } from '@privy-io/react-auth';
import { getRampBuyQuote, createRampBuySession, createRampBuyOrder, getRampConfig, rampEvent, type RampQuote } from '@/utils/apiClient';
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

/** A normalized quote for the UI: provider + USDC payout + total fee vs the entered amount. */
interface QuoteVM {
  p: { id: string; name: string };
  fee: number;
  payout: number;
}
const prettyRamp = (id: string) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Provider');
// Normalize the unified ramp quote → the UI shape (USDC ≈ $1). The provider (Coinbase / Onramper) is
// picked server-side, so there's one best quote; `fee` is the summed provider + network fee.
function toQuoteVM(q: RampQuote, amount: number): QuoteVM {
  const fees = (q.coinbaseFee ?? 0) + (q.networkFee ?? 0);
  const fee = fees > 0 ? fees : Math.max(0, amount - (q.cryptoAmount ?? amount));
  return { p: { id: q.provider, name: prettyRamp(q.provider) }, fee, payout: Math.max(0, amount - fee) };
}
const rampPM = (methodId: string) => (methodId === 'applepay' ? 'applepay' : 'creditcard');

/*
 * Bank funding rails. A bank deposit pulls fiat from a Plaid-linked account through the user's
 * Bridge USD virtual account (which auto-converts to USDC). Fees are illustrative.
 * SEAM: rails + fees come from Bridge; the source account is a Plaid-linked external account.
 */
const RAILS = [
  { id: 'ach', name: 'ACH', speed: '1–3 business days', fee: 0, icon: Landmark },
  { id: 'ach_sd', name: 'Same-day ACH', speed: 'Today by 6pm ET', fee: 1.5, icon: Zap },
  { id: 'wire', name: 'Wire', speed: 'Within hours', fee: 15, icon: Send },
] as const;

const QUICK = [50, 100, 250, 500];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AddMoneyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<'amount' | 'review' | 'status' | 'pay'>('amount');
  const [payUrl, setPayUrl] = useState<string | null>(null); // Coinbase Apple Pay iframe (headless)
  const [rampRef, setRampRef] = useState(''); // unique id per checkout attempt, for status notifications
  const [amountStr, setAmountStr] = useState('');
  const [methodId, setMethodId] = useState('card');
  const [walletId, setWalletId] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null); // null = auto-best
  const [advanced, setAdvanced] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [railId, setRailId] = useState<string>('ach');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [apiQuotes, setApiQuotes] = useState<QuoteVM[]>([]);
  const [quoteId, setQuoteId] = useState<string | undefined>(undefined); // locked-quote id for checkout
  const [rampConfigured, setRampConfigured] = useState<boolean | null>(null); // null = unknown yet
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const { wallets, primaryId, openManager } = useLinkedWallets();
  const { accounts: banks, openManager: openBankManager } = useExternalAccounts();
  const { virtualAccount } = useBridge();
  const { verified, openKyc } = useKyc();
  const { user } = usePrivy();
  const buyerEmail = user?.email?.address || '';
  const buyerPhone = user?.phone?.number || '';
  // Card / Apple Pay on-ramps KYC at the provider; a bank/ACH deposit needs our KYC.
  const proceed = () => {
    if (methodId === 'bank' && !verified) openKyc(() => setStep('status'));
    else setStep('status');
  };

  // Card / Apple Pay: create an Onramper checkout + open the provider's hosted flow. Bank = Bridge.
  const handleConfirm = async () => {
    if (isBank) {
      proceed();
      return;
    }
    if (!wallet.address || !selected.p.id) {
      setCheckoutError('Pick a linked wallet and provider first.');
      return;
    }
    setCheckoutError(null);
    setCheckoutLoading(true);
    const ref = crypto.randomUUID();
    setRampRef(ref);
    void rampEvent({ type: 'buy', status: 'submitted', amount, walletAddress: wallet.address, ref });
    // Apple Pay on Coinbase → headless order rendered in an in-app iframe (needs verified email + phone).
    if (methodId === 'applepay' && selected.p.id === 'coinbase' && buyerEmail && buyerPhone) {
      const { paymentLinkUrl } = await createRampBuyOrder({ amount, walletAddress: wallet.address, email: buyerEmail, phone: buyerPhone });
      if (paymentLinkUrl) {
        setPayUrl(paymentLinkUrl);
        setStep('pay');
        setCheckoutLoading(false);
        return;
      }
      // else fall through to the hosted checkout below
    }
    // Card (or Apple Pay fallback): open the hosted Coinbase / provider checkout in a new tab.
    const { url } = await createRampBuySession({
      amount,
      paymentMethod: rampPM(methodId),
      walletAddress: wallet.address,
      quoteId,
    });
    setCheckoutLoading(false);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      setStep('status');
    } else {
      setCheckoutError('Could not start checkout — try another amount or method.');
    }
  };

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmountStr('');
    setMethodId('card');
    setWalletId(primaryId);
    setProviderId(null);
    setAdvanced(false);
    setWalletOpen(false);
    setSourceId(banks[0]?.id ?? '');
    setRailId('ach');
    setSourceOpen(false);
    setDepositOpen(false);
    setApiQuotes([]);
    setQuoteId(undefined);
    setPayUrl(null);
    setCheckoutError(null);
    setCheckoutLoading(false);
  }, [open]);

  // Whether the ramp provider is actually configured — lets us explain an empty quote (setup pending
  // vs no coverage) instead of a vague "no providers".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getRampConfig().then((c) => { if (!cancelled) setRampConfigured(c.configured); }).catch(() => { if (!cancelled) setRampConfigured(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    const t = setTimeout(() => setDone(true), 1700);
    return () => clearTimeout(t);
  }, [step]);

  const amount = Number(amountStr) || 0;
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0];
  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? { id: '', label: 'No wallet linked', address: '' };
  const amountValid = amount >= 1 && amount <= 10000;
  const isBank = methodId === 'bank';

  // Coinbase's Apple Pay iframe posts transaction-status events; treat a success/completion as done.
  useEffect(() => {
    if (step !== 'pay') return;
    const onMsg = (e: MessageEvent) => {
      if (!/\.coinbase\.com$/.test((() => { try { return new URL(e.origin).hostname; } catch { return ''; } })())) return;
      const d = e.data;
      const s = typeof d === 'string' ? d : JSON.stringify(d ?? '');
      if (/success|completed|complete|finished|TRANSACTION_STATUS_SUCCESS/i.test(s)) {
        if (rampRef && wallet.address) void rampEvent({ type: 'buy', status: 'completed', amount, walletAddress: wallet.address, ref: rampRef });
        setStep('status');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [step, rampRef, amount, wallet.address]);
  const quotes = isBank ? [] : apiQuotes;
  const best = quotes[0];
  const selected =
    (providerId ? quotes.find((q) => q.p.id === providerId) : null) ??
    best ?? { p: { id: '', name: '—' }, fee: 0, payout: amount };

  // Live ramp quote for card / Apple Pay (debounced); bank uses the Bridge rail instead.
  useEffect(() => {
    if (!open || isBank || !amountValid) {
      setApiQuotes([]);
      setQuoteId(undefined);
      return;
    }
    let cancelled = false;
    setQuotesLoading(true);
    const t = setTimeout(async () => {
      const q = await getRampBuyQuote({ amount, paymentMethod: rampPM(methodId), walletAddress: wallet.address || undefined });
      if (cancelled) return;
      setApiQuotes(q ? [toQuoteVM(q, amount)] : []);
      setQuoteId(q?.quoteId);
      setQuotesLoading(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, isBank, amountValid, amount, methodId, wallet.address]);
  const rail = RAILS.find((r) => r.id === railId) ?? RAILS[0];
  const source = banks.find((b) => b.id === sourceId) ?? banks[0];
  // Bridge: wire is ACH-only for Chase & Bank of America.
  const wireBlocked = !!source && /chase|bank of america|bofa/i.test(source.name);
  const fee = isBank ? rail.fee : selected.fee;
  const payout = Math.max(0, amount - fee);

  useEffect(() => {
    if (wireBlocked && railId === 'wire') setRailId('ach');
  }, [wireBlocked, railId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
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

            {/* Direct deposit needs a provisioned Bridge virtual account — only surface it then. */}
            {isBank && virtualAccount.status === 'active' && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setDepositOpen((o) => !o)}
                  className="flex w-full items-center justify-between text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-1">
                    <Landmark className="h-3 w-3" /> Receive a direct deposit or push from your bank
                  </span>
                  <ChevronDown className={cn('h-3 w-3 transition-transform', depositOpen && 'rotate-180')} />
                </button>
                {depositOpen && (
                  <div className="mt-2">
                    <DepositInstructions />
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!amountValid}
              onClick={() => setStep('review')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Review
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{amount > 10000 ? 'Max $10,000 per transaction' : 'Add $1–$10,000'}</p>
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

              {isBank ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSourceOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] text-muted-foreground">From</span>
                      <span className="block truncate text-sm font-medium text-foreground">{source ? `${source.name} ••${source.mask}` : 'Link a bank'}</span>
                    </span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', sourceOpen && 'rotate-180')} />
                  </button>
                  {sourceOpen && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
                      {banks.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setSourceId(b.id);
                            setSourceOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                        >
                          <span className="truncate font-medium text-foreground">
                            {b.name} <span className="text-muted-foreground">••{b.mask}</span>
                          </span>
                          {b.id === source?.id && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setSourceOpen(false);
                          openBankManager();
                        }}
                        className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Landmark className="h-3.5 w-3.5" /> Manage banks
                      </button>
                    </div>
                  )}
                </div>
              ) : (
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
              )}
            </div>

            {isBank && (
              <div className="mt-2 space-y-1.5">
                {RAILS.map((r) => {
                  const RIcon = r.icon;
                  const active = railId === r.id;
                  const disabled = r.id === 'wire' && wireBlocked;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setRailId(r.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed border-border opacity-50'
                          : active
                            ? 'border-foreground bg-secondary/50'
                            : 'border-border hover:bg-secondary/40',
                      )}
                    >
                      <RIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{r.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{disabled ? `Not available for ${source?.name}` : r.speed}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.fee === 0 ? 'Free' : fmt(r.fee)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* cost breakdown */}
            <div className="mt-4 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="tabular-nums text-foreground">{fmt(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{isBank ? `Fee · ${rail.name}` : 'Fee'}</span>
                <span className="tabular-nums text-foreground">{fee === 0 ? 'Free' : fmt(fee)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-foreground">Added to balance</span>
                <span className="tabular-nums text-foreground">{fmt(payout)}</span>
              </div>
            </div>

            {/* provider — auto best, advanced to change (card / Apple Pay only) */}
            {!isBank && (
            <div className="mt-3">
              {quotesLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Finding the best rate…
                </div>
              ) : quotes.length === 0 ? (
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
                  {rampConfigured === false
                    ? 'Card & Apple Pay top-ups are being set up — use a bank transfer for now.'
                    : 'No quote available for this amount right now — try a different amount or method.'}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={checkoutLoading || (!isBank && (quotesLoading || !selected.p.id || !wallet.address))}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              {checkoutLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</> : `Add ${fmt(amount)}`}
            </button>
            {checkoutError && <p className="mt-2 text-center text-[11px] text-negative">{checkoutError}</p>}
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />{' '}
              {isBank
                ? `Via your Clear USD account${virtualAccount.bankName ? ` (${virtualAccount.bankName})` : ''} · held as USDC on Base`
                : 'Held as USDC, a regulated digital dollar, on Base'}
            </p>
          </div>
        )}

        {step === 'pay' && payUrl && (
          <div className="flex flex-col px-4 pb-4 pt-2">
            <div className="mb-3 flex items-center gap-2 px-2">
              <button type="button" onClick={() => setStep('review')} className="text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-semibold text-foreground">Pay {fmt(amount)} with Apple Pay</div>
            </div>
            <iframe
              title="Coinbase Pay"
              src={payUrl}
              allow="payment"
              className="h-[420px] w-full rounded-xl border border-border bg-background"
            />
            <button
              type="button"
              onClick={() => setStep('status')}
              className="mt-3 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              I've completed payment
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Secured by Coinbase · held as USDC on Base
            </p>
          </div>
        )}

        {step === 'status' && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">{isBank ? 'Submitting your transfer…' : 'Connecting to secure checkout…'}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {isBank ? `Initiating a ${rail.name} transfer from ${source?.name ?? 'your bank'}.` : `Finishing your payment with ${selected.p.name}.`}
                </div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">You're all set</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(payout)}</span> is on its way to {wallet.label}
                  {isBank ? ` via ${rail.name}` : ''}. We'll let you know when it lands.
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
