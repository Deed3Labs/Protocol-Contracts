import { useState } from 'react';
import { Building2, Check, Copy, Eye, EyeOff, Landmark, Loader2, Repeat, Clock, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useBridge } from '@/context/BridgeContext';
import { useKyc } from '@/context/KycContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { cn } from '@/lib/utils';

/*
 * The member's USD deposit account — their Bridge virtual account, presented like a normal checking
 * account because that's exactly how it behaves: give the routing + account number to an employer or
 * a bank transfer, and the dollars arrive as USDC.
 *
 * This is the ONLY inbound fiat rail. Bridge cannot debit a bank account ("not integrate with Plaid
 * to initiate money movement, including pulling or debiting"), so every deposit is something the
 * member pushes — which is why the flows here are instructions to set something up elsewhere rather
 * than a button that moves money.
 */

const mask = (v: string) => (v.length > 4 ? `${'•'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}` : v);

function CopyRow({ label, value, hidden }: { label: string; value: string; hidden?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="truncate font-display text-sm tabular-nums text-foreground">{hidden ? mask(value) : value}</div>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">{n}</span>
      <span className="text-sm text-muted-foreground">{children}</span>
    </li>
  );
}

export default function DepositAccountCard({ className }: { className?: string }) {
  const { virtualAccount: va, provision } = useBridge();
  const { verified, openKyc } = useKyc();
  const { accounts: banks, openManager } = useExternalAccounts();
  const [revealed, setRevealed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [modal, setModal] = useState<null | 'direct' | 'recurring'>(null);
  const [recurringTab, setRecurringTab] = useState<'push' | 'auto'>('push');

  const active = va.status === 'active';

  const activate = async () => {
    if (!verified) {
      openKyc();
      return;
    }
    setOpening(true);
    try {
      await provision();
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Deposit account</div>
            <div className="truncate text-[11px] text-muted-foreground">{active ? va.bankName || 'Clear · via Bridge' : 'Not open yet'}</div>
          </div>
          {active && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Hide numbers' : 'Show numbers'}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>

        {active ? (
          <>
            <div className="px-5 py-1">
              <CopyRow label="Routing number" value={va.routingNumber} hidden={!revealed} />
              <CopyRow label="Account number" value={va.accountNumber} hidden={!revealed} />
            </div>
            <div className="flex gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setModal('direct')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Landmark className="h-3.5 w-3.5" /> Direct deposit
              </button>
              <button
                type="button"
                onClick={() => { setRecurringTab('push'); setModal('recurring'); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Repeat className="h-3.5 w-3.5" /> Recurring
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void activate()}
            disabled={opening}
            className="flex w-full items-center gap-2.5 px-5 py-4 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Open your account</span>
              <span className="block text-[11px] text-muted-foreground">
                {verified ? 'Get a routing & account number for deposits.' : 'Verify your identity to get account details.'}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-info">{verified ? (opening ? 'Opening…' : 'Open') : 'Verify'}</span>
          </button>
        )}
      </div>

      {/* ---- Direct deposit: hand these details to an employer ---- */}
      <Dialog open={modal === 'direct'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <div className="text-base font-semibold text-foreground">Set up direct deposit</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Give these to your employer or benefits provider and your pay arrives here automatically, as USDC.
          </p>

          <div className="mt-4 rounded-xl border border-border px-4 py-1">
            {va.beneficiary && <CopyRow label="Account holder" value={va.beneficiary} />}
            <CopyRow label="Routing number" value={va.routingNumber} />
            <CopyRow label="Account number" value={va.accountNumber} />
            <CopyRow label="Account type" value="Checking" />
          </div>

          <ol className="mt-4 space-y-2.5">
            <Step n={1}>Open your employer's payroll portal (or ask HR for a direct deposit form).</Step>
            <Step n={2}>Paste the routing and account numbers above.</Step>
            <Step n={3}>Choose the amount — all of your pay, or a fixed portion.</Step>
          </ol>

          <button
            type="button"
            onClick={() => {
              const text = `Account holder: ${va.beneficiary || ''}\nRouting number: ${va.routingNumber}\nAccount number: ${va.accountNumber}\nAccount type: Checking`;
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
            className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
          >
            Copy all details
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Most employers apply changes within one or two pay cycles.</p>
        </DialogContent>
      </Dialog>

      {/* ---- Recurring deposits ---- */}
      <Dialog open={modal === 'recurring'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <div className="text-base font-semibold text-foreground">Recurring deposits</div>
          <p className="mt-1 text-sm text-muted-foreground">Put your savings on autopilot.</p>

          <div className="mt-4 flex gap-1 rounded-lg bg-secondary/60 p-1">
            {([['push', 'From your bank'], ['auto', 'Automatic']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRecurringTab(id)}
                className={cn(
                  'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                  recurringTab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {recurringTab === 'push' ? (
            <div className="mt-4">
              <div className="rounded-xl border border-border px-4 py-1">
                <CopyRow label="Routing number" value={va.routingNumber} />
                <CopyRow label="Account number" value={va.accountNumber} />
              </div>
              <ol className="mt-4 space-y-2.5">
                <Step n={1}>Open your bank's app and find transfers or bill pay.</Step>
                <Step n={2}>Add Clear as a payee using the numbers above.</Step>
                <Step n={3}>Schedule it — weekly, monthly, or on payday.</Step>
              </ol>
              <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-border p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <Landmark className="mt-px h-3 w-3 shrink-0" />
                Free, and it arrives in seconds if your bank supports instant transfers. You stay in control —
                pause or change it from your bank at any time.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-border p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Coming soon</div>
                  <div className="text-[11px] text-muted-foreground">Let Clear pull the money for you, on a schedule you set.</div>
                </div>
              </div>

              {/* Placeholder for the future pull rail — inert until a debit-capable provider is wired. */}
              <div className="mt-3 space-y-3 opacity-60" aria-hidden>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">From</span>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm">
                    <span className="truncate text-foreground">{banks[0] ? `${banks[0].name} ••${banks[0].mask}` : 'A linked bank account'}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Amount</span>
                    <div className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground">$100.00</div>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Every</span>
                    <div className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground">Month</div>
                  </div>
                </div>
              </div>

              {banks.length === 0 && (
                <button
                  type="button"
                  onClick={() => { setModal(null); openManager(); }}
                  className="mt-3 w-full rounded-xl border border-border py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
                >
                  Link a bank in the meantime
                </button>
              )}
              <button
                type="button"
                onClick={() => setRecurringTab('push')}
                className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                Set one up from your bank instead
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
