/** What the Terminal services refuse with, and the HTTP status each means. */
export class TerminalError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid' | 'taken' | 'expired' | 'forbidden' | 'conflict' | 'needs_connection',
  ) {
    super(message);
  }
}

export const TERMINAL_STATUS: Record<TerminalError['code'], number> = {
  not_found: 404,
  invalid: 422,
  taken: 409,
  expired: 410,
  forbidden: 403,
  conflict: 409,
  needs_connection: 409,
};
