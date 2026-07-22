import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, Check, ChevronDown, CreditCard, Landmark, Loader2, Smartphone, ShieldCheck, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { track } from '@/lib/analytics';
import DepositInstructions from '@/components/app-ui/DepositInstructions';
import { usePrivy } from '@privy-io/react-auth';
import { getRampBuyQuote, createRampBuySession, createRampBuyOrder, getRampConfig, getRampBuyStatus, rampEvent, type RampQuote } from '@/utils/apiClient';
import { useClearBalances } from '@/hooks/useClearBalances';
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
  // Coinbase's headless (in-app) API supports Apple Pay and Google Pay ONLY — card and ACH have no
  // embedded flow, so they necessarily open Coinbase's hosted page. Say which is which.
  { id: 'card', name: 'Debit or credit card', icon: CreditCard, speed: 'Instant · opens Coinbase' },
  { id: 'applepay', name: 'Apple Pay', icon: Smartphone, speed: 'Instant · stays in the app' },
  // Coinbase ACH is the cheap card alternative, but it's the one method that can't be a guest
  // checkout — Coinbase requires a signed-in account and it only runs in their hosted widget. Say so
  // up front rather than dumping the member on a login screen after they've committed to an amount.
  { id: 'ach', name: 'Bank via Coinbase', icon: Landmark, speed: 'Opens Coinbase · account required' },
  { id: 'bank', name: 'Direct deposit or bank push', icon: Building2, speed: 'Free · sent from your bank' },
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
// The backend maps these onto Coinbase's enum (applepay→APPLE_PAY, ach→ACH_BANK_ACCOUNT, else CARD).
const rampPM = (methodId: string) => (methodId === 'applepay' ? 'applepay' : methodId === 'ach' ? 'ach' : 'creditcard');

/*
 * Bank funding is a PUSH, not a pull. Bridge does not debit bank accounts — no ACH pull, no Plaid
 * debit ("not integrate with Plaid to initiate money movement, including pulling or debiting from
 * bank accounts") — so we cannot initiate a deposit for the member. Instead we hand them their
 * Bridge virtual account's numbers and they push from their own bank. Deposits are free on every
 * rail, and land in seconds when their bank sends instant (FedNow).
 *
 * That's why this path ends in deposit instructions rather than an amount + Confirm. The rail picker
 * that used to live here (ACH free / same-day $1.50 / wire $15) was invented pricing with no backend
 * behind it, describing a pull we can't perform.
 */

const QUICK = [50, 100, 250, 500];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AddMoneyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<'amount' | 'review' | 'status' | 'pay'>('amount');
  const [payUrl, setPayUrl] = useState<string | null>(null); // Coinbase Apple Pay iframe (headless)
  const [rampRef, setRampRef] = useState(''); // unique id per checkout attempt, for status notifications
  // Snapshot of an in-flight buy; set when checkout starts, cleared on completion. If the user backs out
  // before it completes, we fire a "Deposit canceled" notification from this.
  const pendingBuyRef = useRef<{ ref: string; amount: number; wallet: string } | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [methodId, setMethodId] = useState('card');
  const [walletId, setWalletId] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null); // null = auto-best
  const [advanced, setAdvanced] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [apiQuotes, setApiQuotes] = useState<QuoteVM[]>([]);
  const [quoteId, setQuoteId] = useState<string | undefined>(undefined); // locked-quote id for checkout
  const [rampConfigured, setRampConfigured] = useState<boolean | null>(null); // null = unknown yet
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const { wallets, primaryId, openManager } = useLinkedWallets();
  const { user, linkPhone } = usePrivy();
  // Same trap as the server-side email bug: `user.email` only exists for the EMAIL login type, so a
  // Google/Apple member had no email here and silently failed the headless check below.
  const buyerEmail = user?.email?.address || user?.google?.email || user?.apple?.email || '';
  const buyerPhone = user?.phone?.number || '';
  // Coinbase requires a developer-verified email AND phone for the in-app (headless) flow. Without a
  // phone we can't use it at all, which is why Apple Pay kept opening a new tab.
  const canPayInApp = Boolean(buyerEmail && buyerPhone);
  const bal = useClearBalances();

  // Card / Apple Pay: create an Onramper checkout + open the provider's hosted flow. (Bank never
  // reaches here — it's a push to the virtual account, with nothing for us to confirm.)
  const handleConfirm = async () => {
    if (!wallet.address || !selected.p.id) {
      setCheckoutError('Pick a linked wallet and provider first.');
      return;
    }
    setCheckoutError(null);
    setCheckoutLoading(true);
    const ref = crypto.randomUUID();
    setRampRef(ref);
    pendingBuyRef.current = { ref, amount, wallet: wallet.address };
    void rampEvent({ type: 'buy', status: 'submitted', amount, walletAddress: wallet.address, ref });
    // Apple Pay on Coinbase → headless order rendered in an in-app iframe (needs verified email + phone).
    if (methodId === 'applepay' && selected.p.id === 'coinbase' && canPayInApp) {
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

  // Explicit cancel (Apple Pay iframe cancel / back button) — definitive, so notify immediately.
  const cancelDeposit = () => {
    const p = pendingBuyRef.current;
    if (!p) return;
    pendingBuyRef.current = null;
    void rampEvent({ type: 'buy', status: 'canceled', amount: p.amount, walletAddress: p.wallet, ref: p.ref });
  };

  // Closing the modal is ambiguous (they may have paid on Coinbase's page and it's still processing), so
  // do one final status check first: SUCCESS → "Money added"; NO transaction at all → truly abandoned →
  // "canceled"; anything in-flight → leave it for the poll/webhook.
  const finalizePendingBuyOnClose = () => {
    const p = pendingBuyRef.current;
    if (!p) return;
    pendingBuyRef.current = null;
    void (async () => {
      const s = await getRampBuyStatus(p.wallet).catch(() => ({ status: null as string | null, id: undefined }));
      const st = String(s.status || '');
      if (/SUCCESS/i.test(st)) {
        void rampEvent({ type: 'buy', status: 'completed', amount: p.amount, walletAddress: p.wallet, ref: s.id || p.ref });
      } else if (!st) {
        void rampEvent({ type: 'buy', status: 'canceled', amount: p.amount, walletAddress: p.wallet, ref: p.ref });
      }
    })();
  };

  useEffect(() => {
    if (open) return;
    finalizePendingBuyOnClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmountStr('');
    setMethodId('card');
    setWalletId(primaryId);
    setProviderId(null);
    setAdvanced(false);
    setWalletOpen(false);
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
    if (!wallet.address) {
      const t = setTimeout(() => setDone(true), 1700);
      return () => clearTimeout(t);
    }
    // Card / Apple Pay: poll Coinbase until the deposit actually lands, then notify + refresh the balance.
    let cancelled = false;
    const deadline = Date.now() + 5 * 60_000;
    (async () => {
      while (!cancelled && Date.now() < deadline) {
        const s = await getRampBuyStatus(wallet.address).catch(() => ({ status: null as string | null, id: undefined }));
        if (cancelled) return;
        // Use Coinbase's tx id as the ref so this dedupes with the webhook's notification.
        const ref = s.id || rampRef || `${wallet.address}-buy`;
        if (s.status === 'TRANSACTION_STATUS_SUCCESS') {
          pendingBuyRef.current = null; // completed → don't fire a cancel on close
          void rampEvent({ type: 'buy', status: 'completed', amount, walletAddress: wallet.address, ref });
          bal.refresh(); // USDC has landed on-chain → pull the real balance
          setDone(true);
          track('deposit_completed', { method: methodId }); // no amounts/PII
          return;
        }
        if (s.status === 'TRANSACTION_STATUS_FAILED') {
          pendingBuyRef.current = null;
          void rampEvent({ type: 'buy', status: 'failed', amount, walletAddress: wallet.address, ref });
          setCheckoutError('Your deposit didn’t go through — you weren’t charged.');
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      // Timed out still pending — show "on its way"; the balance poll will pick it up when it lands.
      if (!cancelled) setDone(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const amount = Number(amountStr) || 0;
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0];
  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? { id: '', label: 'No wallet linked', address: '' };
  const amountValid = amount >= 5 && amount <= 10000;
  const isBank = methodId === 'bank';

  // Coinbase's headless onramp iframe posts `onramp_api.*` events ({ eventName, data }). Once the user
  // commits the payment we move to the status step, which polls Coinbase for the real on-chain completion
  // (and fires the "Money added" notification + balance refresh). Cancel/error return to review.
  useEffect(() => {
    if (step !== 'pay') return;
    const onMsg = (e: MessageEvent) => {
      const host = (() => { try { return new URL(e.origin).hostname; } catch { return ''; } })();
      if (!/\.coinbase\.com$/.test(host)) return;
      let eventName = '';
      try {
        const obj = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        eventName = String(obj?.eventName || obj?.event || '');
      } catch { /* non-JSON message — ignore */ }
      if (eventName === 'onramp_api.commit_success' || eventName === 'onramp_api.polling_success') {
        setStep('status');
      } else if (eventName === 'onramp_api.cancel') {
        cancelDeposit();
        setPayUrl(null);
        setStep('review');
      } else if (eventName === 'onramp_api.load_error') {
        // The iframe couldn't initialize (commonly: domain not yet verified with Coinbase) → fall back to
        // the hosted Coinbase checkout so the user isn't stuck on a blank Apple Pay sheet.
        setPayUrl(null);
        void (async () => {
          const { url } = await createRampBuySession({ amount, paymentMethod: rampPM(methodId), walletAddress: wallet.address, quoteId });
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
            setStep('status');
          } else {
            setCheckoutError('Couldn’t start checkout — try another amount or method.');
            setStep('review');
          }
        })();
      } else if (eventName === 'onramp_api.commit_error' || eventName === 'onramp_api.polling_error') {
        setPayUrl(null);
        setCheckoutError('Payment couldn’t be completed — try again or use another method.');
        setStep('review');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [step]);
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
  const fee = selected.fee;
  const payout = Math.max(0, amount - fee);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {step === 'amount' && (
          <div className="p-5">
            <div className="mb-5 text-base font-semibold text-foreground">Add money</div>

            {/* A bank push carries whatever the member chooses to send, so we only ask for an amount
                when we're actually charging them (card / Apple Pay). */}
            <div className={cn(isBank && 'hidden')}>
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
            </div>

            <label className={cn('mb-2 block text-xs font-medium text-muted-foreground', !isBank && 'mt-5')}>Pay with</label>
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

            {/* A bank deposit is something the MEMBER pushes — we can't debit for them — so this
                path ends here with their account numbers instead of an amount + Confirm.
                DepositInstructions shows a "verify to activate" CTA until the account exists. */}
            {isBank ? (
              <div className="mt-4">
                <DepositInstructions />
                <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Landmark className="mt-px h-3 w-3 shrink-0" />
                  Send from your bank to these details — we don't charge for bank deposits. Most arrive in
                  1–3 business days, or in seconds if your bank supports instant transfers (FedNow).
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!amountValid}
                  onClick={() => setStep('review')}
                  className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
                >
                  Review
                </button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">{amount > 10000 ? 'Max $10,000 per transaction' : 'Add $5–$10,000'}</p>
              </>
            )}
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
                <span className="tabular-nums text-foreground">{fee === 0 ? 'Free' : fmt(fee)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-foreground">Added to balance</span>
                <span className="tabular-nums text-foreground">{fmt(payout)}</span>
              </div>
            </div>

            {/* provider — auto best, advanced to change */}
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

            <button
              type="button"
              onClick={handleConfirm}
              disabled={checkoutLoading || quotesLoading || !selected.p.id || !wallet.address}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              {checkoutLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</> : `Add ${fmt(amount)}`}
            </button>
            {checkoutError && <p className="mt-2 text-center text-[11px] text-negative">{checkoutError}</p>}
            {/* Apple Pay is the only method Coinbase can embed, and it needs a verified phone. Offer to
                add one instead of silently bouncing them to a new tab and leaving them wondering. */}
            {methodId === 'applepay' && !canPayInApp && (
              <div className="mt-2 rounded-lg border border-border p-2.5">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Smartphone className="mt-px h-3 w-3 shrink-0" />
                  {buyerPhone
                    ? 'Add an email to your account to pay without leaving the app. Otherwise Apple Pay opens in a new tab.'
                    : 'Coinbase needs a verified phone number to keep Apple Pay inside the app. Without one it opens in a new tab.'}
                </p>
                {!buyerPhone && (
                  <button
                    type="button"
                    onClick={() => linkPhone()}
                    className="mt-2 w-full rounded-full border border-border py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    Add a phone number
                  </button>
                )}
              </div>
            )}
            {methodId === 'ach' && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-border p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <Landmark className="mt-px h-3 w-3 shrink-0" />
                Coinbase handles bank transfers and will ask you to sign in and link your bank — a Coinbase
                account is required. Bank deposits can take a few days to arrive. To skip the account, use
                a card, or send a free transfer from your bank instead.
              </p>
            )}
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />{' '}
              Held as USDC, a regulated digital dollar, on Base
            </p>
          </div>
        )}

        {step === 'pay' && payUrl && (
          <div className="flex flex-col px-4 pb-4 pt-2">
            <div className="mb-3 flex items-center gap-2 px-2">
              <button type="button" onClick={() => { cancelDeposit(); setStep('review'); }} className="text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-semibold text-foreground">Pay {fmt(amount)} with Apple Pay</div>
            </div>
            <iframe
              title="Coinbase Pay"
              src={payUrl}
              allow="payment"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
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
                <div className="mt-4 text-base font-semibold text-foreground">Connecting to secure checkout…</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {`Finishing your payment with ${selected.p.name}.`}
                </div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">You're all set</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(payout)}</span> is on its way to {wallet.label}. We'll let you know when it lands.
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
