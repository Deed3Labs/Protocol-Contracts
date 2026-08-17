import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import { money } from '@/lib/money';
import { cycleShortfall, cycleStatus, securedUsed, unsecuredUsed, type Credit, type Cycle } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The cycle — design spec §4b. Shown only once the member is in use; day one has no cycle running.
 *
 * One component, two rows, identical on desktop and mobile. The top row never changes shape: the
 * same label, an amount in the same place, and the days left. **The label is fixed and the amount
 * never becomes prose** — nothing to clear reads `$0.00`, not "Nothing to clear" — so the eye lands
 * on the same spot every time and a member learns where to look once rather than reading the card
 * afresh each cycle.
 *
 * The amount is the *unsecured* draw and never the full carried balance. Savings- and asset-backed
 * credit is covered by collateral the co-op already holds, so a default settles from that; printing
 * the total here would make secured borrowing look like a debt problem.
 *
 * Only the second row varies, and the border says how much attention the card wants: accent when
 * something is needed, default when nothing is required, green only when nothing is carried at all.
 */
export default function CycleCard({
  cycle,
  credit,
  expectedDeposit = 0,
  depositOn,
  onRepay,
}: {
  cycle: Cycle;
  /** Needed to work out what actually has to clear. Without it the cycle reads as fully clear. */
  credit?: Credit;
  /** What's expected to land before the cycle ends — usually the next payday. */
  expectedDeposit?: number;
  /** When that deposit lands, e.g. "Nov 1". Comes from the cash account, not a second field here. */
  depositOn?: string;
  /** Every action on this card opens the same surface; only the label changes. */
  onRepay?: () => void;
  className?: string;
}) {
  const status = cycleStatus(credit, expectedDeposit);
  const toClear = credit ? unsecuredUsed(credit) : 0;
  const shortfall = credit ? cycleShortfall(credit, expectedDeposit) : 0;
  const covered = Math.max(0, toClear - shortfall);

  const action = (label: string) => (
    <Button variant="clear" size="xs" className="shrink-0" onClick={onRepay}>
      {label}
    </Button>
  );

  const good = (text: string) => (
    <span className="flex items-center gap-2 text-xs text-tier-savings-fg lg:text-[13px]">
      <CircleCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
      {text}
    </span>
  );

  return (
    <Card
      accent={status === 'short'}
      // Green is reserved for carrying nothing at all — see cycleStatus.
      className={cn('px-[18px] py-3.5', status === 'clear' && 'border-tier-asset')}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-foreground-secondary">To clear this cycle</p>
          <p className="mt-[3px] text-xl font-medium tabular-nums lg:text-[22px]">
            {money(toClear, { cents: true })}
          </p>
        </div>
        <div className="shrink-0 text-center">
          <p className="text-[23px] font-medium leading-none tabular-nums lg:text-[26px]">
            {cycle.daysLeft}
          </p>
          <p className="mt-[3px] text-[10px] text-muted-foreground lg:text-[11px]">days left</p>
        </div>
      </div>

      <CardRule className="flex items-center justify-between gap-3">
        {status === 'short' && (
          <>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground lg:text-xs">
                {depositOn && expectedDeposit > 0 ? (
                  <>
                    {depositOn}
                    <span className="hidden lg:inline"> deposit</span> covers{' '}
                    {money(covered, { cents: true })}
                  </>
                ) : (
                  'No deposit expected this cycle'
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-tier-boost-fg tabular-nums lg:text-xs">
                {money(shortfall, { cents: true })} short
              </p>
            </div>
            {action('Repay')}
          </>
        )}

        {status === 'covered' && (
          <>
            {good(depositOn ? `${depositOn} deposit covers it` : 'Your deposit covers it')}
            {action('Repay early')}
          </>
        )}

        {/* Nothing is owed, but this isn't "clear": it pauses housing progress and accrues carry on
            the asset-backed part. "Top off" rather than "pay down" — they didn't borrow. */}
        {status === 'secured' && credit && (
          <>
            <div className="min-w-0">
              <p className="text-xs lg:text-[13px]">
                Using {money(securedUsed(credit), { cents: true })} of your
                <span className="hidden lg:inline"> own</span> savings
              </p>
              {/* Naming the paused credits is the whole reason this state isn't green: nothing is
                  owed, but housing progress has stopped for as long as the savings are drawn. */}
              <p className="mt-[3px] text-[11px] text-muted-foreground">
                Nothing owed · credits paused<span className="hidden lg:inline"> while drawn</span> ·
                carry {money(credit.carryCost, { cents: true })}
              </p>
            </div>
            {action('Top off')}
          </>
        )}

        {status === 'clear' && good('All clear · nothing carried')}
      </CardRule>
    </Card>
  );
}
