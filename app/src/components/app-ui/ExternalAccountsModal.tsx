import { useState } from 'react';
import { Landmark, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';

const MOCK_BANKS = ['Bank of America', 'Wells Fargo', 'Capital One', 'Citi', 'SoFi'];
const rand4 = () => String(Math.floor(1000 + Math.random() * 9000));

/**
 * Manage linked external bank accounts. Connect a new one through Plaid (mocked here as a brief
 * "connecting" state); remove ones you no longer use. The Add money / Withdraw / Pay bank pickers
 * read this list.
 *
 * SEAM — real Plaid Link (already wired in components/portfolio/DepositModal.tsx):
 *   token = await getPlaidLinkToken(walletAddress)
 *   window.Plaid.create({ token, onSuccess: (public_token, meta) => exchangePlaidToken(public_token, …) }).open()
 *   then add each returned account (name/mask/subtype) via addAccount().
 */
export default function ExternalAccountsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts, addAccount, removeAccount } = useExternalAccounts();
  const [connecting, setConnecting] = useState(false);

  const connect = () => {
    setConnecting(true);
    setTimeout(() => {
      const name = MOCK_BANKS[Math.floor(Math.random() * MOCK_BANKS.length)];
      addAccount(name, rand4(), Math.random() > 0.5 ? 'Checking' : 'Savings');
      setConnecting(false);
    }, 1900);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!connecting) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>External accounts</DialogTitle>
        </DialogHeader>

        {connecting ? (
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
                    <div className="truncate text-xs text-muted-foreground">
                      {a.type} · ••{a.mask}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAccount(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">No accounts linked yet.</div>
              )}
            </div>

            <button
              type="button"
              onClick={connect}
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
