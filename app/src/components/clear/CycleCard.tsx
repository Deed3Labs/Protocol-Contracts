import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import { money } from '@/lib/money';
import { cycleShortfall, cycleStatus, unsecuredUsed, type Credit, type Cycle } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Thirty marks, one per day — design spec §4b.
 *
 * Not a progress bar. The app already leans on bars, and a bar here would read as a meter filling
 * toward something bad. Discrete marks read as a calendar: elapsed days are short and muted, the
 * days still to come stand tall. The member counts them rather than estimating a percentage.
 */
function DayMarks({
  lengthDays,
  daysLeft,
  size = 'strip',
}: {
  lengthDays: number;
  daysLeft: number;
  size?: 'strip' | 'card';
}) {
  const left = Math.max(0, Math.min(lengthDays, daysLeft));
  const elapsed = lengthDays - left;

  return (
    <div
      className={cn('flex items-end', size === 'strip' ? 'gap-[3px]' : 'gap-[2px]')}
      role="img"
      aria-label={`Day ${elapsed} of ${lengthDays}, ${left} days left`}
    >
      {Array.from({ length: lengthDays }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-[1px]',
            i < elapsed
              ? cn('bg-border-strong opacity-45', size === 'strip' ? 'h-1.5' : 'h-[5px]')
              : cn('bg-foreground-secondary', size === 'strip' ? 'h-[13px]' : 'h-[11px]'),
          )}
        />
      ))}
    </div>
  );
}

/**
 * The cycle — design spec §4b. Shown only once the member is in use; day one has no cycle running.
 *
 * The figure is the *unsecured* draw and never the full carried balance. Savings-backed and
 * asset-backed credit is covered by collateral the co-op already holds, so a default settles from
 * that; printing the total here would make secured borrowing look like a debt problem, and the cycle
 * would never read clear no matter how much the member earned.
 *
 * Three states, one shape. Most members are in the middle one — drawn, and the deposit that's coming
 * covers it — so only the third carries an accent border and asks for anything. The direct-deposit
 * line does the real work: it's what lets state two stay quiet.
 *
 * Two layouts. Desktop is the spec's three columns: figure, marks, status. Mobile stacks, and in the
 * action state drops the marks for a large numeral, because at that point the question is "how long
 * do I have", not "where am I in the month".
 */
export default function CycleCard({
  cycle,
  credit,
  expectedDeposit = 0,
  depositOn,
  onRepay,
  variant = 'strip',
}: {
  cycle: Cycle;
  /** Needed to work out what actually has to clear. Without it the cycle reads as fully secured. */
  credit?: Credit;
  /** What's expected to land before the cycle ends — usually the next payday. */
  expectedDeposit?: number;
  /** When that deposit lands, e.g. "Nov 1". Comes from the cash account, not a second field here. */
  depositOn?: string;
  onRepay?: () => void;
  variant?: 'strip' | 'card';
}) {
  const status = cycleStatus(credit, expectedDeposit);
  const toClear = credit ? unsecuredUsed(credit) : 0;
  const shortfall = credit ? cycleShortfall(credit, expectedDeposit) : 0;
  const covered = Math.max(0, toClear - shortfall);

  const label = status === 'secured' ? `${cycle.lengthDays}-day cycle` : 'To clear this cycle';

  const figure =
    status === 'secured' ? (
      <p className="mt-0.5 text-[15px]">Nothing to clear</p>
    ) : (
      <p className="mt-0.5 text-[17px] font-medium tabular-nums">{money(toClear, { cents: true })}</p>
    );

  const good = (
    <span className="flex items-center gap-2 text-[13px] text-tier-savings-fg">
      <CircleCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
      {status === 'secured'
        ? 'In good standing'
        : depositOn
          ? `${depositOn} deposit covers it`
          : 'Your deposit covers it'}
    </span>
  );

  /**
   * The ask. Two lines and a button: what the deposit does handle, what it doesn't, and the way to
   * settle the difference. Naming the covered part matters — without it the shortfall reads as the
   * whole balance.
   */
  const ask = (
    <>
      <p className="text-xs text-muted-foreground">
        {depositOn && expectedDeposit > 0
          ? `${depositOn} deposit covers ${money(covered, { cents: true })}`
          : 'No deposit expected this cycle'}
      </p>
      <p className="mt-0.5 text-xs text-tier-boost-fg tabular-nums">
        {money(shortfall, { cents: true })} short
      </p>
    </>
  );

  const repay = (
    <Button variant="clear" size="xs" onClick={onRepay}>
      Repay
    </Button>
  );

  if (variant === 'card') {
    // The action state is a different card, not the same card tinted: the marks go, a countdown
    // takes their place, and the ask gets its own half below the rule.
    if (status === 'short') {
      return (
        <Card accent>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-foreground-secondary">{label}</p>
              {figure}
            </div>
            <div className="shrink-0 text-center">
              <p className="text-[22px] font-medium leading-none tabular-nums">{cycle.daysLeft}</p>
              <p className="mt-[3px] text-[10px] text-muted-foreground">days left</p>
            </div>
          </div>
          <CardRule className="flex items-center justify-between gap-3">
            <div className="min-w-0">{ask}</div>
            <span className="shrink-0">{repay}</span>
          </CardRule>
        </Card>
      );
    }

    return (
      <Card>
        <div className="mb-2.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-foreground-secondary">{label}</span>
          <span className="tabular-nums">{cycle.daysLeft} days left</span>
        </div>
        {status === 'covered' && (
          <p className="mb-2.5 text-[17px] font-medium tabular-nums">
            {money(toClear, { cents: true })}
          </p>
        )}
        <DayMarks lengthDays={cycle.lengthDays} daysLeft={cycle.daysLeft} size="card" />
        <div className="mt-2.5">{good}</div>
      </Card>
    );
  }

  return (
    <Card
      accent={status === 'short'}
      className="grid grid-cols-[1fr_1.3fr_auto] items-center gap-6 px-[18px] py-3"
    >
      <div>
        <p className="text-xs text-foreground-secondary">{label}</p>
        {figure}
      </div>

      <div>
        <DayMarks lengthDays={cycle.lengthDays} daysLeft={cycle.daysLeft} />
        <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-muted-foreground">Started {cycle.startedOn}</span>
          <span className="tabular-nums">{cycle.daysLeft} days left</span>
        </div>
      </div>

      {status === 'short' ? (
        <div className="flex items-center gap-3">
          <div className="text-right">{ask}</div>
          {repay}
        </div>
      ) : (
        <div className="flex justify-end">{good}</div>
      )}
    </Card>
  );
}
