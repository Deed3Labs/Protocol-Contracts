import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from '@/components/clear/Card';
import InfoBlock from '@/components/clear/InfoBlock';
import type { Ballot, PastVote } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Votes open and closed — design spec §10.
 *
 * The open vote takes the accent card and the only button on the page; past ones
 * are a list. Whether you voted is shown plainly rather than hidden: turnout is
 * the thing that makes one-member-one-vote mean anything, and a member who
 * skipped the last two should see that.
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
        <Card accent className="mb-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-tier-boost-fg">Open now</span>
            <span className="text-muted-foreground">Closes in {ballot.closesInDays} days</span>
          </div>
          <p className="mb-3 text-[13px]">{ballot.question}</p>
          <Button variant="clear" size="xs" className="w-full border-tier-boost/30" onClick={onVote}>
            Cast your vote
          </Button>
        </Card>
      ) : (
        <Card className="mb-4">
          <p className="text-xs text-muted-foreground">
            Nothing open right now. Members are notified when a vote opens.
          </p>
        </Card>
      )}

      <p className="mb-0.5 text-[11px] text-foreground-secondary">Past</p>
      <div className="text-[13px]">
        {pastVotes.map((vote, i) => (
          <div
            key={vote.id}
            className={cn(
              'flex items-center justify-between gap-3 py-2.5',
              i < pastVotes.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <div className="min-w-0">
              <p className="truncate">{vote.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{vote.detail}</p>
            </div>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 text-[11px]',
                vote.participated ? 'text-tier-savings-fg' : 'text-muted-foreground',
              )}
            >
              {vote.participated && (
                <CircleCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              )}
              {vote.participated ? 'Voted' : 'Did not vote'}
            </span>
          </div>
        ))}
      </div>

      <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
        One member, one vote — regardless of balance.
      </InfoBlock>
    </>
  );
}
