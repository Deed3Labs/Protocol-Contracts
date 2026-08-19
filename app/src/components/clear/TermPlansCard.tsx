import { ChevronRight } from 'lucide-react';
import Card from './Card';
import { money } from '@/lib/money';
import {
  activePlans,
  clearsFromLabel,
  hasAmortisingPlan,
  isPlanActive,
  planPerCycle,
  planRemaining,
  termPlansTotal,
  type TermPlan,
  type TermPlans,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * What a live plan costs and how far through it is, as one line.
 *
 * Assembled from whichever fields the plan has rather than from a fixed template, because the shelf
 * carries two different shapes: an even split counts cycles left, and an amortising plan like an
 * ELPA counts payments made against a schedule that outlives any cycle.
 */
function planDetail(plan: TermPlan): string {
  const perCycle = planPerCycle(plan);
  return [
    // A one-cycle plan isn't "split" into anything — it's just cleared.
    plan.splitInto ? (plan.splitInto === 1 ? 'In full' : `Split in ${plan.splitInto}`) : null,
    perCycle !== undefined ? `${money(perCycle, { cents: true })} a cycle` : null,
    plan.cyclesLeft !== undefined ? `${plan.cyclesLeft} left` : null,
    plan.progressNote,
    plan.rate,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One half of the footer. The label sits inline ahead of its value rather than opposite it, so two
 * of these fit side by side on a phone without either becoming a footnote-sized tap target.
 */
function FooterCell({
  label,
  value,
  onSelect,
  className,
}: {
  label: string;
  value: string;
  onSelect?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('flex min-w-0 items-center justify-between gap-1.5 text-left', className)}
    >
      <span className="truncate text-[11.5px]">
        <span className="text-muted-foreground">{label}</span> {value}
      </span>
      <ChevronRight
        className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
        strokeWidth={2.4}
        aria-hidden
      />
    </button>
  );
}

/**
 * Term plans — design spec §4c, the fixed-term shelf.
 *
 * Everything with a set amount and a schedule lives here, from a tire repair to a mortgage. They
 * belong on one shelf because they're one product: what makes something a term plan is what backs
 * it — an ACH authorisation on a linked account — not how big it is.
 *
 * **Locked rows are visible from the first minute**, on both signup paths, and each states its own
 * unlock condition. That's the point of the component rather than a side effect of it: a member who
 * joined at a tire counter should see the home on the same shelf as the repair, and a member who
 * signed up directly should learn what partner credit is before they ever meet a merchant.
 *
 * **No bars anywhere.** Every figure here is an amount or a count, and a bar would imply a ratio
 * that none of these rows actually have.
 */
export default function TermPlansCard({
  data,
  onPlan,
  onLimit,
  onClearsFrom,
  className,
}: {
  data: TermPlans;
  onPlan?: (plan: TermPlan) => void;
  onLimit?: () => void;
  onClearsFrom?: () => void;
  className?: string;
}) {
  const total = termPlansTotal(data);
  const scheduled = activePlans(data).length > 0;

  return (
    <Card className={cn('px-4 py-3.5', className)}>
      <div className="mb-[11px] flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Term plans</span>
        <span className={cn('text-[17px] font-medium tabular-nums', !scheduled && 'text-muted-foreground')}>
          {money(total, { cents: true })}
          {/* A mortgage isn't inside the shelf's cap, so once one is here the headline names what
              it's carrying instead of comparing against a ceiling that doesn't bound it. */}
          {scheduled && hasAmortisingPlan(data) ? (
            <span className="text-[13px] font-normal text-muted-foreground"> incl. ELPA</span>
          ) : (
            scheduled &&
            data.balanceLimit !== undefined && (
              <span className="text-[13px] font-normal text-muted-foreground">
                {' '}
                of {money(data.balanceLimit, { cents: true })}
              </span>
            )
          )}
        </span>
      </div>

      <div className="border-t-[0.5px] border-border">
        {data.plans.map((plan, i) => {
          const active = isPlanActive(plan);
          // Only a plan whose split can still be changed is worth opening.
          const openable = active && plan.splitInto !== undefined && onPlan;

          const row = (
            <>
              <div className="mb-[3px] flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px]">
                  {plan.name}
                  {plan.openedOn && <span className="text-muted-foreground"> · {plan.openedOn}</span>}
                </span>
                {active ? (
                  // What's left, then what it was for. The pair is the point: a member glancing at
                  // the shelf wants to know how much further they have to go, and a lone figure
                  // can't say that without them remembering the original.
                  <span className="shrink-0 text-[13px] tabular-nums">
                    {money(planRemaining(plan), { cents: true })}
                    {plan.splitInto !== undefined && (
                      <span className="text-muted-foreground">
                        {' / '}
                        {money(plan.balance ?? 0, { cents: true })}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Locked</span>
                )}
              </div>
              <p className="text-left text-[11px] text-muted-foreground">
                {active ? planDetail(plan) : plan.lockedNote}
              </p>
            </>
          );

          return (
            <div
              key={plan.id}
              className={cn(
                'py-2.5',
                i < data.plans.length - 1 && 'border-b-[0.5px] border-border',
                // Dimmed rather than hidden: the row is teaching what the member could reach.
                !active && 'opacity-55',
              )}
            >
              {openable ? (
                <button type="button" onClick={() => onPlan?.(plan)} className="block w-full text-left">
                  {row}
                </button>
              ) : (
                row
              )}
            </div>
          );
        })}
      </div>

      {scheduled ? (
        // Two cells, split by a hairline. Both facts are always here — what the member can schedule
        // and where it comes out of — because either alone leaves the other a mystery.
        <div className="mt-3 grid grid-cols-2 border-t-[0.5px] border-border pt-[11px]">
          <FooterCell
            label="Limit"
            value={
              data.perCycleLimit !== undefined
                ? `${money(data.perCycleLimit, { cents: true })}/cycle`
                : 'Not set'
            }
            onSelect={onLimit}
            className="pr-3.5"
          />
          <FooterCell
            label="Clears from"
            value={clearsFromLabel(data)}
            onSelect={onClearsFrom}
            className="border-l-[0.5px] border-border pl-3.5"
          />
        </div>
      ) : (
        <div className="mt-2.5 border-t-[0.5px] border-border pt-2.5">
          <p className="text-[11px] text-muted-foreground">Nothing scheduled yet</p>
        </div>
      )}
    </Card>
  );
}
