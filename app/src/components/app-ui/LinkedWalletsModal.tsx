import { useState } from 'react';
import { Loader2, Plus, ShieldCheck, Star, Trash2, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { cn } from '@/lib/utils';

const rand = () => Math.random().toString(16).slice(2, 6).toUpperCase();
const mockAddress = () => `0x${rand()}…${rand().slice(0, 2)}${rand().slice(0, 2)}`;

/**
 * Manage the user's linked wallets: set a primary, remove one, or link a new one by
 * connecting + signing to prove ownership (mocked here; real flow uses AppKit connect +
 * a signature challenge). The Add-money / Withdraw pickers read this list.
 */
export default function LinkedWalletsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, primaryId, setPrimary, removeWallet, addWallet } = useLinkedWallets();
  const [linking, setLinking] = useState(false);

  const linkWallet = () => {
    setLinking(true);
    setTimeout(() => {
      addWallet(`Wallet ${wallets.length + 1}`, mockAddress());
      setLinking(false);
    }, 1900);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!linking) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Linked wallets</DialogTitle>
        </DialogHeader>

        {linking ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
            <div className="mt-4 text-sm font-medium text-foreground">Connecting &amp; verifying…</div>
            <div className="mt-1 text-xs text-muted-foreground">Sign the message in your wallet to prove you own it.</div>
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Money you add or withdraw moves through these wallets. Link one by connecting and signing to prove ownership.
            </p>

            <div className="mt-3 space-y-2">
              {wallets.map((w) => {
                const isPrimary = w.id === primaryId;
                return (
                  <div key={w.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Wallet className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{w.label}</span>
                        {isPrimary && (
                          <span className="shrink-0 rounded-full bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium text-positive">Primary</span>
                        )}
                      </div>
                      <div className="truncate text-xs tabular-nums text-muted-foreground">{w.address}</div>
                    </div>
                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => setPrimary(w.id)}
                        aria-label="Set as primary"
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    {wallets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeWallet(w.id)}
                        aria-label="Remove wallet"
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={linkWallet}
              className={cn(
                'mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground',
              )}
            >
              <Plus className="h-4 w-4" /> Link a wallet
            </button>

            <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Only wallets you've verified can receive or send funds.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
