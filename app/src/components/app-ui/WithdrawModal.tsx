import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Clock, Landmark, Loader2, ShieldCheck, Sparkles, TriangleAlert, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useKyc } from '@/context/KycContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useWallets } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { createWalletClient, custom } from 'viem';
import { useAppKitAccount } from '@/lib/walletCompat';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { gaslessWalletTransfer } from '@/lib/gaslessMoney';
import { track } from '@/lib/analytics';
import { scTransferToken } from '@/lib/sendCalls';
import { getSameDayCutoff, formatCountdown } from '@/lib/achCutoff';
import { withdrawToBank, createRampSellSession, getRampSellStatus, rampEvent, type RampSellStatus, type Eip712TypedData } from '@/utils/apiClient';
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
// `bank`/`bank_sd` settle to a bank via the Bridge off-ramp → need in-app KYC.
// `instant` (debit card) goes through Onramper's sell flow → Onramper handles KYC + payout.
// Bridge has no instant fiat PAYOUT rail (FedNow is inbound only), so same-day ACH is the fast tier —
// it carries our 1% developer fee, while standard ACH stays free.
const METHODS: PayoutMethod[] = [
  { id: 'bank', name: 'Bank account', icon: Landmark, speed: '1–3 business days', instantFeeRate: 0 },
  { id: 'bank_sd', name: 'Same-day to bank', icon: Zap, speed: 'Today by 6pm ET', instantFeeRate: 0.01 },
  { id: 'instant', name: 'Instant to debit card', icon: Zap, speed: 'Arrives in minutes', instantFeeRate: 0.015 },
];
const BANK_METHODS = new Set(['bank', 'bank_sd']);
/** Which Bridge payout rail each bank method maps to. */
const BANK_RAIL: Record<string, 'ach' | 'ach_same_day'> = { bank: 'ach', bank_sd: 'ach_same_day' };

interface Provider {
  id: string;
  name: string;
  feeRate: number;
  fixed: number;
}
// Instant-to-debit is a card rail routed through Coinbase. (Bridge = ACH/bank only; MoonPay was never
// integrated — both were placeholder scaffolding.)
const PROVIDERS: Provider[] = [
  { id: 'coinbase', name: 'Coinbase Pay', feeRate: 0.01, fixed: 0 },
];

const QUICK = [50, 100, 250, 500];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildQuotes(amount: number, instantFeeRate: number) {
  return PROVIDERS.map((p) => {
    const fee = amount > 0 ? amount * (p.feeRate + instantFeeRate) + p.fixed : 0;
    return { p, fee, payout: Math.max(0, amount - fee) };
  }).sort((a, b) => b.payout - a.payout);
}

/**
 * Poll the off-ramp status until Coinbase returns the send instruction (STARTED, with the address +
 * amount of USDC to send). Gives the user ~5 min to finish the Coinbase cash-out form. Returns null on
 * timeout / failure / cancel.
 */
async function pollForOfframpSend(ref: string, isCancelled: () => boolean): Promise<{ toAddress: string; amount: string } | null> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (isCancelled()) return null;
    const s: RampSellStatus = await getRampSellStatus(ref).catch(() => ({ status: null }));
    if (s.status === 'TRANSACTION_STATUS_STARTED' && s.toAddress && s.amount) return { toAddress: s.toAddress, amount: s.amount };
    if (s.status === 'TRANSACTION_STATUS_FAILED') return null;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
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
  const [offrampStage, setOfframpStage] = useState<'idle' | 'waiting' | 'sending'>('idle');
  // Re-evaluated every second while the same-day option is on screen so the countdown ticks and the
  // promise flips to "next business day" the moment the cutoff passes mid-session.
  const [cutoff, setCutoff] = useState(() => getSameDayCutoff());
  // Set while an off-ramp is awaiting the user's Coinbase confirmation; if they back out first, fire a
  // "Cash-out canceled" notification from this.
  const pendingSellRef = useRef<{ amount: number; wallet: string } | null>(null);
  // Source can be the Clear account OR a linked wallet. Withdrawing from a linked wallet first moves its
  // USDC into the smart wallet (gasless, EIP-3009), then Bridge off-ramps the smart wallet (below).
  const { wallets, primaryId, openManager } = useLinkedWallets();
  const { wallets: connectedWallets } = useWallets();
  const { accounts, openManager: openAccounts } = useExternalAccounts();
  const banks = accounts.map((a) => ({ id: a.id, label: `${a.name} ••${a.mask}` }));
  const { verified, openKyc } = useKyc();
  const { address, embeddedWalletInfo } = useAppKitAccount();
  const { getClientForChain } = useSmartWallets();
  const bal = useClearBalances();

  // Fire a "Cash-out canceled" notification if the user backs out of an off-ramp before confirming it.
  const cancelWithdraw = () => {
    const p = pendingSellRef.current;
    if (!p) return;
    pendingSellRef.current = null;
    void rampEvent({ type: 'sell', status: 'canceled', amount: p.amount, walletAddress: p.wallet, ref: crypto.randomUUID() });
  };

  // Closing the modal mid-cash-out (before the Coinbase confirmation) → notify it was canceled.
  useEffect(() => {
    if (open) return;
    cancelWithdraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Sign an EIP-3009 authorization with a SPECIFIC linked wallet's own provider (for move-then-withdraw).
  const signWithLinkedWallet = async (fromAddr: string, typedData: Eip712TypedData): Promise<string> => {
    const w = connectedWallets.find((x) => x.address.toLowerCase() === fromAddr.toLowerCase());
    if (!w) throw new Error('Open and reconnect that wallet in your browser to withdraw from it.');
    const provider = await w.getEthereumProvider();
    const walletClient = createWalletClient({ account: fromAddr as `0x${string}`, transport: custom(provider as Parameters<typeof custom>[0]) });
    return walletClient.signTypedData({
      account: fromAddr as `0x${string}`,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    } as Parameters<typeof walletClient.signTypedData>[0]);
  };
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
    if (!open) return;
    setCutoff(getSameDayCutoff());
    const t = setInterval(() => setCutoff(getSameDayCutoff()), 1000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    setOfframpStage('idle');
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        if (!address) throw new Error('Connect your wallet to withdraw.');

        // Withdrawing FROM a linked wallet? First move its USDC into the Clear smart wallet (gasless,
        // EIP-3009 — the linked wallet signs, relayer pays), then off-ramp from the smart wallet below.
        const sourceWallet = wallets.find((w) => w.id === walletId);
        if (sourceWallet?.external && sourceWallet.address) {
          await gaslessWalletTransfer({
            fromWallet: sourceWallet.address,
            amount: amountStr,
            chainId: ACTIVE_CHAIN_ID,
            signTypedData: (td) => signWithLinkedWallet(sourceWallet.address as string, td),
          });
          if (cancelled) return;
        }

        if (methodId === 'instant') {
          // Instant-to-debit → off-ramp. Open the provider's hosted cash-out; the user picks their
          // debit-card payout there. On Coinbase we then poll for the send instruction and auto-send the
          // USDC from the smart wallet to Coinbase's address (Onramper is a pure redirect — nothing to send).
          const { url, partnerUserRef } = await createRampSellSession({ walletAddress: address });
          if (cancelled) return;
          if (!url) throw new Error('Could not start the instant cash-out.');
          window.open(url, '_blank', 'noopener,noreferrer');
          if (!partnerUserRef) {
            setDone(true);
            return;
          }
          // Wait for the user to confirm in Coinbase, then send the exact USDC they cashed out. Track it
          // as pending so backing out before confirming fires a "Cash-out canceled" notification.
          setOfframpStage('waiting');
          pendingSellRef.current = { amount, wallet: address };
          const started = await pollForOfframpSend(partnerUserRef, () => cancelled);
          if (cancelled) return;
          if (!started) {
            cancelWithdraw();
            throw new Error('Timed out waiting for your Coinbase cash-out. Reopen Withdraw to try again.');
          }
          pendingSellRef.current = null; // confirmed → send it (not a cancel)
          setOfframpStage('sending');
          const c = clearContracts(ACTIVE_CHAIN_ID);
          if (!c) throw new Error('Instant cash-out is unavailable on this network.');
          const isSmartAccount = embeddedWalletInfo?.accountType === 'smartAccount';
          const chainClient = isSmartAccount ? await getClientForChain({ id: ACTIVE_CHAIN_ID }) : undefined;
          await scTransferToken({
            smartWalletClient: chainClient,
            ownerWallet: address,
            token: c.usdc,
            to: started.toAddress as `0x${string}`,
            amount: started.amount,
            chainId: ACTIVE_CHAIN_ID,
          });
          if (cancelled) return;
          void rampEvent({ type: 'sell', status: 'submitted', amount: Number(started.amount), walletAddress: address, ref: crypto.randomUUID() });
          setDone(true);
          track('withdraw_completed', { method: 'instant' }); // no amounts/PII
          if (!sourceWallet?.external) bal.applyOptimistic(-Number(started.amount), 0);
          return;
        }

        // Bank / same-day → Bridge ACH off-ramp. Bridge does NOT pull from a self-custody wallet: it
        // returns a deposit address and waits. So creating the transfer is only half the job — we then
        // send the USDC ourselves, exactly like the Coinbase instant path above. Skipping this leaves
        // the transfer parked in `awaiting_funds` forever while the UI claims success.
        if (!bankId) throw new Error('Link a bank account to withdraw to.');
        const res = await withdrawToBank(address, { amount, plaidAccountId: bankId, rail: BANK_RAIL[methodId] ?? 'ach' });
        if (cancelled) return;
        if (!res.success) throw new Error(res.message || 'Withdrawal failed.');
        if (!res.depositAddress) throw new Error('Withdrawal could not be funded — nothing was sent. Try again.');

        setOfframpStage('sending');
        const bc = clearContracts(ACTIVE_CHAIN_ID);
        if (!bc) throw new Error('Bank withdrawals are unavailable on this network.');
        const bankIsSmartAccount = embeddedWalletInfo?.accountType === 'smartAccount';
        const bankChainClient = bankIsSmartAccount ? await getClientForChain({ id: ACTIVE_CHAIN_ID }) : undefined;
        await scTransferToken({
          smartWalletClient: bankChainClient,
          ownerWallet: address,
          token: bc.usdc,
          to: res.depositAddress as `0x${string}`,
          amount: res.depositAmount || String(amount),
          chainId: ACTIVE_CHAIN_ID,
        });
        if (cancelled) return;

        setDone(true);
        track('withdraw_completed', { method: 'bank' }); // no amounts/PII
        // Optimistic only AFTER the USDC actually left. A linked-wallet withdraw just passed THROUGH
        // Cash (move in, off-ramp out ≈ net 0), so skip the overlay there.
        if (!sourceWallet?.external) bal.applyOptimistic(-amount, 0);
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
  // You can only take out what's actually there. Withdrawing from the Clear wallet draws on Cash, so
  // that balance is the ceiling; an external linked wallet is swept into Cash first, and we don't hold
  // its balance here, so we can't cap that case client-side (Bridge/the transfer will reject it).
  const selectedWallet = wallets.find((w) => w.id === walletId) ?? wallets[0];
  const available = selectedWallet?.external ? null : bal.cash;
  const overBalance = available != null && amount > available;
  const amountValid = amount >= 5 && amount <= 10000 && !overBalance;

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
              {available != null && available > 0 && (
                <button
                  type="button"
                  onClick={() => setAmountStr(String(Math.floor(available * 100) / 100))}
                  className={cn(
                    'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors',
                    amount > 0 && amount === Math.floor(available * 100) / 100
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  Max
                </button>
              )}
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
                      <span className="block text-xs text-muted-foreground">{m.id === 'bank_sd' && !cutoff.makesToday ? 'Next business day' : m.speed}{!m.soon && (m.instantFeeRate > 0 ? ` · ${(m.instantFeeRate * 100).toFixed(1)}% fee` : ' · Free')}</span>
                    </span>
                    <span className={cn('h-4 w-4 shrink-0 rounded-full border-2', active && !m.soon ? 'border-foreground bg-foreground' : 'border-border')}>
                      {active && !m.soon && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>

            {BANK_METHODS.has(methodId) && banks.length === 0 ? (
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
            <p className={cn('mt-2 text-center text-[11px]', overBalance ? 'text-negative' : 'text-muted-foreground')}>
              {overBalance
                ? `You only have ${fmt(available ?? 0)} available`
                : amount > 10000
                  ? 'Max $10,000 per transaction'
                  : available != null
                    ? `${fmt(available)} available · withdraw $5–$10,000`
                    : 'Withdraw $5–$10,000'}
            </p>
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

            {/* Same-day only actually lands today if Bridge can clear the conversion AND submit the
                batch before its 2:30 PM ET cutoff — so say so plainly before they commit, in their
                own timezone, and stop promising "same day" once the window has closed. */}
            {methodId === 'bank_sd' && (
              <div
                className={cn(
                  'mt-3 rounded-xl border p-3 text-[11px] leading-relaxed',
                  cutoff.makesToday ? 'border-border text-muted-foreground' : 'border-info/40 bg-info/10 text-foreground',
                )}
              >
                <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {cutoff.makesToday ? 'Arrives today' : 'Arrives next business day'}
                  </span>
                  {cutoff.makesToday && (
                    <span className="shrink-0 tabular-nums font-semibold text-foreground">
                      {formatCountdown(cutoff.msRemaining)} left
                    </span>
                  )}
                </div>
                <p className="mt-1.5">
                  {cutoff.isWeekend
                    ? `ACH doesn't process on weekends, so this settles the next business day. The same-day cutoff is ${cutoff.localLabel}.`
                    : cutoff.makesToday
                      ? `To settle today the conversion must clear and the batch must be submitted before the ${cutoff.localLabel} cutoff.`
                      : `Today's ${cutoff.localLabel} cutoff has passed, so this settles the next business day.`}
                </p>
              </div>
            )}

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
                <div className="mt-4 text-base font-semibold text-foreground">
                  {offrampStage === 'waiting' ? 'Confirm your cash-out in Coinbase…' : offrampStage === 'sending' ? 'Sending your funds…' : 'Sending your withdrawal…'}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {offrampStage === 'waiting'
                    ? 'Finish the cash-out in the Coinbase tab — we’ll send your USDC automatically.'
                    : offrampStage === 'sending'
                      ? 'Transferring to Coinbase to pay out to your card.'
                      : `Processing with ${selected.p.name}.`}
                </div>
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
