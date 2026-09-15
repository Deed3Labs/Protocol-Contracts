import { Btn, CFoot, CMain, Line, Panel } from './brand/anatomy';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import {
  cycleStatus,
  orderedTiers,
  SECURED_TIERS,
  securedUsed,
  unsecuredUsed,
  type Credit,
  type Cycle,
} from '@/lib/clearModel';

/**
 * The cycle — the first block on Home.
 *
 * Main never changes shape: the label "To clear this cycle", an amount beneath it, the days left
 * opposite. **The label is fixed and the number never becomes prose**, so the eye lands in the same
 * place every time. The footer changes job with the state, and the border carries the state with the
 * countdown taking the same colour:
 *
 *   1 short    — cobalt border and countdown, filled Repay. The only state that asks for anything,
 *                and the only place cobalt appears on Home.
 *   2 covered  — default border; the button is a ghost on purpose, because nothing is required.
 *   3 secured  — default border, filled Top off. Deliberately not green: nothing is owed, but savings
 *                have been drawn down, which pauses housing progress.
 *   4 clear    — settled green. The footer moves from what you owe to what is next.
 *
 * The amount is the *unsecured* draw and never the full carried balance: secured credit is covered by
 * collateral the co-op already holds, and printing the total would make it look like a debt problem.
 */
export default function CycleCard({
  cycle,
  credit,
  expectedDeposit = 0,
  depositOn,
  onRepay,
  onTopOff,
}: {
  cycle: Cycle;
  /** Needed to work out what actually has to clear. Without it the cycle reads as fully clear. */
  credit?: Credit;
  /** What's expected to land before the cycle ends — usually the next payday. */
  expectedDeposit?: number;
  /** When that deposit lands, e.g. "Nov 1". Comes from the cash account, not a second field here. */
  depositOn?: string;
  /** Repay and Repay early. */
  onRepay?: () => void;
  /** Top off and Add to savings — both put money back into savings. */
  onTopOff?: () => void;
}) {
  const isDesktop = useIsDesktop();
  const status = cycleStatus(credit, expectedDeposit);
  const toClear = credit ? unsecuredUsed(credit) : 0;

  // The rate that applies to what's carried unsecured: the dearest unsecured tier with a draw on it,
  // since that is the one clearing it pays down first.
  const carriedRate = credit
    ? orderedTiers(credit.tiers)
        .filter((t) => !SECURED_TIERS.includes(t.key) && t.used > 0)
        .at(-1)?.rate
    : undefined;

  let lead: string;
  let detail: string;
  let action: { label: string; primary: boolean; onSelect?: () => void };

  switch (status) {
    case 'short':
      lead = 'Nothing scheduled to cover it';
      detail = `Carrying ${money(toClear, { cents: true })} unsecured${carriedRate ? ` · ${carriedRate}` : ''}`;
      action = { label: 'Repay', primary: true, onSelect: onRepay };
      break;
    case 'covered':
      lead = depositOn ? `Your ${depositOn} deposit covers this` : 'Your deposit covers this';
      detail = `Carrying ${money(toClear, { cents: true })} unsecured · nothing due`;
      action = { label: 'Repay early', primary: false, onSelect: onRepay };
      break;
    case 'secured': {
      const carry = money(credit?.carryCost ?? 0, { cents: true });
      const drawn = money(credit ? securedUsed(credit) : 0, { cents: true });
      lead = isDesktop ? `Using ${drawn} of your own savings` : `Using ${drawn} of your savings`;
      detail = isDesktop
        ? `Nothing owed · credits paused while drawn · carry ${carry}`
        : `Nothing owed · credits paused · carry ${carry}`;
      action = { label: 'Top off', primary: true, onSelect: onTopOff };
      break;
    }
    default:
      lead = 'Nothing carried this cycle';
      detail = [
        cycle.lastClearedOn ? `Last cleared ${cycle.lastClearedOn}` : null,
        depositOn ? `nothing due ${depositOn}` : 'nothing due',
      ]
        .filter(Boolean)
        .join(' · ');
      // Capitalise when "Last cleared" isn't there to lead the line.
      detail = detail.charAt(0).toUpperCase() + detail.slice(1);
      action = { label: 'Add to savings', primary: true, onSelect: onTopOff };
  }

  return (
    <Panel act tone={status === 'short' ? 'short' : status === 'clear' ? 'clear' : undefined}>
      <CMain>
        <Line className="items-center!">
          <div>
            <p className="c-label">To clear this cycle</p>
            <p className="c-fig c-fig-sec mt-[6px]">{money(toClear, { cents: true })}</p>
          </div>
          <div className="text-right">
            <p className="c-fig c-cyc-num text-[24px] leading-none lg:text-[26px]">{cycle.daysLeft}</p>
            <p className="c-det mt-1">days left</p>
          </div>
        </Line>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <div className="min-w-0">
            <p className="text-detail lg:text-sec">{lead}</p>
            <p className="c-det mt-[3px]">{detail}</p>
          </div>
          <Btn primary={action.primary} className={action.primary ? 'max-lg:px-s2!' : undefined} onClick={action.onSelect}>
            {action.label}
          </Btn>
        </Line>
      </CFoot>
    </Panel>
  );
}
