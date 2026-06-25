import { useState } from 'react';
import { Settings, Snowflake, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Debit-card visual + management controls. The card is the container (no extra card
 * chrome around it): a premium dark gradient with chip, contactless mark, and network
 * logo, plus an on/off switch (freeze) and a Manage button below.
 */
export default function CardVisual({ className }: { className?: string }) {
  const [active, setActive] = useState(true);

  return (
    <div className={cn('flex flex-col', className)}>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Your card</h3>

      <div
        className={cn(
          'relative aspect-[1.6/1] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-5 text-white shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)] transition-all duration-300',
          !active && 'saturate-[0.4]',
        )}
      >
        {/* decorative color glows */}
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-gradient-to-br from-info/45 to-transparent blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-14 -left-8 h-44 w-44 rounded-full bg-gradient-to-tr from-violet-500/30 to-transparent blur-2xl" aria-hidden />

        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold tracking-wide">Clear</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Debit</div>
          </div>
          <Wifi className="h-5 w-5 rotate-90 text-white/70" />
        </div>

        {/* EMV chip */}
        <div className="relative mt-4 flex h-7 w-10 items-center justify-center gap-[3px] rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500/80 shadow-inner">
          <span className="h-4 w-px bg-amber-800/40" />
          <span className="h-4 w-px bg-amber-800/40" />
          <span className="h-4 w-px bg-amber-800/40" />
        </div>

        <div className="relative mt-3 font-display text-[17px] tracking-[0.15em] tabular-nums">5231 7252 1769 8152</div>

        <div className="relative mt-3 flex items-end justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/50">Card holder</div>
            <div className="text-sm font-medium">Steven Spark</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/50">Expires</div>
            <div className="text-sm font-medium tabular-nums">08/29</div>
          </div>
          {/* network mark */}
          <div className="flex items-center">
            <span className="h-6 w-6 rounded-full bg-rose-500" />
            <span className="-ml-2.5 h-6 w-6 rounded-full bg-amber-400 mix-blend-hard-light" />
          </div>
        </div>

        {/* frozen overlay */}
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 backdrop-blur-[2px]">
            <Snowflake className="h-6 w-6 text-white" />
            <span className="text-xs font-medium text-white">Frozen</span>
          </div>
        )}
      </div>

      {/* management controls — no surrounding container */}
      <div className="mt-3 flex items-center justify-between gap-3">
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
