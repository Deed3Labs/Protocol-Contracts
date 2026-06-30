import { Plus, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';

const shorten = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * Manage wallets. The Clear smart wallet is your PRIMARY (holds funds, can't be unlinked). Link
 * external wallets (MetaMask etc.) via Privy to view their balances and transfer USDC/CLRUSD on-chain.
 * Linking opens Privy's connect + signature flow; unlinking removes it from your Privy account.
 */
export default function LinkedWalletsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, linkWallet, removeWallet } = useLinkedWallets();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Wallets</DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Your Clear account is your primary wallet. Link external wallets to view their balances and move
          USDC or CLRUSD on-chain.
        </p>

        <div className="mt-3 space-y-2">
          {wallets.map((w) => (
            <div key={w.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Wallet className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{w.label}</span>
                  {w.isPrimary && (
                    <span className="shrink-0 rounded-full bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium text-positive">Primary</span>
                  )}
                </div>
                <div className="truncate text-xs tabular-nums text-muted-foreground">{shorten(w.address)}</div>
              </div>
              {w.external && (
                <button
                  type="button"
                  onClick={() => removeWallet(w.id)}
                  aria-label="Unlink wallet"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={linkWallet}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> Link a wallet
        </button>

        <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> Linking proves ownership with a signature — Clear never moves funds without you.
        </p>
      </DialogContent>
    </Dialog>
  );
}
