import { Btn, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { KvRow, RowChevron } from './SettingsKit';
import { DISPUTE_INDEPENDENCE, DISPUTE_KINDS, DISPUTE_WHILE_OPEN } from '@/data/clearPlaceholder';

/**
 * Dispute resolution — the page that decides whether a member trusts the co-op when something goes
 * wrong.
 *
 * The structure is the argument: who decides changes with what went wrong, and in two cases out of
 * three it is not Clear. The second cell answers what a member actually asks while waiting — am I
 * being charged for this? — and the third says why Clear stays out of disputes between members,
 * rather than only that it does.
 */
export default function DisputesPanel({
  intro,
  onRaise,
  onPolicy,
}: {
  /** The phone's one-line lede under the header title. */
  intro?: boolean;
  onRaise: () => void;
  onPolicy?: () => void;
}) {
  return (
    <>
      {intro && (
        <p className="c-det mb-s3">Who decides depends on what went wrong, and in two cases out of three it is not Clear.</p>
      )}
      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label="Three kinds">
              <span className="c-det">Who decides</span>
            </SecHead>
          </CHead>
          <CMain>
            <Rows>
              {DISPUTE_KINDS.map((k) => (
                <div key={k.kind}>
                  <Line className="items-start!">
                    <div className="min-w-0">
                      <p className="text-sec">{k.title}</p>
                      <p className="c-det mt-[3px]">{k.detail}</p>
                      <p className="c-det mt-[6px] text-ink-70!">{k.whoDecides}</p>
                    </div>
                    <span className="c-det shrink-0">{k.takes}</span>
                  </Line>
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            <Btn primary lg onClick={onRaise}>
              Raise a dispute
            </Btn>
          </CFoot>
        </Cell>

        <Cell>
          <CHead>
            <SecHead label="While it is open">
              <span className="c-det">What happens</span>
            </SecHead>
          </CHead>
          <CMain>
            <p className="c-keyline mb-s3">
              You are not charged carry on a disputed amount, and a dispute never counts against your cycle.
            </p>
            <Rows>
              {DISPUTE_WHILE_OPEN.map((row) => (
                <div key={row.label}>
                  <KvRow label={row.label} value={row.value} />
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            <p className="c-det">
              If the decision goes against you, the amount returns to your cycle with the time it spent in dispute
              added back.
            </p>
          </CFoot>
        </Cell>

        <Cell>
          <CHead>
            <SecHead label="Why not Clear">
              <span className="c-det">Member to member</span>
            </SecHead>
          </CHead>
          <CMain>
            <p className="c-keyline mb-s3">
              A co-op judging between two of its own members is a conflict. <strong>So it does not.</strong>{' '}
              Member-to-member disputes go to an independent third party, and Clear is bound by the outcome the same as
              you are.
            </p>
            <Rows>
              {DISPUTE_INDEPENDENCE.map((row) => (
                <div key={row.label}>
                  <KvRow label={row.label} value={row.value} />
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            <button type="button" onClick={onPolicy} className="c-line w-full items-center! text-left">
              <span className="text-sec">Read the dispute policy</span>
              <RowChevron />
            </button>
          </CFoot>
        </Cell>
      </div>
    </>
  );
}
