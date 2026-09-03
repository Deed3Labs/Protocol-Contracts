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
