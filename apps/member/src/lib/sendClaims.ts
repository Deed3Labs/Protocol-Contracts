import type { PendingClaim } from './clearModel';
import type { SendTransferSummary } from '@/types/send';

/**
 * The oldest send that is locked but not yet collected.
 *
 * Only one is surfaced, because the pages show one strip. Oldest rather than largest: it is the one
 * closest to expiring, and expiry is the thing the member would want to act on.
 */
export function oldestUnclaimed(transfers: SendTransferSummary[]): PendingClaim | undefined {
  const waiting = transfers
    .filter((t) => t.status === 'LOCK_CONFIRMED' || t.status === 'CLAIM_STARTED')
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));

  const next = waiting[0];
  if (!next) return undefined;

  const msLeft = Date.parse(next.expiresAt) - Date.now();
  return {
    amount: Number(next.principalUsdc),
    // The recipient is deliberately not stored in the clear -- the server keeps a hash of the hint,
    // not the phone number -- so the strip names the send rather than the person. The send date is
    // not stored either, so it is left out rather than guessed from the expiry.
    recipient: 'someone you sent to',
    expiresInDays: Math.max(0, Math.ceil(msLeft / 86_400_000)),
  };
}
