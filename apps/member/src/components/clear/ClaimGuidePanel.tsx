import { Btn, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { LockIcon, ShieldCheckIcon } from './brand/icons';
import { money } from '@clear/domain';
import { isAssuranceActive, type AssuranceItem, type ClaimRecord, type ClaimStep } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * How to make a claim.
 *
 * A claim is the worst day a member has with Clear, so the page leads with what they can actually
 * claim on — and locked protections are shown as locked rather than hidden. Discovering at the
 * point of need that you were never covered is worse than knowing now, and hiding the locked rows
 * would guarantee the first reading happens at exactly the wrong moment.
 *
 * The record is published with its declines. One in four is turned down, and a member who reads
 * that before they claim is better prepared than one who meets it in a decision letter. A reserve
 * that never says no is not being managed.
 */
export default function ClaimGuidePanel({
  items,
  credits,
  steps,
  record,
  onStart,
}: {
  items: AssuranceItem[];
  credits: number;
  steps: ClaimStep[];
  record: ClaimRecord;
  onStart?: () => void;
}) {
  const active = items.filter((i) => isAssuranceActive(i, credits));
  const locked = items.filter((i) => !isAssuranceActive(i, credits));
  const lockedAt = locked.map((i) => i.unlocksAt.toLocaleString());

  const stat = (label: string, value: string) => (
    <div>
      <Line className="items-baseline!">
        <span className="text-sec">{label}</span>
        <span className="c-fig c-fig-sec">{value}</span>
      </Line>
    </div>
  );

  return (
    <>
      <Cell>
        <CHead>
          <SecHead label="What you can claim on">
            <span className="c-det">
              {active.length} of {items.length} active
            </span>
          </SecHead>
        </CHead>
        <CMain>
          <Rows>
            {active.map((item) => (
              <div key={item.id}>
                <Line className="items-baseline!">
                  <span className="flex min-w-0 items-baseline gap-[9px]">
                    <span className="c-t-ast shrink-0">
                      <ShieldCheckIcon />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sec">{item.name}</span>
                      <span className="c-det mt-[3px] block">{item.description}</span>
                    </span>
                  </span>
                  <span className="c-det c-pos shrink-0">Active</span>
                </Line>
              </div>
            ))}
            {/* Locked ones are summarised rather than listed one by one: the member is here to
                claim, and a full second list would bury the rows they can actually use. */}
            {locked.length > 0 && (
              <div>
                <Line className="items-baseline!" style={{ opacity: 0.6 }}>
                  <span className="flex min-w-0 items-baseline gap-[9px]">
                    <span className="c-muted shrink-0">
                      <LockIcon />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sec">
                        {locked.length === 1 ? 'One more protection' : `${locked.length} more protections`}
                      </span>
                      <span className="c-det mt-[3px] block">
                        Locked until {lockedAt.join(' and ')} credits
                      </span>
                    </span>
                  </span>
                </Line>
              </div>
            )}
          </Rows>
          <p className="c-keyline">
            A protection you have not unlocked cannot be claimed on, even for something that happened
            after you joined.
          </p>
        </CMain>
      </Cell>

      <Cell>
        <CHead>
          <SecHead label="What happens">
            <span className="c-det">{steps.length} steps</span>
          </SecHead>
        </CHead>
        <CMain>
          <div className="c-rail">
            {steps.map((step, i) => (
              <div key={step.id} className={cn('c-mstone', i === steps.length - 1 && 'c-last')}>
                <span className="c-mdot" />
                <div>
                  <p className="text-sec">{step.title}</p>
                  <p className="c-det mt-[3px]">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CMain>
        <CFoot>
          <Btn primary lg onClick={onStart} disabled={active.length === 0}>
            Start a claim
          </Btn>
          {active.length === 0 && (
            <p className="c-det mt-s1">
              Nothing is active yet, so there is nothing to claim on. Grace cycles come first.
            </p>
          )}
        </CFoot>
      </Cell>

      <Cell>
        <CHead>
          <SecHead label="The record">
            <span className="c-det">This year</span>
          </SecHead>
        </CHead>
        <CMain>
          <Rows>
            {stat('Claims paid this year', money(record.paidThisYear))}
            {stat('Average time to a decision', record.decisionTime)}
            {stat('Claims declined', record.declinedOf)}
            {stat('Effect on your credits', record.creditsEffect)}
          </Rows>
          <p className="c-det mt-s2">
            One in four is declined. We publish that because a reserve that never says no is not
            being managed.
          </p>
        </CMain>
      </Cell>
    </>
  );
}
