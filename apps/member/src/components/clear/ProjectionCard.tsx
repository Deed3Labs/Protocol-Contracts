import { Btn, CFoot, CHead, CMain, Cell, SecHead } from './brand/anatomy';
import { money } from '@clear/domain';
import type { Savings, SavingsProjection } from '@/lib/clearModel';

/**
 * On track for — when the Clear Deed lands at the current rate, and what would move it.
 *
 * The second sentence is the useful half: a date on its own is just a number, but "adding $250.00 a
 * month moves this to Apr 2027" is a decision someone can act on. So the page's one button lives in
 * this footer, beside Adjust auto-save, where both are about the same thing.
 */
export default function ProjectionCard({
  savings,
  projection,
  onAddMoney,
  onAdjust,
}: {
  /** The date lives on the savings itself, so Home and this cell can't disagree. */
  savings: Savings;
  projection: SavingsProjection;
  onAddMoney?: () => void;
  onAdjust?: () => void;
}) {
  return (
    <Cell>
      <CHead>
        <SecHead label="On track for">
          <p className="c-fig c-fig-sec">{savings.onTrackFor ?? '—'}</p>
        </SecHead>
      </CHead>
      <CMain>
        <p className="c-det">
          Based on {money(projection.perPayday, { cents: true })} every payday. Adding{' '}
          {money(projection.extraMonthly, { cents: true })} more each month moves this to {projection.withExtra}.
        </p>
      </CMain>
      <CFoot>
        <div className="c-pair">
          <Btn primary onClick={onAddMoney}>
            Add money
          </Btn>
          <Btn onClick={onAdjust}>Adjust auto-save</Btn>
        </div>
      </CFoot>
    </Cell>
  );
}
