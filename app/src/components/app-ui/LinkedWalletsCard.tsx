import { ExternalLink, Wallet } from 'lucide-react';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useLinkedWalletBalances } from '@/hooks/useLinkedWalletBalances';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shorten = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const explorerBase = ACTIVE_CHAIN_ID === 84532 ? 'https://sepolia.basescan.org' : 'https://basescan.org';

/**
 * Linked external wallets + their USDC/CLRUSD balances, surfaced on the dashboard (not just the Wallets
 * modal). Balances via Alchemy tokens/by-address (one cheap batched call, fetched once on mount — no
 * idle polling). Renders nothing when no wallets are linked. See [[clearpath-alchemy-cu]].
 */
export default function LinkedWalletsCard({ className }: { className?: string }) {
  const { externalWallets, openManager } = useLinkedWallets();
  const { balances, loading } = useLinkedWalletBalances(
    externalWallets.map((w) => w.address),
    externalWallets.length > 0,
  );

  if (externalWallets.length === 0) return null;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Linked wallets</h3>
        <button
          type="button"
          onClick={openManager}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Manage
        </button>
      </div>

      <div className="space-y-2">
        {externalWallets.map((w) => {
          const b = balances[w.address.toLowerCase()];
          return (
            <div key={w.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Wallet className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{w.label}</div>
                <a
                  href={`${explorerBase}/address/${w.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                >
                  {shorten(w.address)} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium tabular-nums text-foreground">
                  {b ? fmt(b.usdc + b.clrusd) : loading ? '—' : fmt(0)}
                </div>
                {b && (b.usdc > 0 || b.clrusd > 0) && (
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {fmt(b.usdc)} USDC · {fmt(b.clrusd)} CLRUSD
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
