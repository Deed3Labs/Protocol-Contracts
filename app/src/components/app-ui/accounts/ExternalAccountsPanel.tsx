import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { cn } from '@/lib/utils';

const fmtUsd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * External accounts — the third tracker column.
 *
 * Same anatomy as the calendars beside it: uppercase label, a total, then the data. Renders a
 * real empty state with a link action when no bank is connected, so the column never reads as
 * a rendering bug on a new member's dashboard.
 */
export default function ExternalAccountsPanel({ className }: { className?: string }) {
  const { accounts, totalBalance, loading, linking, linkBank } = useExternalAccounts();

  return (
    <section className={cn('flex flex-col py-6', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          External accounts
        </span>
        {accounts.length > 0 && (
          <button
            type="button"
            onClick={() => void linkBank()}
            disabled={linking}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {linking ? 'Connecting…' : 'Add'}
          </button>
        )}
      </div>

      <p className="mb-4 text-[2rem] font-light leading-none tracking-tight tabular-nums text-foreground">
        {loading ? <span className="text-muted-foreground/40">—</span> : fmtUsd(totalBalance)}
      </p>

      {accounts.length === 0 ? (
        // Empty state — the column earns its space by explaining what goes here.
        <div className="flex flex-1 flex-col items-start justify-center border-t border-border py-8">
          <p className="text-sm text-foreground">No banks connected</p>
          <p className="mt-1 max-w-[24ch] text-xs text-muted-foreground">
            Connect a bank to see its balance here and move money in.
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
        <div className="flex-1">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-baseline justify-between gap-4 border-t border-border py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{a.name}</span>
                <span className="mt-0.5 block text-xs capitalize text-muted-foreground">
                  {a.type} &middot;&middot;{a.mask}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">
                {a.balance === undefined ? '—' : fmtUsd(a.balance)}
              </span>
            </div>
          ))}
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
