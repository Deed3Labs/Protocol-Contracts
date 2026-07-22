import { Clock, CreditCard } from 'lucide-react';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/**
 * The Clear card — not issued yet, so this is deliberately a preview.
 *
 * It previously rendered a hardcoded PAN (`5231 7252 1769 8152`) behind a working Show/Hide toggle,
 * plus a freeze switch that toggled nothing. That reads as a real, active card: a member could try to
 * pay with those digits. Until issuing is live (Bridge/Stripe cards — see clearCardService), this
 * shows a muted placeholder that says what it is.
 */
export default function CardVisual({ className, onManage }: { className?: string; onManage?: () => void }) {
  const { name } = useMemberProfile();

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Your card</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3 w-3" /> Coming soon
          </span>
        </div>

        {/* Muted, non-interactive preview — no digits, nothing to freeze. */}
        <div className="relative aspect-[1.6/1] overflow-hidden rounded-xl bg-secondary" aria-label="Clear card preview — not yet available">
          <div className="relative flex h-full flex-col justify-between p-5">
            <span className="font-display text-sm font-semibold tracking-wide text-muted-foreground">Clear</span>
            <span className="whitespace-nowrap font-display text-base tracking-[0.15em] tabular-nums text-muted-foreground/60">
              •••• •••• •••• ••••
            </span>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Card holder</div>
                <div className="truncate text-sm font-medium uppercase text-muted-foreground">{name}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Expires</div>
                <div className="text-sm font-medium tabular-nums text-muted-foreground/60">••/••</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 border-t border-border px-5 py-3">
        <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
          Spend your Clear balance anywhere — we'll let you know the moment cards are ready.
        </p>
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
