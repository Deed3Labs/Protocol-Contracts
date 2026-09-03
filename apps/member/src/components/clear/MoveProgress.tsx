import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepState } from '@/lib/moveSteps';

/**
 * What a move looks like while it is happening, and after.
 *
 * A spinner inside the button is too quiet for money moving, so the modal replaces its own
 * content. The member sees what is happening, that it went through, and that they are free to
 * walk away.
 *
 * **Three named steps, not a bare spinner.** They are the three things that actually happen, in
 * order, and somebody who has just handed over money can watch it land. If one stalls, the screen
 * already shows which — a spinner that stalls says only that something is wrong somewhere.
 */

export function Spinner() {
  return (
    <div
      aria-hidden
      className="mx-auto h-11 w-11 animate-spin rounded-full border-[2.5px] border-border border-t-tier-boost"
    />
  );
}

export function Tick() {
  return (
    <div className="mx-auto flex h-[46px] w-[46px] items-center justify-center rounded-full bg-positive/15">
      <Check className="h-[23px] w-[23px] text-positive" strokeWidth={2.5} />
    </div>
  );
}

/**
 * The failure mark, deliberately not a red cross.
 *
 * Nothing went wrong with the member's money — it is still theirs, in the account it started in.
 * A red X would say otherwise before the headline gets a chance to.
 */
export function AlertMark() {
  return (
    <div className="mx-auto flex h-[46px] w-[46px] items-center justify-center rounded-full bg-secondary/60">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-foreground-secondary" aria-hidden>
        <path d="M12 8v5M12 16.5v.01" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    </div>
  );
}

export function Steps({ steps }: { steps: StepState[] }) {
  return (
    <div className="rounded-[10px] border-[0.5px] border-border px-3.5 py-3 text-[12.5px] leading-[2.1]">
      {steps.map((step) => (
        <div
          key={step.label}
          className={cn(
            'flex items-center gap-[9px]',
            step.state === 'done' && 'text-foreground-secondary',
            step.state === 'active' && 'text-foreground',
            step.state === 'waiting' && 'text-muted-foreground',
          )}
        >
          <span className="flex w-[15px] shrink-0 items-center justify-center">
            {step.state === 'done' ? (
              <Check className="h-[13px] w-[13px] text-positive" strokeWidth={3} />
            ) : (
              <span
                className={cn(
                  'inline-block rounded-full',
                  step.state === 'active' ? 'h-[7px] w-[7px] bg-tier-boost' : 'h-1.5 w-1.5 bg-border',
                )}
              />
            )}
          </span>
          {step.label}
        </div>
      ))}
    </div>
  );
}
