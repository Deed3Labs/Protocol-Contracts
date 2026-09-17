import { getPayPool } from '../../config/postgres.js';

/*
 * What the card actually spent, from the authorizations we already decide.
 *
 * The Card page has been showing an empty list for every real card, because nothing ever listed a
 * transaction. It did not need to fetch them: every approval passes through our own Auth Stream
 * handler, and that writes the amount, the merchant object Lithic sent, and which tiers paid. The
 * data has been sitting in `lithic_auth_decisions` the whole time with an index on
 * (wallet, decided_at DESC) — exactly the query this makes.
 *
 * Approvals only. A decline is not a purchase and does not belong in a list of what a member spent,
 * or in the total above it.
 *
 * These are AUTHORIZATIONS, not settlements. The amount can change between the two — a restaurant
 * adds a tip, a fuel pump authorizes a round number and settles the real one — so what this shows
 * is what was approved. That is the honest label for it and it is what a member sees on the day,
 * before any settlement exists to show instead.
 *
 * A charge that was later voided stays on the list, marked, rather than vanishing. The money is back
 * either way, but a row that silently disappears is how a member stops trusting the balance beside
 * it: they remember the charge, and nothing on the screen agrees that it happened. `heldCents` is
 * what they actually owe and `amountCents` is what the merchant asked for, which is why both are
 * here rather than one figure that has to mean both things.
 */

export type DrawSource = string;

export interface CardTransactionRow {
  id: string;
  /** Merchant name as the network sent it. */
  name: string;
  /** ISO timestamp of the decision. */
  at: string;
  /** What was authorized at the swipe. Stays put so the row keeps saying what happened. */
  amountCents: number;
  /**
   * What is still held against this transaction — 0 once it is voided, and a different figure from
   * `amountCents` once it clears for one. This, not the authorization, is what a member owes.
   */
  heldCents: number;
  /** Nothing is held any more. The charge stays on the list, marked, rather than disappearing. */
  reversed: boolean;
  /** ISO 18245 merchant category code, as a string — leading zeros are meaningful. */
  mcc: string | null;
  city: string | null;
  state: string | null;
  /** Which tiers paid, cheapest first. `cash` means it never became credit. */
  draws: Array<{ source: DrawSource; amountCents: number }>;
  cardToken: string;
}

interface Row {
  transaction_token: string;
  card_token: string;
  amount_cents: string;
  net_cents: string | null;
  draws: unknown;
  merchant: unknown;
  decided_at: Date;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export async function listCardTransactions(
  wallet: string,
  limit = 50,
): Promise<CardTransactionRow[]> {
  const pool = getPayPool();
  if (!pool) return [];

  const { rows } = await pool.query<Row>(
    `SELECT transaction_token, card_token, amount_cents, net_cents, draws, merchant, decided_at
       FROM lithic_auth_decisions
      WHERE wallet = $1 AND result = 'APPROVED'
      ORDER BY decided_at DESC
      LIMIT $2`,
    [wallet.toLowerCase(), Math.min(Math.max(limit, 1), 200)],
  );

  return rows.map((row) => {
    const merchant = (row.merchant ?? {}) as Record<string, unknown>;
    const amountCents = Number(row.amount_cents);
    // Null means the transaction has never been reconciled, so the authorization still stands.
    const heldCents = row.net_cents === null ? amountCents : Number(row.net_cents);
    return {
      id: row.transaction_token,
      // `descriptor` is the name on a statement; `acceptor_id` is a merchant number, which is not a
      // name and should never reach a member. An unnamed merchant is better blank than numeric.
      name: asString(merchant.descriptor) ?? 'Card purchase',
      at: row.decided_at.toISOString(),
      amountCents,
      heldCents,
      reversed: heldCents === 0 && amountCents > 0,
      mcc: asString(merchant.mcc),
      city: asString(merchant.city),
      state: asString(merchant.state),
      draws: Array.isArray(row.draws)
        ? (row.draws as Array<{ source?: unknown; amountCents?: unknown }>).map((draw) => ({
            source: String(draw?.source ?? 'cash'),
            amountCents: Number(draw?.amountCents ?? 0),
          }))
        : [],
      cardToken: row.card_token,
    };
  });
}
