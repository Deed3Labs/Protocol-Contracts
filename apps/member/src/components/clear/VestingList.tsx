import { CFoot, CHead, CMain, Cell, Line, SecHead } from './brand/anatomy';
import { count } from '@clear/domain';
import type { VestingRow } from '@/lib/clearModel';

/**
 * Credits vesting — dated future rows, nothing retrospective.
 *
 * The header totals what is vesting and when the last of it lands, a number the old page never
 * summed. The footer says when the next one arrives.
 */
export default function VestingList({ rows }: { rows: VestingRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.credits, 0);
  const last = rows.at(-1);

  return (
    <Cell>
      <CHead>
        <SecHead label="Credits vesting">
          {last ? (
            <p className="c-fig c-fig-sec">
              {count(total)} <span className="c-of">by {last.date}</span>
            </p>
          ) : (
            <span className="c-det">None yet</span>
          )}
        </SecHead>
      </CHead>
      <CMain>
        {rows.length === 0 ? (
          <p className="c-det">Nothing vesting yet — credits start vesting after your first deposit.</p>
        ) : (
          rows.map((row) => (
            <Line key={row.id}>
              <span className="c-sub">{row.date}</span>
              <span className="c-fig c-fig-row">{count(row.credits)} credits</span>
            </Line>
          ))
        )}
      </CMain>
      {rows.length > 0 && (
        <CFoot>
          <Line className="items-center!">
            <span className="c-det">Next on {rows[0].date} &middot; vests on payday</span>
          </Line>
        </CFoot>
      )}
    </Cell>
  );
}
