/** What the rewards services refuse with, and the HTTP status each means. */
export class RewardsError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid' | 'forbidden' | 'scope' | 'conflict' | 'not_joined' | 'needs_clear' | 'limit' | 'expired' | 'not_enough' | 'unavailable',
  ) {
    super(message);
  }
}

export const REWARDS_STATUS: Record<RewardsError['code'], number> = {
  not_found: 404,
  invalid: 422,
  forbidden: 403,
  // A token for one shop asking about another, or the hub's asking for a shop's.
  scope: 403,
  conflict: 409,
  not_joined: 409,
  // "Complete account onboarding before using this feature": the app shows Set up Clear.
  needs_clear: 403,
  limit: 409,
  expired: 410,
  not_enough: 409,
  unavailable: 503,
};
