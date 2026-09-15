import { CFoot, CHead, CMain, Cell, HeadFig, Line, SecHead, Track } from './brand/anatomy';
import { count } from '@clear/domain';
import { creditsToGo, milestoneStates, type Milestone, type Savings } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Path to a home — the credits and the thresholds that produce them, as one cell.
 *
 * Header: the figure, "1,500 of 15,000". Main: the track, then the milestone rail on the guide's own
 * dot — done is a filled settled circle, the current step is cobalt with the dot's glow, later steps
 * an ink-28 outline at 60%. Footer: where it ends and how many steps are behind the member.
 *
 * The trailing text differs by state on purpose: a finished step says Done, the one in progress says
 * how much is left, and the ones ahead show their threshold. Milestone amounts are nowrap, so a long
 * step name breaks its own line instead of splitting the figure beside it. State is derived from the
 * credit balance, so the path can't disagree with the header.
 */
export default function MilestonePath({ milestones, savings }: { milestones: Milestone[]; savings: Savings }) {
  const { credits, creditsGoal } = savings;
  const states = milestoneStates(milestones, credits);
  const done = states.filter((s) => s === 'done').length;

  return (
    <Cell>
      <CHead>
        <SecHead label="Path to a home">
          <HeadFig value={count(credits)} of={count(creditsGoal)} />
        </SecHead>
      </CHead>
      <CMain>
        <div className="mb-s3">
          <Track
            label={`${count(credits)} of ${count(creditsGoal)} credits`}
            pct={creditsGoal > 0 ? (credits / creditsGoal) * 100 : 0}
            color="var(--tier-savings)"
          />
        </div>
        <div className="c-rail">
          {milestones.map((m, i) => {
            const state = states[i];
            return (
              <div
                key={m.id}
                className={cn(
                  'c-mstone',
                  state === 'done' && 'c-done',
                  state === 'current' && 'c-now',
                  state === 'future' && 'c-later',
                  i === milestones.length - 1 && 'c-last',
                )}
              >
                <span className="c-mdot" />
                <Line>
                  <span className="text-sec">{m.title}</span>
                  {state === 'done' && <span className="c-det c-pos">Done</span>}
                  {state === 'current' && (
                    <span className="c-det text-live">{count(creditsToGo(m.credits, credits))} credits to go</span>
                  )}
                  {state === 'future' && <span className="c-det c-muted">{count(m.credits)} credits</span>}
                </Line>
              </div>
            );
          })}
        </div>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Clear Deed at {count(creditsGoal)}</span>
          <span className="c-det">
            {done} of {milestones.length} done
          </span>
        </Line>
      </CFoot>
    </Cell>
  );
}
