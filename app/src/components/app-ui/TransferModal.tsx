import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppKitAccount } from '@reown/appkit/react';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { ArrowDownUp, ArrowLeft, Check, ChevronDown, Landmark, Loader2, PiggyBank, ShieldCheck, TriangleAlert, Wallet, Zap } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useKyc } from '@/context/KycContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { gaslessDeposit, gaslessRedeem } from '@/lib/gaslessMoney';
import { isAaEnabled, isAaUnsupportedError } from '@/lib/aa';
import { scDeposit, scRedeem, canUseSendCalls } from '@/lib/sendCalls';
import { cn } from '@/lib/utils';

/*
 * "Transfer" — move money between your OWN same-type accounts: internal (Cash USDC ↔ Savings
 * CLRUSD, instant) or external (bank ↔ bank, ACH/instant-debit). The To list is filtered to the
 * From account's scope, so internal↔external is impossible by design (that's Add money / Withdraw).
 * Crypto abstracted as USD.
 *
 * SEAM: internal = ESA mint/redeem (USDC↔CLRUSD) or ledger move (on-chain, no KYC). External
 * bank↔bank is a pure-fiat ACH move that Bridge does NOT handle (Bridge is fiat↔stablecoin) — it
 * needs a SEPARATE ACH processor (e.g. Plaid Transfer / Dwolla / processor token); KYC-gated.
 */

type Scope = 'internal' | 'external';
interface Acct {
  id: string;
  name: string;
  detail: string;
  scope: Scope;
  balance?: number;
  icon: typeof Wallet;
}

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [50, 100, 500, 1000];
const INSTANT_FEE = 0.015;

export default function TransferModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts: external, openManager } = useExternalAccounts();
  const { verified, openKyc } = useKyc();
  const bal = useClearBalances();
  const { address } = useAccount();
  const { embeddedWalletInfo } = useAppKitAccount();
  const isSmartAccount = embeddedWalletInfo?.accountType === 'smartAccount';
  const chainId = ACTIVE_CHAIN_ID; // mainnet on app.useclear.org, Base Sepolia on the demo
  const accounts: Acct[] = [
    { id: 'cash', name: 'Cash', detail: 'USDC', scope: 'internal', balance: bal.cash, icon: Wallet },
    { id: 'savings', name: 'Savings', detail: 'CLRUSD', scope: 'internal', balance: bal.savings, icon: PiggyBank },
    ...external.map((a) => ({ id: a.id, name: a.name, detail: `${a.type} ••${a.mask}`, scope: 'external' as Scope, icon: Landmark })),
  ];

  const [step, setStep] = useState<'compose' | 'review' | 'status'>('compose');
  const [fromId, setFromId] = useState('cash');
  const [toId, setToId] = useState('savings');
  const [amountStr, setAmountStr] = useState('');
  const [method, setMethod] = useState<'ach' | 'instant'>('ach');
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('compose');
    setFromId('cash');
    setToId('savings');
    setAmountStr('');
    setMethod('ach');
    setFromOpen(false);
    setToOpen(false);
  }, [open]);

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    setError(null);
    setTxHash(null);

    // External bank↔bank stays a mocked ACH demo (separate rail, not wired yet).
    if (isExternal) {
      const t = setTimeout(() => setDone(true), 1600);
      return () => clearTimeout(t);
    }

    // Internal Cash↔Savings = real gasless deposit/redeem against the ESA vault.
    let cancelled = false;
    (async () => {
      try {
        if (!address) throw new Error('Connect your wallet to transfer.');
        const isDeposit = fromId === 'cash' && toId === 'savings';
        const isRedeem = fromId === 'savings' && toId === 'cash';
        if (!isDeposit && !isRedeem) throw new Error('Unsupported transfer.');
        // Smart accounts (AppKit email/social) MUST use EIP-5792 — the EIP-3009 relayer can't validate
        // their EIP-1271 signature. EOAs use EIP-3009 (gasless), or 5792 if their wallet advertises it.
        const scRun = isDeposit ? scDeposit : scRedeem;
        const relayerRun = isDeposit ? gaslessDeposit : gaslessRedeem;
        let hash: string;
        const useSc = isAaEnabled(chainId) && (isSmartAccount || (await canUseSendCalls(chainId)));
        if (useSc) {
          try {
            hash = await scRun({ ownerWallet: address, amount: amountStr, chainId });
          } catch (err) {
            // Smart accounts have no EIP-3009 fallback (1271 can't sign it) — surface the error.
            if (isSmartAccount || !isAaUnsupportedError(err)) throw err;
            hash = await relayerRun({ ownerWallet: address, amount: amountStr, chainId });
          }
        } else {
          hash = await relayerRun({ ownerWallet: address, amount: amountStr, chainId });
        }
        if (cancelled) return;
        setTxHash(hash);
        setDone(true);
        // Optimistic: reflect the move immediately, reconcile when the chain indexes.
        const amt = Number(amountStr) || 0;
        if (isDeposit) bal.applyOptimistic(-amt, amt);
        else bal.applyOptimistic(amt, -amt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Transfer failed.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const from = accounts.find((a) => a.id === fromId) ?? accounts[0];
  const toOptions = accounts.filter((a) => a.scope === from?.scope && a.id !== fromId);
  const to = accounts.find((a) => a.id === toId && a.scope === from?.scope) ?? toOptions[0];
  const isExternal = from?.scope === 'external';

  // keep `to` valid when `from` (and thus scope) changes
  useEffect(() => {
    if (!to || to.id === fromId) {
      const next = accounts.find((a) => a.scope === from?.scope && a.id !== fromId);
      if (next) setToId(next.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId]);

  const amount = Number(amountStr) || 0;
  const fee = isExternal && method === 'instant' ? amount * INSTANT_FEE : 0;
  const overBalance = from?.balance != null && amount > from.balance;
  const valid = amount >= 1 && !!to && !overBalance;
  const timing = !isExternal ? 'Instant' : method === 'instant' ? 'In minutes' : '1–3 business days';

  const swap = () => {
    if (!to) return;
    setFromId(to.id);
    setToId(from.id);
  };

  const AccountRow = ({ a, onClick, selected }: { a: Acct; onClick: () => void; selected: boolean }) => (
    <button key={a.id} type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary">
      <a.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{a.name}</span>
        <span className="block text-xs text-muted-foreground">{a.balance != null ? `${a.detail} · ${fmt(a.balance)}` : a.detail}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-foreground" />}
    </button>
  );

  const Picker = ({ label, acct, isOpen, setOpen, options }: { label: string; acct?: Acct; isOpen: boolean; setOpen: (o: boolean) => void; options: Acct[] }) => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          {acct ? <acct.icon className="h-[18px] w-[18px]" /> : <Wallet className="h-[18px] w-[18px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted-foreground">{label}</span>
          <span className="block truncate text-sm font-medium text-foreground">{acct?.name ?? 'Select'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {acct?.balance != null && <span className="hidden text-xs text-muted-foreground sm:inline">{fmt(acct.balance)}</span>}
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </span>
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
          {options.length > 0 ? (
            options.map((a) => (
              <AccountRow
                key={a.id}
                a={a}
                selected={a.id === acct?.id}
                onClick={() => {
                  label === 'From' ? setFromId(a.id) : setToId(a.id);
                  setOpen(false);
                }}
              />
            ))
          ) : (
            <div className="px-3 py-3 text-center text-xs text-muted-foreground">No other accounts of this type.</div>
          )}
          {from?.scope === 'external' && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openManager();
              }}
              className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Landmark className="h-3.5 w-3.5" /> Manage accounts
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {step === 'compose' && (
          <div className="p-5">
            <div className="mb-4 text-base font-semibold text-foreground">Transfer</div>

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
                  ${q.toLocaleString()}
                </button>
              ))}
            </div>

            {/* from → swap → to */}
            <div className="relative mt-5 space-y-2">
              <Picker label="From" acct={from} isOpen={fromOpen} setOpen={(o) => { setFromOpen(o); setToOpen(false); }} options={accounts} />
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={swap}
                  aria-label="Swap accounts"
                  disabled={!to}
                  className="absolute top-1/2 z-10 -mt-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-transform hover:bg-secondary active:scale-90 disabled:opacity-40"
                >
                  <ArrowDownUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <Picker label="To" acct={to} isOpen={toOpen} setOpen={(o) => { setToOpen(o); setFromOpen(false); }} options={toOptions} />
            </div>

            {/* external method */}
            {isExternal && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  { id: 'ach' as const, label: 'ACH · free', hint: '1–3 days' },
                  { id: 'instant' as const, label: 'Instant', hint: '1.5% fee' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-left transition-colors',
                      method === m.id ? 'border-foreground bg-secondary/50' : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <span className="block text-sm font-medium text-foreground">{m.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={!valid}
              onClick={() => setStep('review')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Review
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {overBalance ? `Only ${fmt(from?.balance ?? 0)} available` : !isExternal ? 'Moves instantly between your accounts' : `Bank transfer · ${timing}`}
            </p>
          </div>
        )}

        {step === 'review' && from && to && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setStep('compose')} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Review</span>
            </div>

            <div className="text-center">
              <div className="text-xs text-muted-foreground">You're transferring</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-xl border border-border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <from.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{from.name}</span>
              <ArrowDownUp className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-foreground">{to.name}</span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <to.icon className="h-[18px] w-[18px]" />
              </span>
            </div>

            <div className="mt-4 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="tabular-nums text-foreground">{fmt(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span className={cn('tabular-nums', fee > 0 ? 'text-foreground' : 'font-medium text-positive')}>{fee > 0 ? fmt(fee) : 'Free'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Arrives</span>
                <span className="text-foreground">{timing}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                // internal Cash↔Savings is on-chain (no KYC); external bank↔bank is a separate ACH
                // rail (not Bridge) and needs KYC.
                if (isExternal && !verified) openKyc(() => setStep('status'));
                else setStep('status');
              }}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Transfer {fmt(amount)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> {isExternal ? 'Securely via your bank' : 'Stays within your Clear accounts'}
            </p>
          </div>
        )}

        {step === 'status' && from && to && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {error ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-negative/10">
                  <TriangleAlert className="h-7 w-7 text-negative" />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">Transfer failed</div>
                <div className="mt-1 max-w-[280px] text-sm text-muted-foreground">{error}</div>
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
                <div className="mt-4 text-base font-semibold text-foreground">Transferring…</div>
                <div className="mt-1 text-sm text-muted-foreground">{fmt(amount)} · {from.name} → {to.name}</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  {isExternal ? <Check className="h-7 w-7 text-positive" strokeWidth={3} /> : <Zap className="h-7 w-7 text-positive" />}
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{isExternal && method === 'ach' ? 'Transfer started' : 'Transfer complete'}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fmt(amount)}</span> {isExternal && method === 'ach' ? 'is on its way to' : 'moved to'} {to.name}.
                </div>
                {txHash && (
                  <a
                    href={`${chainId === 84532 ? 'https://sepolia.basescan.org' : 'https://basescan.org'}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    View transaction
                  </a>
                )}
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
