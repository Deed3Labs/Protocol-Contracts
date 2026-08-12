import { CircleCheck, CircleDashed, Circle } from 'lucide-react';
import Card from './Card';
import { count } from '@/lib/money';
import { creditsToGo, milestoneStates, type Milestone, type MilestoneState } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const ICON = { done: CircleCheck, current: CircleDashed, future: Circle } as const;

const ICON_TONE: Record<MilestoneState, string> = {
  done: 'text-tier-savings-fg',
  current: 'text-tier-boost-fg',
  future: 'text-muted-foreground',
};

/**
 * "Your path to a home" — design spec §5.
 *
 * State is derived from the credit balance, so the path can't disagree with the
 * headline. Completed milestones take the success color, the one in progress
 * takes the accent, and everything still ahead sits at half opacity.
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
    <Card>
      <p className="mb-3 text-[13px] text-foreground-secondary">Your path to a home</p>

      <div className="text-xs leading-normal">
        {milestones.map((m, i) => {
          const state = states[i];
          const Icon = ICON[state];
          const toGo = creditsToGo(m.credits, credits);

          return (
            <div
              key={m.id}
              className={cn('flex gap-2.5 pb-3 last:pb-0', state === 'future' && 'opacity-50')}
            >
              <Icon className={cn('mt-px h-[15px] w-[15px] shrink-0', ICON_TONE[state])} strokeWidth={1.75} />
              <div className="min-w-0">
                <p>{m.title}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {count(m.credits)} credits
                  {state === 'done' && ' · done'}
                  {state === 'current' && ` · ${count(toGo)} to go`}
                  {state === 'future' && m.note && ` · ${m.note}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
