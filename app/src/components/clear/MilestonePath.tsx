import Card from './Card';
import { count } from '@/lib/money';
import { creditsToGo, milestoneStates, type Milestone, type MilestoneState } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const DOT: Record<MilestoneState, string> = {
  done: 'bg-tier-savings border-tier-savings',
  // The ring is what makes "you are here" readable at a glance on a dimmed list.
  current: 'bg-background border-tier-boost ring-[3px] ring-tier-boost/15',
  future: 'bg-background border-muted-foreground/40',
};

const STATUS_TONE: Record<MilestoneState, string> = {
  done: 'text-tier-savings-fg',
  current: 'text-tier-boost-fg',
  future: 'text-muted-foreground',
};

/**
 * "Your path to a home" — design spec §5.
 *
 * A connected timeline rather than a list: the milestones are sequential and the
 * line is what says so. State is derived from the credit balance, so the path
 * can't disagree with the headline.
 *
 * The trailing text differs by state on purpose. A completed step says "Done", the
 * one in progress says how much is left to do, and the ones ahead show their
 * threshold — the number that matters is different depending on where you are.
 */
export default function MilestonePath({
  milestones,
  credits,
}: {
  milestones: Milestone[];
  credits: number;
}) {
  const states = milestoneStates(milestones, credits);

  return (
    <Card className="px-[17px] py-[15px]">
      <p className="mb-3.5 text-[13px] text-foreground-secondary">Your path to a home</p>

      {milestones.map((m, i) => {
        const state = states[i];
        const last = i === milestones.length - 1;

        return (
          <div
            key={m.id}
            className={cn('relative pl-6', last ? 'pb-0' : 'pb-[18px]', state === 'future' && 'opacity-55')}
          >
            {!last && <span aria-hidden className="absolute bottom-[-10px] left-[5px] top-3.5 w-0.5 bg-border" />}
            <span
              aria-hidden
              className={cn('absolute left-0 top-0.5 h-3 w-3 rounded-full border-2', DOT[state])}
            />

            <div className="flex items-baseline justify-between gap-2.5">
              <p className="text-[13px]">{m.title}</p>
              <span className={cn('shrink-0 text-[11px]', STATUS_TONE[state])}>
                {state === 'done' && 'Done'}
                {state === 'current' && `${count(creditsToGo(m.credits, credits))} credits to go`}
                {state === 'future' && `${count(m.credits)} credits`}
              </span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
