import { Wifi, Snowflake } from 'lucide-react';
import type { CardData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The physical card — design spec §9.
 *
 * The colors here are literal hexes rather than tokens, and that's deliberate:
 * this is a picture of a real object, so it must look the same in light, dusk and
 * dark. The 0.5px #5F5E5A border is load-bearing — without it the dark face
 * disappears into a dark page.
 */
export default function ClearCardFace({
  card,
  className,
  revealNumber,
}: {
  card: CardData;
  className?: string;
  /** Show the full number — only ever inside the timed reveal on Card details. */
  revealNumber?: boolean;
}) {
  return (
    <div
      className={cn(
        // Contents step up with the card on desktop — the spec's sizes are against
        // a 250px card, and left fixed they leave a large face looking half-empty.
        'relative flex aspect-[1.586/1] flex-col justify-between rounded-xl border-[0.5px] p-4 lg:p-5',
        className,
      )}
      style={{ backgroundColor: '#2C2C2A', borderColor: '#5F5E5A' }}
      aria-label={card.activated ? `Clear card ending ${card.last4}` : 'Clear card — not activated'}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium lg:text-[15px]" style={{ color: '#F1EFE8' }}>
          Clear
        </span>
        {/* Contactless: the arcs rotated a quarter turn, as on a real card */}
        <Wifi
          className="h-4 w-4 rotate-90 lg:h-[18px] lg:w-[18px]"
          strokeWidth={1.75}
          style={{ color: '#888780' }}
          aria-hidden
        />
      </div>

      {/* Chip — 34×25 with a 4px radius */}
      <div
        className="h-[25px] w-[34px] rounded lg:h-[29px] lg:w-[40px]"
        style={{ backgroundColor: '#888780' }}
        aria-hidden
      />

      <div>
        <p
          className="mb-1.5 font-mono text-[15px] tracking-[1px] lg:text-[17px]"
          style={{ color: '#F1EFE8' }}
        >
          {!card.activated
            ? '•••• •••• •••• ••••'
            : revealNumber && card.pan
              ? card.pan
              : `•••• •••• •••• ${card.last4}`}
        </p>
        <div className="flex items-end justify-between text-[11px] lg:text-xs" style={{ color: '#B4B2A9' }}>
          <span>
            {card.cardholder}
            {card.expiry && ` · ${card.expiry}`}
          </span>
          <span>{card.network}</span>
        </div>
      </div>

      {/* Frozen is a state of the object, so it reads on the object itself */}
      {card.frozen && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium"
          style={{ backgroundColor: 'rgba(44,44,42,0.72)', color: '#F1EFE8' }}
        >
          <Snowflake className="h-[15px] w-[15px]" strokeWidth={1.75} aria-hidden />
          Frozen
        </div>
      )}
    </div>
  );
}
