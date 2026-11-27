import type { NextFunction, Request, Response } from 'express';
import type { Queryable } from '../../../db/db.js';

/**
 * Rate limits on PIN entry (card-processing prompt, Phase 10).
 *
 * A PIN is four digits, so the only defence against guessing is how many guesses a shop allows. A
 * shop is locked once it has had MAX_FAILURES wrong PINs within WINDOW_MS; it opens again as the
 * oldest of them ages out. Counted:
 *
 *   - per shop, not per person: someone guessing doesn't know whose PIN they're guessing
 *   - for every PIN the shop checks, starting a shift and a manager's approval alike
 *   - in the database, so every API instance sees one count and a restart hands out no new guesses
 *   - never cleared by a correct PIN. The in-memory limiter it replaces reset on any success, so a
 *     counter worker could type their own PIN between guesses at a manager's and never be locked.
 */

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

export class PinLocked extends Error {
  constructor(readonly retryInSeconds: number) {
    super(`Too many wrong PINs. Try again in ${Math.max(1, Math.ceil(retryInSeconds / 60))} minutes.`);
    this.name = 'PinLocked';
  }
}

/** Whether the shop can check a PIN now, and if not, how long until it can. */
export async function pinGate(q: Queryable, merchant: string, now = new Date()): Promise<{ allowed: true } | { allowed: false; retryInSeconds: number }> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const { rows } = await q.query<{ at: Date | string }>(
    'SELECT at FROM merchant.pin_failures WHERE merchant = $1 AND at > $2 ORDER BY at DESC LIMIT $3',
    [merchant, since.toISOString(), MAX_FAILURES],
  );
  if (rows.length < MAX_FAILURES) return { allowed: true };
  // Open again when the oldest of the last MAX_FAILURES leaves the window.
  const oldest = new Date(rows[rows.length - 1]!.at).getTime();
  return { allowed: false, retryInSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now.getTime()) / 1000)) };
}

export async function recordPinFailure(q: Queryable, input: { merchant: string; source: 'session' | 'approval'; staffId?: string | null; at?: Date }): Promise<void> {
  await q.query('INSERT INTO merchant.pin_failures (merchant, source, staff_id, at) VALUES ($1, $2, $3, $4)', [
    input.merchant,
    input.source,
    input.staffId ?? null,
    (input.at ?? new Date()).toISOString(),
  ]);
  // Housekeeping: nothing older than a day is needed for the window.
  await q.query(`DELETE FROM merchant.pin_failures WHERE merchant = $1 AND at < now() - interval '1 day'`, [input.merchant]);
}

/**
 * Express error handler: a shop shut for too many wrong PINs, on any path that checks one (a shift,
 * a refund's approval, an override, a void, a sign-off), gets 429 and when to try again. Never
 * "wrong PIN", which would send the writer back to guess.
 */
export function pinLockedHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (!(error instanceof PinLocked)) return next(error);
  res.setHeader('Retry-After', String(error.retryInSeconds));
  res.status(429).json({ error: 'Too many attempts', message: error.message, retryInSeconds: error.retryInSeconds });
}
