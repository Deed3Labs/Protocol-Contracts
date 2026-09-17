import { reconcile, type ReconcileOutcome } from './authStore.js';

/*
 * What a card transaction currently holds, and putting our ledger back in step with it.
 *
 * The auth stream answers one question at one instant: may this card spend this amount. Everything
 * after that arrives here — the reversal, the void, the clearing that is not the figure anybody
 * authorized — and until now nothing was listening. The draw went out and never came back.
 *
 * These events are the only way Lithic tells us. There is no polling equivalent worth having: the
 * transaction is authoritative, it is delivered when it changes, and it carries the amount rather
 * than a description of the change.
 */

/** Terminal states that hold nothing at all, whatever the amount fields happen to say. */
const HOLDS_NOTHING = new Set(['VOIDED', 'EXPIRED', 'DECLINED', 'REVERSED']);

function centsOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * How much this transaction holds, in cents — or null when the payload does not say.
 *
 * Two response shapes, because Lithic has two and the sandbox this runs against serves the older
 * one. Verified against a real transaction rather than assumed:
 *
 *  - Current shape: `pending_amount` + `settled_amount`, the pair the dashboard labels "amount
 *    authorized" and "amount cleared". An open authorization is all pending, a settled one has moved
 *    across, a partly cleared one is genuinely the sum.
 *  - Legacy shape: no `pending_amount` at all. `amount` is the authoritative running figure there —
 *    it read 500 while the $5 test was pending and 0 once it was voided.
 *
 * Summing the pair on the legacy shape is the trap this is written around: `pending_amount` comes
 * back undefined, the sum collapses to `settled_amount`, and a live authorization reads as zero —
 * which would release the draw and hand a member money they are still spending.
 *
 * **Null is not zero.** A payload we cannot read must never be treated as a transaction holding
 * nothing. The only zeroes returned here are ones Lithic actually reported.
 */
export function heldAmountOf(payload: Record<string, unknown>): number | null {
  const status = String(payload.status ?? '').toUpperCase();
  if (HOLDS_NOTHING.has(status)) return 0;

  const pending = centsOrNull(payload.pending_amount);
  const settled = centsOrNull(payload.settled_amount);

  // Current shape: the two halves add up to what is held.
  if (pending !== null) return Math.max(0, pending + (settled ?? 0));

  // Legacy shape: one running figure. Fall back to the cleared amount only if it is all we have.
  const amount = centsOrNull(payload.amount);
  if (amount !== null) return Math.max(0, amount);
  if (settled !== null) return Math.max(0, settled);

  return null;
}

export interface CardTransactionResult extends ReconcileOutcome {
  transactionToken: string;
  targetCents: number | null;
}

/**
 * Handle one `card_transaction` event.
 *
 * Idempotency lives in `reconcile`, not here: it compares against what we currently hold, so a
 * redelivered event resolves to a zero delta rather than a second adjustment.
 */
export async function handleCardTransaction(
  payload: Record<string, unknown>,
): Promise<CardTransactionResult | null> {
  const transactionToken = String(payload.token ?? '').trim();
  if (!transactionToken) return null;

  const targetCents = heldAmountOf(payload);
  if (targetCents === null) {
    console.warn(
      `[lithic:card_transaction] ${transactionToken} carried no readable amount — leaving the draw alone`,
    );
    return null;
  }

  const status = String(payload.status ?? '') || undefined;
  const outcome = await reconcile({ transactionToken, targetCents, status });

  return { ...outcome, transactionToken, targetCents };
}
