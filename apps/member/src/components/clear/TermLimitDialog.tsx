import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Line, Rows, Track } from './brand/anatomy';
import { money } from '@clear/domain';
import { activePlans, planPerCycle, termPlansPerCycle, type TermPlans } from '@/lib/clearModel';

/**
 * Term plan limit — behind Limit in the Term plans footer.
 *
 * A disclosure, not a setting: what the ceiling is, what is already committed against it and to
 * what, and what a new plan could still add. The figure comes from observed income, so the footer
 * says so plainly rather than offering a control that would not do anything.
 */
export default function TermLimitDialog({
  data,
  open,
  onOpenChange,
}: {
  data: TermPlans;
  /** No longer offered: the sheet is a disclosure, and linked accounts are managed from Clears from. */
  onManageAccounts?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const limit = data.perCycleLimit;
  const committed = termPlansPerCycle(data);
  const free = limit !== undefined ? Math.max(0, limit - committed) : undefined;
  const parts = activePlans(data)
    .map((p) => ({ name: p.name, perCycle: planPerCycle(p) }))
    .filter((p): p is { name: string; perCycle: number } => p.perCycle !== undefined && p.perCycle > 0);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Term plan limit"
      description="The most you can commit to term plans each cycle, and what is already committed."
      footer={
        <>
          <Line>
            <span className="c-sub">Set from</span>
            <span className="c-det">Observed income, not a credit score</span>
          </Line>
          <p className="c-det mt-s1">It moves when your income does. Clearing a plan early frees its share straight away.</p>
        </>
      }
    >
      <p className="c-label">Most you can commit each cycle</p>
      {limit !== undefined ? (
        <>
          <BigAmount amount={limit} />
          <div className="mt-s3">
            <Track
              label={`${money(committed, { cents: true })} of ${money(limit, { cents: true })} committed`}
              pct={limit > 0 ? (committed / limit) * 100 : 0}
              color="var(--tier-income)"
            />
          </div>
          <Rows className="mt-s2">
            <div>
              <Line>
                <span className="c-sub">Committed now</span>
                <span className="c-fig c-fig-row">{money(committed, { cents: true })}</span>
              </Line>
              {parts.length > 0 && (
                <p className="c-det mt-[3px]">
                  {parts.map((p) => `${p.name} ${money(p.perCycle, { cents: true })}`).join(' · ')}
                </p>
              )}
            </div>
            <div>
              <Line>
                <span className="c-sub">Free this cycle</span>
                <span className="c-fig c-fig-row">{money(free ?? 0, { cents: true })}</span>
              </Line>
              <p className="c-det mt-[3px]">The most a new plan can add</p>
            </div>
          </Rows>
        </>
      ) : (
        <p className="c-det mt-s1">Not set yet. It is worked out from the income landing in a linked account.</p>
      )}
    </Modal>
  );
}
