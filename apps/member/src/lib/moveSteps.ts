/**
 * What a move's steps are, and how far along they are.
 *
 * Pure, and separate from the components that draw them — the rules about which step is done, in
 * flight or waiting are testable without a DOM, and the pad component keeps exporting only
 * components.
 */
export type MoveStatus = 'processing' | 'done' | 'failed';

export interface StepState {
  label: string;
  /** `done` has happened, `active` is in flight, `waiting` has not started. */
  state: 'done' | 'active' | 'waiting';
}

/** The steps for a move, given where it is going and how far it has got. */
export function stepsFor(labels: string[], step: number, status: MoveStatus): StepState[] {
  return labels.map((label, index) => ({
    label,
    state:
      status === 'done' || index < step ? 'done' : index === step && status === 'processing' ? 'active' : 'waiting',
  }));
}

/** How long each step shows as in flight, at least, so the dots can be seen to move. */
export const STEP_DWELL_MS = 450;

/**
 * Walks a move's dots forward one at a time.
 *
 * A move is one transaction: the money leaves and arrives in the same block, so there is no event
 * between "taken" and "added" to report. Jumping from the first dot to done read as the dots not
 * working. So the first dot stays in flight while the wallet signs and the chain confirms, and once
 * it has, the rest are walked through in order, each shown briefly -- the last one for as long as
 * any follow-up (recording the credits) actually takes.
 */
export function stepPacer(show: (step: number) => void, dwellMs = STEP_DWELL_MS, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  let current = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    /** Advance to `step`, one dot at a time. Resolves once it is showing and has had its moment. */
    to(step: number): Promise<void> {
      chain = chain.then(async () => {
        while (current < step) {
          current += 1;
          show(current);
          await wait(dwellMs);
        }
      });
      return chain;
    },
  };
}
