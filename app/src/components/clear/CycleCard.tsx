import Card from './Card';
import type { Cycle } from '@/lib/clearModel';

/**
 * Cycle progress — design spec §4. Shown only once the member is in use; day one
 * has no cycle running.
 *
 * Desktop renders it bare at a fixed 220px beside the balance; mobile gives it a
 * card of its own in the stack.
 */
export default function CycleCard({ cycle, variant = 'bare' }: { cycle: Cycle; variant?: 'bare' | 'card' }) {
  const elapsed = Math.max(0, Math.min(1, (cycle.lengthDays - cycle.daysLeft) / cycle.lengthDays));

  const body = (
    <>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-foreground-secondary">{cycle.lengthDays}-day cycle</span>
        <span className="text-foreground">{cycle.daysLeft} days left</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-border">
        <div className="h-full bg-foreground-secondary" style={{ width: `${elapsed * 100}%` }} />
      </div>
      {variant === 'bare' && cycle.clearsOn && (
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground">Clears on {cycle.clearsOn}</p>
      )}
    </>
  );

  if (variant === 'card') return <Card className="py-2.5">{body}</Card>;
  return <div className="w-[220px]">{body}</div>;
}
