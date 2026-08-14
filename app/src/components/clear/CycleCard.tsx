import Card from './Card';
import { money } from '@/lib/money';
import type { Cycle } from '@/lib/clearModel';

/**
 * Cycle progress — design spec §4. Shown only once the member is in use; day one
 * has no cycle running.
 *
 * Two shapes for two layouts. Desktop runs it as a full-width strip — countdown,
 * track, and what settles it — because nothing about the cycle needs the member
 * to act, so it reads as a status line rather than a card of its own. Mobile
 * stacks it as a card with the countdown above the track.
 */
export default function CycleCard({
  cycle,
  variant = 'strip',
}: {
  cycle: Cycle;
  variant?: 'strip' | 'card';
}) {
  const elapsed = Math.max(0, Math.min(1, (cycle.lengthDays - cycle.daysLeft) / cycle.lengthDays));

  const track = (
    <div className="h-1.5 overflow-hidden rounded-[3px] bg-border">
      <div className="h-full bg-foreground-secondary" style={{ width: `${elapsed * 100}%` }} />
    </div>
  );

  if (variant === 'card') {
    return (
      <Card className="py-2.5">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-foreground-secondary">{cycle.lengthDays}-day cycle</span>
          <span className="text-foreground">{cycle.daysLeft} days left</span>
        </div>
        {track}
        {/* Shown in both layouts. The reference's mobile cycle card omits it, but
            when the cycle clears is the whole point of the countdown — dropping it
            on mobile leaves "6 days left" with nothing to land on. */}
        {cycle.clearsOn && (
          <p className="mt-1.5 text-right text-[11px] text-muted-foreground">
            Clears on {cycle.clearsOn}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="grid grid-cols-[auto_1fr_auto] items-center gap-5 px-4 py-3">
      <div>
        <p className="text-xs text-foreground-secondary">{cycle.lengthDays}-day cycle</p>
        <p className="mt-0.5 text-sm">{cycle.daysLeft} days to rebalance</p>
      </div>
      {track}
      <div className="text-right">
        <p className="text-xs text-tier-savings-fg">Clears automatically</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {cycle.clearsOn}
          {cycle.clearsEstimate ? ` · ~${money(cycle.clearsEstimate)}` : ''}
        </p>
      </div>
    </Card>
  );
}
