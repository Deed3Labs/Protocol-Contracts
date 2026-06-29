import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { Check, Loader2, Repeat, Sparkles, Trash2, TriangleAlert, Zap } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { isAaUnsupportedError } from '@/lib/aa';
import { installAutopaySession, type AutopayCadence } from '@/lib/autopay';
import { listAutopayRules, cancelAutopayRule, runAutopayRule, type AutopayRule } from '@/utils/apiClient';
import { useClearBalances } from '@/hooks/useClearBalances';
import { cn } from '@/lib/utils';

/*
 * Auto-save — "sign once, then we save for you." Sets up recurring gasless Cash→Savings deposits via a
 * ZeroDev session key (lib/autopay): the user approves a scoped session once, then the backend runner
 * deposits on schedule (no signing, no gas) and equity credits accrue. Rent → ownership, automated.
 */

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [100, 250, 500, 1000];
const CADENCES: { id: AutopayCadence; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
];

export default function AutoSaveModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { address } = useAccount();
  const { embeddedWalletInfo } = useAppKitAccount();
  const { client: smartWalletClient } = useSmartWallets();
  const isSmartAccount = embeddedWalletInfo?.accountType === 'smartAccount';
  const bal = useClearBalances();
  const chainId = ACTIVE_CHAIN_ID;
  const available = !!clearContracts(chainId); // vault (with the autopay mandate) deployed on this chain

  const [amountStr, setAmountStr] = useState('');
  const [cadence, setCadence] = useState<AutopayCadence>('monthly');
  const [runs, setRuns] = useState(12);
  const [rules, setRules] = useState<AutopayRule[]>([]);
  const [step, setStep] = useState<'setup' | 'working' | 'done'>('setup');
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const amount = Number(amountStr) || 0;
  const amountValid = amount >= 1;

  const loadRules = async () => {
    if (!address) return;
    try {
      setRules(await listAutopayRules(address));
    } catch {
      /* best-effort */
    }
  };

  useEffect(() => {
    if (!open) return;
    setAmountStr('');
    setCadence('monthly');
    setRuns(12);
    setStep('setup');
    setError(null);
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address]);

  const turnOn = async () => {
    if (!address) {
      setError('Connect your wallet to set up Auto-save.');
      return;
    }
    setStep('working');
    setError(null);
    try {
      await installAutopaySession({ chainId, ownerWallet: address, amountUsdc: amount, cadence, runs, isSmartAccount, smartWalletClient });
      await loadRules();
      setStep('done');
    } catch (e) {
      // 7702 sessions need wallet-side authorization signing that the current wallet/library combo
      // doesn't support — surface a plain message instead of the raw viem error.
      setError(
        isAaUnsupportedError(e)
          ? "Auto-save isn't available on your wallet yet. We're enabling it — your one-time deposits still work."
          : e instanceof Error
            ? e.message
            : 'Could not set up Auto-save.',
      );
      setStep('setup');
    }
  };

  const remove = async (id: string) => {
    if (!address) return;
    await cancelAutopayRule(address, id);
    await loadRules();
  };

  const runNow = async (rule: AutopayRule) => {
    if (!address) return;
    setRunningId(rule.id);
    setRunMsg(null);
    try {
      const res = await runAutopayRule(address, rule.id);
      if (res.ok) {
        bal.applyOptimistic(-rule.amountUsdc, rule.amountUsdc);
        setRunMsg(`Test deposit sent (${fmt(rule.amountUsdc)}).`);
      } else {
        setRunMsg(res.message || 'Test run failed.');
      }
      await loadRules();
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {step === 'done' ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
              <Check className="h-7 w-7 text-positive" strokeWidth={3} />
            </div>
            <div className="mt-4 text-base font-semibold text-foreground">Auto-save is on</div>
            <div className="mt-1 text-sm text-muted-foreground">
              We'll move <span className="font-medium text-foreground">{fmt(amount)}</span> from Cash to Savings{' '}
              {cadence === 'weekly' ? 'every week' : 'every month'} — no signing, no gas. Equity credits accrue each time.
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5">
            <div className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
              <Repeat className="h-[18px] w-[18px]" /> Auto-save
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
              Sign once. We move money from Cash to Savings on schedule — gasless, no approvals — and equity credits build automatically.
            </p>

            {!available ? (
              <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Auto-save isn't available on this network yet.</span>
              </div>
            ) : (
              <>
                {/* amount */}
                <label className="mb-2 block text-xs font-medium text-muted-foreground">Amount each time</label>
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

                {/* cadence */}
                <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">How often</label>
                <div className="grid grid-cols-2 gap-2">
                  {CADENCES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCadence(c.id)}
                      className={cn(
                        'rounded-xl border py-2.5 text-sm font-medium transition-colors',
                        cadence === c.id ? 'border-foreground bg-secondary/50 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/40',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                {/* number of times */}
                <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Number of times</label>
                <input
                  inputMode="numeric"
                  value={String(runs)}
                  onChange={(e) => setRuns(Math.max(1, Math.min(60, Number(e.target.value.replace(/[^0-9]/g, '')) || 1)))}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm tabular-nums text-foreground focus:border-foreground/30 focus:outline-none"
                />
                {amountValid && (
                  <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> Up to {fmt(amount * runs)} total over {runs} {cadence === 'weekly' ? 'weeks' : 'months'}.
                  </p>
                )}

                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!amountValid || step === 'working'}
                  onClick={turnOn}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
                >
                  {step === 'working' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" /> Turn on Auto-save
                    </>
                  )}
                </button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">One signature now. Nothing to sign later.</p>
              </>
            )}

            {/* existing rules */}
            {rules.length > 0 && (
              <div className="mt-6 border-t border-border pt-4">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Active Auto-save</div>
                <div className="space-y-2">
                  {rules.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {fmt(r.amountUsdc)} {r.cadence === 'weekly' ? 'weekly' : 'monthly'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.status === 'active'
                            ? `Next ${new Date(r.nextRunAt).toLocaleDateString()}${r.runsLeft != null ? ` · ${r.runsLeft} left` : ''}`
                            : r.status}
                          {r.lastError ? ' · last run failed' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => runNow(r)}
                          disabled={runningId === r.id || r.status !== 'active'}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                          title="Run one deposit now (test)"
                        >
                          {runningId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                          Run now
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          aria-label="Cancel Auto-save"
                          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {runMsg && <p className="mt-2 text-[11px] text-muted-foreground">{runMsg}</p>}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
