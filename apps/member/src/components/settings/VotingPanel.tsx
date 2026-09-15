import { Btn, CMain, Rows } from '@/components/clear/brand/anatomy';
import { Done, Pane, TwoLineRow } from './SettingsKit';
import type { Ballot, PastVote } from '@/lib/clearModel';

/**
 * Votes open and closed.
 *
 * The open vote is the one raised component and the only primary button on the page; past ones are
 * a list. Whether you voted is shown plainly: turnout is what makes one-member-one-vote mean
 * anything.
 */
export default function VotingPanel({
  ballot,
  pastVotes,
  onVote,
}: {
  ballot?: Ballot;
  pastVotes: PastVote[];
  onVote?: () => void;
}) {
  return (
    <>
      {ballot ? (
        <div className="c-panel c-act">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Open now</p>
              <span className="c-det">Closes in {ballot.closesInDays} days</span>
            </div>
          </div>
          <CMain>
            <p className="text-sec">{ballot.question}</p>
          </CMain>
          <div className="c-cfoot">
            <Btn primary lg onClick={onVote}>
              Cast your vote
            </Btn>
          </div>
        </div>
      ) : (
        <Pane>
          <CMain>
            <p className="c-det">Nothing open right now. Members are notified when a vote opens.</p>
          </CMain>
        </Pane>
      )}

      <Pane
        label="Past"
        className="mt-s3"
        foot={<p className="c-det">One member, one vote, regardless of balance.</p>}
      >
        <CMain>
          <Rows>
            {pastVotes.map((vote) => (
              <div key={vote.id}>
                <TwoLineRow
                  title={vote.title}
                  detail={vote.detail}
                  trailing={
                    <span className="c-det shrink-0">{vote.participated ? <Done>Voted</Done> : 'Did not vote'}</span>
                  }
                />
              </div>
            ))}
          </Rows>
        </CMain>
      </Pane>
    </>
  );
}
