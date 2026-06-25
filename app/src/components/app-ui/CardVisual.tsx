import { useState } from 'react';
import { Settings, Snowflake, Eye, EyeOff, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

const NUMBER = '5231 7252 1769 8152';
const MASKED = '••••  ••••  ••••  8152';

/**
 * Debit-card widget, contained in a card. A premium gradient card mock with a
 * hide/show toggle (details masked by default), the bottom row pinned to the card's
 * lower edge, plus a freeze switch + Manage button.
 */
export default function CardVisual({ className }: { className?: string }) {
  const [active, setActive] = useState(true);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">Your card</h3>
          <span className="rounded-lg bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">Debit</span>
        </div>
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

      <div
        className={cn(
          'relative flex aspect-[1.6/1] flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-5 text-white shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)] transition-all duration-300',
          !active && 'saturate-[0.4]',
        )}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-gradient-to-br from-info/45 to-transparent blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-14 -left-8 h-44 w-44 rounded-full bg-gradient-to-tr from-violet-500/30 to-transparent blur-2xl" aria-hidden />

        {/* top group: brand + chip + number */}
        <div className="relative space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold tracking-wide">Clear</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Debit</div>
            </div>
            <Wifi className="h-5 w-5 rotate-90 text-white/70" />
          </div>
          <div className="flex h-7 w-10 items-center justify-center gap-[3px] rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500/80 shadow-inner">
            <span className="h-4 w-px bg-amber-800/40" />
            <span className="h-4 w-px bg-amber-800/40" />
            <span className="h-4 w-px bg-amber-800/40" />
          </div>
          <div className={cn('font-display text-[17px] tabular-nums transition-all', revealed ? 'tracking-[0.15em]' : 'tracking-[0.05em]')}>
            {revealed ? NUMBER : MASKED}
          </div>
        </div>

        {/* bottom group: pinned to the lower edge */}
        <div className="relative flex items-end justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/50">Card holder</div>
            <div className="text-sm font-medium">Steven Spark</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/50">Expires</div>
            <div className="text-sm font-medium tabular-nums">{revealed ? '08/29' : '••/••'}</div>
          </div>
          <div className="flex items-center">
            <span className="h-6 w-6 rounded-full bg-rose-500" />
            <span className="-ml-2.5 h-6 w-6 rounded-full bg-amber-400 mix-blend-hard-light" />
          </div>
        </div>

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-[2px]">
            <Snowflake className="h-6 w-6 text-white" />
            <span className="text-xs font-medium text-white">Frozen</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
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
          className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Settings className="h-3.5 w-3.5" /> Manage
        </button>
      </div>
    </div>
  );
}
