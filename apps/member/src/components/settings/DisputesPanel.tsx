import { useState } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { money } from '@clear/domain';
import type { MemberDispute } from '@/lib/clearModel';
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
/** Where a dispute stands, in the member's words. */
function standing(d: MemberDispute): string {
  if (d.status === 'withdrawn') return 'Withdrawn · back in your cycle';
  if (d.status === 'decided') return d.resolution === 'member' ? 'Decided in your favour' : 'Decided against you · back in your cycle';
  if (d.holdState === 'not_held') return 'Open · already claimed, so not held';
  return d.status === 'with_network' ? 'With the card network · amount held' : 'Open · amount held';
}

export default function DisputesPanel({
  intro,
  onRaise,
  onPolicy,
  mine = [],
  onWithdraw,
}: {
  /** The phone's one-line lede under the header title. */
  intro?: boolean;
  onRaise: () => void;
  onPolicy?: () => void;
  /** The member's own disputes. The section only appears when there are some. */
  mine?: MemberDispute[];
  /** Withdraws one; resolves with an error message, or null when it was withdrawn. */
  onWithdraw?: (token: string) => Promise<string | null>;
}) {
  // Withdrawing cannot be undone, so it takes a second tap on the same button.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = mine.filter((d) => d.status === 'open' || d.status === 'with_network').length;

  return (
    <>
      {intro && (
        <p className="c-det mb-s3">Who decides depends on what went wrong, and in two cases out of three it is not Clear.</p>
      )}
      <div className="c-slab c-one">
        {mine.length > 0 && (
          <Cell>
            <CHead>
              <SecHead label="Your disputes">
                <span className="c-det">{open > 0 ? `${open} open` : 'None open'}</span>
              </SecHead>
            </CHead>
            <CMain>
              <Rows>
                {mine.map((d) => {
                  const live = d.status === 'open' || d.status === 'with_network';
                  return (
                    <div key={d.token}>
                      <Line className="items-center!">
                        <div className="min-w-0">
                          <p className="text-sec">
                            {d.subjectLabel} · {money(d.amountCents / 100, { cents: true })}
                          </p>
                          <p className="c-det mt-[3px]">{standing(d)}</p>
                        </div>
                        {live && onWithdraw && (
                          <Btn
                            className="h-[30px]! shrink-0 px-3! text-detail!"
                            disabled={busy === d.token}
                            onClick={() => {
                              if (confirming !== d.token) {
                                setConfirming(d.token);
                                setError(null);
                                return;
                              }
                              setBusy(d.token);
                              void onWithdraw(d.token).then((message) => {
                                setBusy(null);
                                setConfirming(null);
                                setError(message);
                              });
                            }}
                          >
                            {busy === d.token ? 'Withdrawing…' : confirming === d.token ? 'Confirm withdraw' : 'Withdraw'}
                          </Btn>
                        )}
                      </Line>
                    </div>
                  );
                })}
              </Rows>
              {error && <p className="c-det c-errline mt-s2">{error}</p>}
            </CMain>
            <CFoot>
              <p className="c-det">
                Withdrawing puts the amount back in your cycle from today. You cannot raise the same payment again.
              </p>
            </CFoot>
          </Cell>
        )}
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
