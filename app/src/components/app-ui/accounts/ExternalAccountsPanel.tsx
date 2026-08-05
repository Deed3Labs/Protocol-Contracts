import { Plus, Landmark } from 'lucide-react';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { cn } from '@/lib/utils';

const fmtUsd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * External accounts — the third tracker column.
 *
 * Built to the same anatomy as the two calendars beside it: uppercase label with a control on
 * the right, the total on the shared 2rem light scale, then the data as an edge-to-edge list,
 * then a footer rule. The empty state occupies the same shape so the column doesn't collapse
 * or read as a rendering fault before a bank is linked.
 */
export default function ExternalAccountsPanel({ className }: { className?: string }) {
  const { accounts, totalBalance, loading, linking, linkBank } = useExternalAccounts();

  // The largest account, used to scale each row's share rule — the same "encode state in form,
  // not just number" treatment the heatmap gives spend.
  const max = accounts.reduce((m, a) => Math.max(m, a.balance ?? 0), 0);

  return (
    <section className={cn('flex flex-col py-6', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          External accounts
        </span>
        <button
          type="button"
          onClick={() => void linkBank()}
          disabled={linking}
          aria-label="Connect a bank"
          className="border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-4 text-[1.75rem] font-light leading-none tracking-tight tabular-nums text-foreground">
        {loading ? <span className="text-muted-foreground/40">—</span> : fmtUsd(totalBalance)}
      </p>

      {accounts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center border-t border-border py-10 text-center">
          <Landmark className="h-5 w-5 text-muted-foreground/50" strokeWidth={1.25} />
          <p className="mt-3 text-sm text-foreground">No banks connected</p>
          <p className="mt-1 max-w-[26ch] text-xs text-muted-foreground">
            Link an account to track its balance alongside your Clear cash.
          </p>
          <button
            type="button"
            onClick={() => void linkBank()}
            disabled={linking}
            className="mt-4 bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {linking ? 'Connecting…' : 'Connect a bank'}
          </button>
        </div>
      ) : (
        <div className="flex-1 border-t border-border">
          {accounts.map((a) => {
            const bal = a.balance ?? 0;
            const share = max > 0 ? Math.max((bal / max) * 100, 2) : 0;
            return (
              <div key={a.id} className="border-b border-border py-3 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-foreground">{a.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-foreground">
                    {a.balance === undefined ? '—' : fmtUsd(bal)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                    {a.type} &middot;&middot;{a.mask}
                  </span>
                  {/* share of the largest linked account — reads at a glance, no legend needed */}
                  <span className="h-px flex-1 bg-border" aria-hidden>
                    <span className="block h-px bg-foreground/40" style={{ width: `${share}%` }} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span>Via Plaid</span>
        <span className="tabular-nums">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>
    </section>
  );
}
