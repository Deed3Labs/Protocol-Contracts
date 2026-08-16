import Card from './Card';
import { money } from '@/lib/money';
import { cycleShortfall, type Credit, type Cycle } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Cycle progress — design spec §4. Shown only once the member is in use; day one
 * has no cycle running.
 *
 * The status line is the point of the card, and it says one of two things.
 *
 * "Clears automatically" when the deposit that's coming covers what has to be
 * repaid. What has to be repaid is only the *unsecured* draw — income-backed and
 * Boost. Savings-backed and asset-backed are drawn against collateral the co-op
 * already holds, so a default settles from that; asking someone to clear credit
 * their own savings stand behind would mean the cycle never reads clear no matter
 * what they earn.
 *
 * Otherwise it names the gap: "Add $420 to balance", in red. That figure exists
 * nowhere else in the app, and a member who doesn't see it finds out when the
 * cycle closes.
 *
 * Two shapes for two layouts. Desktop runs it as a full-width strip; mobile
 * stacks it as a card. Both colour the status — it's the same fact either way.
 */
export default function CycleCard({
  cycle,
  credit,
  expectedDeposit = 0,
  variant = 'strip',
}: {
  cycle: Cycle;
  /** Needed to work out what actually has to clear. Without it the card stays neutral. */
  credit?: Credit;
  /** What's expected to land before the cycle ends — usually the next payday. */
  expectedDeposit?: number;
  variant?: 'strip' | 'card';
}) {
  const elapsed = Math.max(0, Math.min(1, (cycle.lengthDays - cycle.daysLeft) / cycle.lengthDays));
  const shortfall = credit ? cycleShortfall(credit, expectedDeposit) : 0;
  const clears = shortfall === 0;

  const status = credit ? (clears ? 'Clears automatically' : `Add ${money(shortfall)} to balance`) : null;
  const statusClass = clears ? 'text-tier-savings-fg' : 'text-negative';

  // The expected inflow comes from the cash account, not a second field on the cycle: two places
  // holding "what's landing on payday" is two places to disagree, and they did.
  const detail = [cycle.clearsOn, expectedDeposit > 0 ? `~${money(expectedDeposit)}` : null]
    .filter(Boolean)
    .join(' · ');

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
        <p className="mt-1.5 text-right text-[11px]">
          {status && <span className={statusClass}>{status}</span>}
          {status && detail && <span className="text-muted-foreground"> · </span>}
          {detail && <span className="text-muted-foreground">{detail}</span>}
        </p>
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
        {status && <p className={cn('text-xs', statusClass)}>{status}</p>}
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </Card>
  );
}
