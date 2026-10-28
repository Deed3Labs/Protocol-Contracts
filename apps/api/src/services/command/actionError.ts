/** An action refused for a reason the person can fix: its status, a code, and what to say. */
export class ActionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
