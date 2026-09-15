import { Fragment, type ReactNode } from 'react';
import { CFoot, CHead, CMain, Cell, Chip, HeadFig, Line, Panel, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { money } from '@clear/domain';
import {
  activePlans,
  clearsFromLabel,
  hasAmortisingPlan,
  isPlanActive,
  planPerCycle,
  planClearedShare,
  termPlansTotal,
  type TermPlan,
  type TermPlans,
} from '@/lib/clearModel';

/**
 * What a live plan costs and how far through it is, as one line.
 *
 * Assembled from whichever fields the plan has rather than from a fixed template, because the shelf
 * carries two different shapes: an even split counts cycles left, and an amortising plan like an
 * ELPA counts payments made against a schedule that outlives any cycle.
 */
function planDetail(plan: TermPlan): ReactNode {
  const perCycle = planPerCycle(plan);
  const cleared = planClearedShare(plan);

  const parts: ReactNode[] = [
    // A one-cycle plan isn't "split" into anything — it's just cleared.
    plan.splitInto ? (plan.splitInto === 1 ? 'In full' : `Split in ${plan.splitInto}`) : null,
    perCycle !== undefined ? `${money(perCycle, { cents: true })} a cycle` : null,
    // Settled green, because it's the one part of the line that's good news.
    cleared > 0 ? (
      <span key="cleared" className="c-pos">
        {Math.round(cleared * 100)}% cleared
      </span>
    ) : null,
    plan.progressNote,
    plan.rate,
  ].filter(Boolean);

  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      {part}
    </Fragment>
  ));
}

/**
 * Term plans — a cell on Home's slab (`panel` for the standalone form on day one).
 *
 * Everything with a set amount and a schedule lives here, from a tire repair to a mortgage. Rows are
 * a ruled list, so the list visibly ends and the space beneath reads as slack. Locked rows are
 * visible from the first minute, at 60%, each stating its own unlock condition. The footer is the
 * split: the limit on one side of a centred hairline, where it clears from on the other.
 */
export default function TermPlansCard({
  data,
  panel,
  onPlan,
  onLimit,
  onClearsFrom,
}: {
  data: TermPlans;
  /** Draw as a standalone bordered panel instead of a slab cell. */
  panel?: boolean;
  onPlan?: (plan: TermPlan) => void;
  onLimit?: () => void;
  onClearsFrom?: () => void;
}) {
  const total = termPlansTotal(data);
  const scheduled = activePlans(data).length > 0;
  const Frame = panel ? Panel : Cell;

  // A mortgage isn't inside the shelf's cap, so once one is here the header names what it carries
  // instead of comparing against a ceiling that doesn't bound it.
  const amortising = scheduled && hasAmortisingPlan(data);
  const of = !amortising && data.balanceLimit !== undefined ? money(data.balanceLimit, { cents: true }) : undefined;

  return (
    <Frame>
      <CHead>
        <SecHead label="Term plans">
          <HeadFig value={`${money(total, { cents: true })}${amortising ? ' incl. ELPA' : ''}`} of={of} />
        </SecHead>
      </CHead>
      <CMain>
        <Rows ruled>
          {data.plans.map((plan) => {
            const active = isPlanActive(plan);
            // Only a plan whose split can still be changed is worth opening.
            const openable = active && plan.splitInto !== undefined && onPlan;

            const row = (
              <>
                <Line>
                  <span className="text-sec" style={active ? undefined : { lineHeight: 1.3 }}>
                    {plan.name}
                    {plan.openedOn && <span className="c-muted"> &middot; {plan.openedOn}</span>}
                  </span>
                  {active ? (
                    <span className="c-fig c-fig-row">{money(plan.balance ?? 0, { cents: true })}</span>
                  ) : (
                    <Chip tone="neutral">Locked</Chip>
                  )}
                </Line>
                <p className="c-det mt-1">{active ? planDetail(plan) : plan.lockedNote}</p>
              </>
            );

            return openable ? (
              <button key={plan.id} type="button" onClick={() => onPlan?.(plan)} className="block w-full text-left">
                {row}
              </button>
            ) : (
              <div key={plan.id} style={active ? undefined : { opacity: 0.6 }}>
                {row}
              </div>
            );
          })}
        </Rows>
      </CMain>
      <CFoot>
        {scheduled || data.perCycleLimit !== undefined ? (
          <div className="c-foot2 max-lg:[--fp:12px]">
            <button type="button" onClick={onLimit}>
              <p className="c-det">
                <span className="c-muted">Limit</span>{' '}
                <span className="text-ink">
                  {data.perCycleLimit !== undefined ? `${money(data.perCycleLimit, { cents: true })}/cycle` : 'Not set'}
                </span>
              </p>
              <ChevronIcon className="shrink-0 text-ink-50" />
            </button>
            <button type="button" onClick={onClearsFrom}>
              <p className="c-det">
                <span className="c-muted">Clears from</span> <span className="text-ink">{clearsFromLabel(data)}</span>
              </p>
              <ChevronIcon className="shrink-0 text-ink-50" />
            </button>
          </div>
        ) : (
          <p className="c-det">Nothing scheduled yet</p>
        )}
      </CFoot>
    </Frame>
  );
}
