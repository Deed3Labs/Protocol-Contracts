import { Landmark, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Manage Plaid-linked external bank accounts. "Connect a bank" runs real Plaid Link (see
 * lib/plaidLink.ts); accounts + balances come from the backend (getBankBalances). Disconnect is
 * per-institution (Plaid item). The Add money / Withdraw / Pay / Transfer bank pickers read this.
 */
export default function ExternalAccountsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts, linkBank, removeAccount, linking, loading } = useExternalAccounts();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!linking) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>External accounts</DialogTitle>
        </DialogHeader>

        {linking ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
            <div className="mt-4 text-sm font-medium text-foreground">Connecting securely…</div>
            <div className="mt-1 text-xs text-muted-foreground">Choose your bank and log in with Plaid.</div>
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Link your bank to add money, withdraw, and pay bills. Connections are read-only and secured by Plaid.
            </p>

            <div className="mt-3 space-y-2">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                    <Landmark className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                    <div className="truncate text-xs capitalize text-muted-foreground">
                      {a.type}
                      {a.mask ? ` · ••${a.mask}` : ''}
                    </div>
                  </div>
                  {typeof a.balance === 'number' && <div className="shrink-0 text-sm tabular-nums text-foreground">{fmt(a.balance)}</div>}
                  <button
                    type="button"
                    onClick={() => void removeAccount(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
                    </span>
                  ) : (
                    'No accounts linked yet.'
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void linkBank()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Connect a bank
            </button>

            <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Bank-grade encryption · we never see your login.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
