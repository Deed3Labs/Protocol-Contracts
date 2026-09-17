import { Bar, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { money, count } from '@clear/domain';
import type { AssuranceReserve } from '@/lib/clearModel';

/**
 * The assurance reserve — the co-op's shared safety fund, and what makes the protections real
 * rather than a promise.
 *
 * Three cells, and the third is the point. A member who reads that the reserve holds $412,800 for
 * 184 people immediately wants to know whether that is a lot, and a page that states a balance
 * without answering has invited the question and walked away. So: what it would owe if everyone
 * claimed their cap in one year, what fraction of that it holds, and the floor the co-op commits
 * to. One ratio, which is what earns it a bar.
 *
 * "Your savings are never used to cover someone else's claim" is a keyline rather than a sentence
 * inside a paragraph. It is the line every member wants and the one they would otherwise have to
 * infer, and keylines are for exactly that.
 */
export default function ReservePanel({
  reserve,
  onReports,
  onClaim,
}: {
  reserve: AssuranceReserve;
  onReports?: () => void;
  onClaim?: () => void;
}) {
  const uncovered = Math.max(0, 100 - reserve.coveredPct);
  const exposure = reserve.membersCovered * reserve.perMemberCap;

  const row = (label: string, detail: string, value: string) => (
    <div>
      <Line className="items-baseline!">
        <div className="min-w-0">
          <p className="text-sec">{label}</p>
          <p className="c-det mt-[3px]">{detail}</p>
        </div>
        <span className="c-fig c-fig-sec">{value}</span>
      </Line>
    </div>
  );

  return (
    <>
      <Cell>
        <CHead>
          <SecHead label="The reserve">
            <span className="c-det">As of {reserve.asOf}</span>
          </SecHead>
        </CHead>
        <CMain>
          <Rows>
            <div>
              <Line className="items-baseline!">
                <span className="text-sec">Reserve balance</span>
                <span className="c-fig c-fig-sec">{money(reserve.balance)}</span>
              </Line>
            </div>
            <div>
              <Line className="items-baseline!">
                <span className="text-sec">Members covered</span>
                <span className="c-fig c-fig-sec">{count(reserve.membersCovered)}</span>
              </Line>
            </div>
            {/* The count sits beside the total: a figure alone says nothing about how often. */}
            {row(
              'Claims paid this year',
              `Across ${count(reserve.claimsPaidCount)} claim${reserve.claimsPaidCount === 1 ? '' : 's'}`,
              money(reserve.claimsPaidThisYear),
            )}
          </Rows>
        </CMain>
        <CFoot>
          <button type="button" onClick={onReports} className="c-line w-full items-center! text-left">
            <span className="text-sec">Reserve reports</span>
            <span className="c-det flex items-center gap-1">
              {reserve.reportCadence}
              <ChevronIcon />
            </span>
          </button>
        </CFoot>
      </Cell>

      <Cell>
        <CHead>
          <SecHead label="Where it comes from">
            <span className="c-det">Not deposits</span>
          </SecHead>
        </CHead>
        <CMain>
          <p className="c-det">
            Retained surplus from lending and card activity.{' '}
            <strong className="font-medium text-ink">Not from member deposits.</strong>
          </p>
          <p className="c-keyline">Your savings are never used to cover someone else&rsquo;s claim.</p>
        </CMain>
        <CFoot>
          <button type="button" onClick={onClaim} className="c-line w-full items-center! text-left">
            <span className="text-sec">How to make a claim</span>
            <ChevronIcon />
          </button>
        </CFoot>
      </Cell>

      {/* The answer runs under both columns: it is about the two figures above it. */}
      <Cell full>
        <CHead>
          <SecHead label="Is it enough?">
            <span className="c-det">Cover ratio</span>
          </SecHead>
        </CHead>
        <CMain>
          <Bar
            className="mb-s2"
            label={`${reserve.coveredPct}% of the annual cap covered`}
            segments={[
              { pct: reserve.coveredPct, color: 'var(--settled)', label: 'Covered' },
              { pct: uncovered, color: 'var(--ink-13)', label: 'Uncovered' },
            ]}
          />
          <p className="c-keyline mb-s3">
            <span className="c-t-sav">Covered</span> <strong>{reserve.coveredPct}%</strong>
            <span className="c-sep">·</span>Policy floor <strong>{reserve.policyFloorPct}%</strong>
          </p>
          <Rows>
            {row('Reserve balance', 'Held in CLRUSD', money(reserve.balance))}
            {row(
              'If every covered member claimed their cap',
              `${count(reserve.membersCovered)} members at ${money(reserve.perMemberCap)} a year`,
              money(exposure),
            )}
            {row('Covered', `Against a policy floor of ${reserve.policyFloorPct}%`, `${reserve.coveredPct}%`)}
          </Rows>
        </CMain>
        {/* The closing note is a footer, like every closing note in the guide — it comments on the
            cell above it rather than being another row inside it. */}
        <CFoot>
          <p className="c-det">
            No reserve covers everyone claiming at once, and one that did would be money sitting idle
            instead of buying homes. The floor is what the co-op commits to hold; the board has to act
            if it is breached.
          </p>
        </CFoot>
      </Cell>
    </>
  );
}
