import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Landmark, Loader2, ShieldCheck, Sparkles, TriangleAlert, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useKyc } from '@/context/KycContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useAccount } from 'wagmi';
import { withdrawToBank } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

/*
 * "Withdraw" — a USDC → fiat off-ramp framed like a neobank cash-out. Mirrors AddMoneyModal:
 * the user moves dollars from a linked wallet to a bank/debit; crypto stays hidden.
 *
 * SEAMS (Onramper sell OR Bridge.xyz; build is provider-agnostic):
 *   METHODS/BANKS ← payout rails (ACH/wire/instant-debit); BANKS would be Plaid-linked.
 *   buildQuotes() ← off-ramp /quotes (USDC_base → usd) by amount + payout method.
 *   confirm() ← create a payout/redemption (Bridge transfer or Onramper sell intent) that
 *               debits the selected linked wallet's USDC on Base and pays out fiat; webhook.
 */

interface PayoutMethod {
  id: string;
  name: string;
  icon: LucideIcon;
  speed: string;
  instantFeeRate: number;
  soon?: boolean;
}
// `bank`/`bank_sd` settle to a bank via the Bridge off-ramp (ACH) → need KYC.
// `instant` (debit card) needs a card-payout partner we don't have yet → shown as coming soon.
const METHODS: PayoutMethod[] = [
  { id: 'bank', name: 'Bank account', icon: Landmark, speed: '1–3 business days', instantFeeRate: 0 },
  { id: 'bank_sd', name: 'Same-day to bank', icon: Zap, speed: 'Today by 6pm ET', instantFeeRate: 0.005 },
  { id: 'instant', name: 'Instant to debit card', icon: Zap, speed: 'Coming soon', instantFeeRate: 0.015, soon: true },
];
const BANK_METHODS = new Set(['bank', 'bank_sd']);

interface Provider {
  id: string;
  name: string;
  feeRate: number;
  fixed: number;
}
const PROVIDERS: Provider[] = [
  { id: 'bridge', name: 'Bridge', feeRate: 0.005, fixed: 0 },
  { id: 'coinbase', name: 'Coinbase Pay', feeRate: 0.01, fixed: 0 },
  { id: 'moonpay', name: 'MoonPay', feeRate: 0.02, fixed: 0 },
];

const QUICK = [50, 100, 250, 500];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildQuotes(amount: number, instantFeeRate: number) {
  return PROVIDERS.map((p) => {
    const fee = amount > 0 ? amount * (p.feeRate + instantFeeRate) + p.fixed : 0;
    return { p, fee, payout: Math.max(0, amount - fee) };
  }).sort((a, b) => b.payout - a.payout);
}

export default function WithdrawModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<'amount' | 'review' | 'status'>('amount');
  const [amountStr, setAmountStr] = useState('');
  const [methodId, setMethodId] = useState('bank');
  const [walletId, setWalletId] = useState('');
  const [bankId, setBankId] = useState('b1');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { wallets, primaryId, openManager } = useLinkedWallets();
  const { accounts, openManager: openAccounts } = useExternalAccounts();
  const banks = accounts.map((a) => ({ id: a.id, label: `${a.name} ••${a.mask}` }));
  const { verified, openKyc } = useKyc();
  const { email } = useMemberProfile();
  const { address } = useAccount();
  const bal = useClearBalances();
  const proceed = () => {
    if (BANK_METHODS.has(methodId) && !verified) openKyc(() => setStep('status'));
    else setStep('status');
  };

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmountStr('');
    setMethodId('bank');
    setWalletId(primaryId);
    setBankId(accounts[0]?.id ?? '');
    setProviderId(null);
    setAdvanced(false);
    setWalletOpen(false);
    setBankOpen(false);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        if (!address) throw new Error('Connect your wallet to withdraw.');
        if (!bankId) throw new Error('Link a bank account to withdraw to.');
        const res = await withdrawToBank(address, { amount, plaidAccountId: bankId, email: email ?? undefined });
        if (cancelled) return;
        if (!res.success) throw new Error(res.message || 'Withdrawal failed.');
        setDone(true);
        // Optimistic: USDC leaves Cash now; reconciles when the off-ramp debit indexes.
        bal.applyOptimistic(-amount, 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Withdrawal failed.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const amount = Number(amountStr) || 0;
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0];
  const quotes = useMemo(() => buildQuotes(amount, method.instantFeeRate), [amount, method.instantFeeRate]);
  const best = quotes[0];
  const selected = (providerId ? quotes.find((q) => q.p.id === providerId) : null) ?? best;
  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? { id: '', label: 'No wallet linked', address: '' };
  const bank = banks.find((b) => b.id === bankId) ?? banks[0] ?? { id: '', label: 'No bank linked' };
  const amountValid = amount >= 10 && amount <= 10000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {step === 'amount' && (
          <div className="p-5">
            <div className="mb-5 text-base font-semibold text-foreground">Withdraw</div>

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

            <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Withdraw to</label>
            <div className="space-y-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.soon}
                    onClick={() => !m.soon && setMethodId(m.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      m.soon
                        ? 'cursor-not-allowed border-border opacity-50'
                        : active
                          ? 'border-foreground bg-secondary/50'
                          : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">{m.speed}{!m.soon && (m.instantFeeRate > 0 ? ` · ${(m.instantFeeRate * 100).toFixed(1)}% fee` : ' · Free')}</span>
                    </span>
                    <span className={cn('h-4 w-4 shrink-0 rounded-full border-2', active && !m.soon ? 'border-foreground bg-foreground' : 'border-border')}>
                      {active && !m.soon && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>

            {banks.length === 0 ? (
              <button
                type="button"
                onClick={openAccounts}
                className="mt-5 w-full rounded-xl border border-border py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                Link a bank to withdraw
              </button>
            ) : (
              <button
                type="button"
                disabled={!amountValid}
                onClick={() => setStep('review')}
                className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
              >
                Review
              </button>
            )}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{amount > 10000 ? 'Max $10,000 per transaction' : 'Withdraw $10–$10,000'}</p>
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
              <div className="text-xs text-muted-foreground">You're withdrawing</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
            </div>

            <div className="mt-5 space-y-2">
              {/* from — linked wallet */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setWalletOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] text-muted-foreground">From</span>
                    <span className="block truncate text-sm font-medium text-foreground">{wallet.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{wallet.address}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', walletOpen && 'rotate-180')} />
                  </span>
                </button>
                {walletOpen && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
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

              {/* to — bank */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBankOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] text-muted-foreground">To</span>
                    <span className="block truncate text-sm font-medium text-foreground">{bank.label}</span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', bankOpen && 'rotate-180')} />
                </button>
                {bankOpen && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
                    {banks.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setBankId(b.id);
                          setBankOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                      >
                        <span className="font-medium text-foreground">{b.label}</span>
                        {b.id === bankId && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setBankOpen(false);
                        openAccounts();
                      }}
                      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Landmark className="h-3.5 w-3.5" /> Manage accounts
                    </button>
                  </div>
                )}
              </div>
            </div>

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
                <span className="text-foreground">Lands in your bank</span>
                <span className="tabular-nums text-foreground">{fmt(selected.payout)}</span>
              </div>
            </div>

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
              onClick={proceed}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Withdraw {fmt(amount)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Your USDC balance on Base is converted to dollars
            </p>
          </div>
        )}

        {step === 'status' && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {error ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                  <TriangleAlert className="h-7 w-7 text-destructive" />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">Withdrawal not completed</div>
                <div className="mt-1 text-sm text-muted-foreground">{error}</div>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Back
                </button>
              </>
            ) : !done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">Sending your withdrawal…</div>
                <div className="mt-1 text-sm text-muted-foreground">Processing with {selected.p.name}.</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">On its way</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(selected.payout)}</span> is heading to {bank.label} · {method.speed.toLowerCase()}.
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
