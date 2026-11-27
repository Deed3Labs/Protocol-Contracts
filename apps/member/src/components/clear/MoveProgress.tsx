import { AlertIcon, TickIcon } from './brand/icons';
import { cn } from '@/lib/utils';
import type { StepState } from '@/lib/moveSteps';

/**
 * What a move looks like while it is happening, and after.
 *
 * A spinner inside the button is too quiet for money moving, so the modal replaces its own
 * content. **Three named steps, not a spinner**: they are the three things that actually happen, in
 * order, and a live dot on the one in progress already says working — more precisely, because if one
 * stalls the screen shows which.
 */

/** The done mark: a settled tick, no circle. */
export function Tick() {
  return <TickIcon size={34} strokeWidth={2.4} className="mx-auto text-settled" />;
}

/**
 * The failure mark, deliberately not a red cross.
 *
 * Nothing went wrong with the member's money — it is still theirs, in the account it started in.
 * A red X would say otherwise before the headline gets a chance to.
 */
export function AlertMark() {
  return <AlertIcon className="mx-auto text-ink-50" />;
}

export function Steps({ steps }: { steps: StepState[] }) {
  return (
    <div className="c-steps">
      {steps.map((step) => (
        <div key={step.label} className={cn(step.state === 'done' && 'c-ok', step.state === 'active' && 'c-on')}>
          <span className="c-marker">
            {step.state === 'done' ? (
              <TickIcon className="text-settled" />
            ) : step.state === 'active' ? (
              <span className="c-core c-ping text-settled" />
            ) : (
              <span className="c-pend" />
            )}
          </span>
          {step.label}
        </div>
      ))}
    </div>
  );
}
