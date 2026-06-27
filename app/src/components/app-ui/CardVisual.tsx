import { useState } from 'react';
import { Settings, Eye, EyeOff, Snowflake } from 'lucide-react';
import { cn } from '@/lib/utils';

const NUMBER = '5231 7252 1769 8152';
const MASKED = '•••• •••• •••• 8152';

/**
 * Minimal debit-card widget. A flat, theme-inverting card surface (no chip/logo/glows)
 * with brand · number · holder/expiry, details masked by default. Footer (divided by a
 * hairline) holds the freeze switch + Manage.
 */
export default function CardVisual({ className, onManage }: { className?: string; onManage?: () => void }) {
  const [active, setActive] = useState(true);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Your card</h3>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide card details' : 'Show card details'}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>

        {/* card */}
        <div
          className={cn(
            'relative aspect-[1.6/1] overflow-hidden rounded-xl bg-foreground text-background transition-opacity duration-300',
            !active && 'opacity-50',
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-background/[0.08] via-transparent to-transparent" aria-hidden />
          <div className="relative flex h-full flex-col justify-between p-5">
            <span className="font-display text-sm font-semibold tracking-wide">Clear</span>
            <span className="whitespace-nowrap font-display text-base tracking-[0.15em] tabular-nums">{revealed ? NUMBER : MASKED}</span>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-background/45">Card holder</div>
                <div className="truncate text-sm font-medium">Steven Spark</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-background/45">Expires</div>
                <div className="text-sm font-medium tabular-nums">{revealed ? '08/29' : '••/••'}</div>
              </div>
            </div>
          </div>

          {!active && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
                <Snowflake className="h-3.5 w-3.5" /> Frozen
              </span>
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <button type="button" onClick={() => setActive((v) => !v)} className="flex items-center gap-2" aria-pressed={active}>
          <span className={cn('relative h-5 w-9 shrink-0 rounded-md transition-colors duration-200', active ? 'bg-positive' : 'bg-muted')}>
            <span
              className="absolute left-0 top-0.5 h-4 w-4 rounded-[5px] bg-white shadow-sm transition-transform duration-200"
              style={{ transform: active ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </span>
          <span className="text-xs font-medium text-foreground">{active ? 'Card active' : 'Card frozen'}</span>
        </button>

        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Settings className="h-3.5 w-3.5" /> Manage
        </button>
      </div>
    </div>
  );
}
