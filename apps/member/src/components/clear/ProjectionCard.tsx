import { Button } from '@/components/ui/button';
import Card from './Card';
import { money } from '@clear/domain';
import type { Savings, SavingsProjection } from '@/lib/clearModel';

/**
 * When the Clear Deed lands at the current rate — and what would move it.
 *
 * The second sentence is the useful half: a date on its own is just a number,
 * but "adding $250 a month moves this to Apr 2027" is a decision someone can
 * act on, which is why the auto-save control sits directly under it.
 */
export default function ProjectionCard({
  savings,
  projection,
  onAdjust,
}: {
  /** The date lives on the savings itself, so Home and this card can't disagree. */
  savings: Savings;
  projection: SavingsProjection;
  onAdjust?: () => void;
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground-secondary">On track for</span>
        <span className="text-[15px] font-medium">{savings.onTrackFor}</span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Based on {money(projection.perPayday)} every payday. Adding{' '}
        {money(projection.extraMonthly)} more each month moves this to {projection.withExtra}.
      </p>

      <Button variant="clear" size="xs" className="w-full" onClick={onAdjust}>
        Adjust auto-save
      </Button>
    </Card>
  );
}
