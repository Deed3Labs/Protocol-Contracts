import { useState } from 'react';
import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Btn, Line, Rows, Track } from './brand/anatomy';
import { cn } from '@/lib/utils';
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
  onPayBack,
}: {
  data: TermPlans;
  /** Pays back what a default wrote off. Absent in the preview harness. */
  onPayBack?: (amount: number, remaining: number) => Promise<{ repaid?: number; error?: string }>;
  /** No longer offered: the sheet is a disclosure, and linked accounts are managed from Clears from. */
  onManageAccounts?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const limit = data.perCycleLimit;
  const committed = termPlansPerCycle(data);
  const free = limit !== undefined ? Math.max(0, limit - committed) : undefined;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  /*
   * Paused by a default: the sheet is about getting term plans back, not about a limit that is
   * zero until then. Two ways back, both stated -- paying back what was written off (now), or six
   * clean cycles (the co-op restores it). A new limit is set from income once it is lifted.
   */
  if (data.paused) {
    const owed = data.paused.toPayBack;
    const payBack = async () => {
      if (!onPayBack || owed <= 0) return;
      setBusy(true);
      setNote(null);
      const result = await onPayBack(owed, owed);
      setBusy(false);
      setNote(
        result.repaid
          ? { text: `Paid back ${money(result.repaid, { cents: true })}. Term plans are back once your limit is set again.`, bad: false }
          : { text: result.error ?? 'That did not go through. Nothing was paid.', bad: true },
      );
    };
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Term plans are paused"
        description="A plan fell two installments behind and was written off. Your card, savings and membership are untouched."
        footer={
          <>
            {note && <p className={cn('c-det', note.bad && 'c-errline')}>{note.text}</p>}
            <Btn primary lg className="mt-s2" disabled={!onPayBack || owed <= 0 || busy} onClick={() => void payBack()}>
              {busy ? 'Paying…' : `Pay back ${money(owed, { cents: true })}`}
            </Btn>
          </>
        }
      >
        <p className="c-label">Left to pay back</p>
        <BigAmount amount={owed} />
        <Rows className="mt-s2">
          <div>
            <Line>
              <span className="c-sub">Pay it back</span>
              <span className="c-det">Term plans return straight away</span>
            </Line>
          </div>
          <div>
            <Line>
              <span className="c-sub">Or six clean cycles</span>
              <span className="c-det">The co-op restores them</span>
            </Line>
          </div>
        </Rows>
      </Modal>
    );
  }

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
