import { CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import type { ReserveReports } from '@/lib/clearModel';

/**
 * Reserve reports — what the reserve held, what it paid out, and who checked it.
 *
 * The second cell carries the part that matters most and is easiest to leave out: these are
 * prepared by Clear and reviewed, not independently audited. A co-op this size is not required to
 * be, and saying so plainly is cheaper than letting a member assume otherwise and find out later —
 * which is the kind of thing they find out on the day they most need to trust the figure.
 */
export default function ReserveReportsPanel({
  reports,
  onSubscribe,
}: {
  reports: ReserveReports;
  onSubscribe?: () => void;
}) {
  return (
    <>
      <Cell>
        <CHead>
          <SecHead label="Quarterly statements">
            <span className="c-det">{reports.statements.length} published</span>
          </SecHead>
        </CHead>
        <CMain>
          <Rows>
            {reports.statements.map((statement) => (
              <div key={statement.id}>
                <Line className="items-baseline!">
                  <div className="min-w-0">
                    <p className="text-sec">{statement.period}</p>
                    <p className="c-det mt-[3px]">
                      {statement.publishedOn} · {statement.note}
                    </p>
                  </div>
                </Line>
              </div>
            ))}
          </Rows>
        </CMain>
        <CFoot>
          <Line className="items-center!">
            <span className="c-det">{reports.cadence}</span>
            <button type="button" className="c-det hover:text-ink" onClick={onSubscribe}>
              Get them by email
            </button>
          </Line>
        </CFoot>
      </Cell>

      <Cell>
        <CHead>
          <SecHead label="What these are">
            <span className="c-det">Not audited</span>
          </SecHead>
        </CHead>
        <CMain>
          <p className="c-det">{reports.contains}</p>
          {/* The reviewer is still a placeholder, and renders as written: a claim about who checks
              the money is the last thing to invent. */}
          <p className="c-keyline">{reports.reviewedBy}</p>
        </CMain>
      </Cell>
    </>
  );
}
