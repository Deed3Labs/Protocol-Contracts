/*
 * Face ID at the moment money moves — the "step-up" every banking app does.
 *
 * The lock screen only hides the app. The session is still on the phone underneath it, so the
 * protection that matters is asking again at the point money leaves: a send, a withdrawal, a bill,
 * unfreezing the card or showing its numbers. Every one of those passes through this gate.
 *
 * It is a module rather than a hook because most of the choke points are plain functions
 * (`sendCalls`, `gaslessMoney`, `apiClient`) that cannot call hooks. The signed-in shell registers
 * the verifier; with nothing registered — the preview harness, tests, signed-out pages — the gate
 * is open, because there is nobody to ask.
 *
 * Members WITHOUT Face ID are never blocked here. The verifier lets them through: their protection
 * is the code they entered to get past the lock, and asking for a code on every send would make
 * the app unusable for them. Turning on Face ID is what adds this check.
 *
 * One verification covers the next couple of minutes. Some moves are two signatures (an approve and
 * then a deposit), and unlocking the app is itself a Face ID check — asking again seconds later is
 * friction, not security.
 */

/** Resolves when the member has confirmed, rejects when they have not. */
export type StepUpVerifier = () => Promise<void>;

/** How long one Face ID check covers further money moves. */
export const STEP_UP_GRACE_MS = 2 * 60 * 1000;

export const STEP_UP_DECLINED = 'This needs Face ID. Nothing was changed.';

let verifier: StepUpVerifier | null = null;
let verifiedAt = 0;
/*
 * A decline stands for a moment. Some moves fall back to a second route when the first throws
 * (smart wallet, then relayer), and without this a member who said no would be asked again at once.
 */
let declinedAt = 0;
const DECLINE_HOLDS_MS = 5 * 1000;
let inFlight: Promise<void> | null = null;

export function setStepUpVerifier(next: StepUpVerifier | null): void {
  verifier = next;
}

/** Record a Face ID check made elsewhere (unlocking the app), so it counts toward the grace window. */
export function markStepUpVerified(): void {
  verifiedAt = Date.now();
  declinedAt = 0;
}

export function clearStepUp(): void {
  verifiedAt = 0;
  declinedAt = 0;
}

export class StepUpDeclinedError extends Error {
  constructor() {
    super(STEP_UP_DECLINED);
    this.name = 'StepUpDeclinedError';
  }
}

/** Throws StepUpDeclinedError unless the member confirms (or does not need to). */
export async function requireStepUp(): Promise<void> {
  if (!verifier) return;
  if (Date.now() - verifiedAt < STEP_UP_GRACE_MS) return;
  if (Date.now() - declinedAt < DECLINE_HOLDS_MS) throw new StepUpDeclinedError();
  // Two calls at once (a batch firing two signatures) share one prompt rather than stacking two.
  if (!inFlight) {
    inFlight = verifier()
      .then(() => {
        verifiedAt = Date.now();
      })
      .finally(() => {
        inFlight = null;
      });
  }
  try {
    await inFlight;
  } catch {
    declinedAt = Date.now();
    throw new StepUpDeclinedError();
  }
}

/** The same gate for callers that return failures instead of throwing: a message, or null to go ahead. */
export async function stepUpDenied(): Promise<string | null> {
  try {
    await requireStepUp();
    return null;
  } catch {
    return STEP_UP_DECLINED;
  }
}
