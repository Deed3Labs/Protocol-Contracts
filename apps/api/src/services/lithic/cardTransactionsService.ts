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
  /** What this purchase drew on credit (not cash), in cents. */
  creditCents: number;
  /**
   * How much of that credit has been repaid, oldest purchase first. Repayments are not tied to a
   * purchase -- a deposit pays down the balance -- so they are allocated to the oldest credit first,
   * the way a statement reads. When nothing is owed, every credit purchase is fully repaid.
   */
  creditRepaidCents: number;
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

/** Held card draws per tier, in the page's own vocabulary. Zero for a tier nothing is drawn on. */
export interface HeldDraws {
  cash: number;
  savings: number;
  asset: number;
  income: number;
  boost: number;
}

/**
 * What the member's card is currently holding against each tier.
 *
 * An authorization is a HOLD, not a settled borrow. The contracts are told about borrowings, and
 * they are right not to know about this one yet — it can still be voided, and half of tonight's
 * were. But the money is unavailable to the member the moment it is approved, and every figure they
 * read said otherwise: a live $5 charge sat against a line reading "$0 used, not drawn".
 *
 * So this is the pending half, kept where it belongs — in our ledger, reported as pending, never
 * confused with what the chain has settled. It is summed from `draws`, which reconcile rewrites as
 * a transaction is voided or cleared, so a released charge stops counting without anything else
 * having to remember to subtract it.
 */
export async function heldDrawsByTier(wallet: string): Promise<HeldDraws> {
  const empty: HeldDraws = { cash: 0, savings: 0, asset: 0, income: 0, boost: 0 };
  const pool = getPayPool();
  if (!pool) return empty;

  // `onchain_status` is added by the card settlement service; read it defensively so this keeps
  // working on a database that has never settled anything.
  const { rows } = await pool
    .query<{ draws: unknown; onchain_status: string | null }>(
      `SELECT draws, onchain_status FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0`,
      [wallet.toLowerCase()],
    )
    .catch(() =>
      pool.query<{ draws: unknown; onchain_status: string | null }>(
        `SELECT draws, NULL::text AS onchain_status FROM lithic_auth_decisions
          WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0`,
        [wallet.toLowerCase()],
      ),
    );

  const held = { ...empty };
  for (const row of rows) {
    if (!Array.isArray(row.draws)) continue;
    // Settled and issued: the credit part is on chain now, in the tiers' own figures. Counting it
    // here as well would show the member the same purchase twice.
    const onChain = row.onchain_status === 'issued';
    for (const draw of row.draws as Array<{ source?: unknown; amountCents?: unknown }>) {
      const source = String(draw?.source ?? '');
      if (onChain && source !== 'cash') continue;
      const cents = Number(draw?.amountCents ?? 0);
      if (source in held && Number.isFinite(cents)) held[source as keyof HeldDraws] += cents;
    }
  }
  return held;
}

const CREDIT_TIERS = ['savings', 'asset', 'income', 'boost'];

function creditOf(draws: unknown): number {
  if (!Array.isArray(draws)) return 0;
  return (draws as Array<{ source?: unknown; amountCents?: unknown }>).reduce((sum, d) => {
    const cents = Number(d?.amountCents ?? 0);
    return String(d?.source ?? 'cash') !== 'cash' && Number.isFinite(cents) && cents > 0 ? sum + cents : sum;
  }, 0);
}

/**
 * Credit repaid per purchase, allocated oldest first.
 *
 * Total repaid = everything drawn on credit, less what is still owed on the credit tiers. A
 * disputed purchase is set aside, not repaid, so it is left out of both sides.
 */
export async function creditRepaidByTransaction(wallet: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pool = getPayPool();
  if (!pool) return out;
  const w = wallet.toLowerCase();
  const { rows } = await pool
    .query<{ transaction_token: string; draws: unknown }>(
      `SELECT transaction_token, draws FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0
          AND dispute_token IS NULL AND COALESCE(onchain_status, '') <> 'waived'
        ORDER BY decided_at ASC`,
      [w],
    )
    .catch(() =>
      pool.query<{ transaction_token: string; draws: unknown }>(
        `SELECT transaction_token, draws FROM lithic_auth_decisions
          WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0
          ORDER BY decided_at ASC`,
        [w],
      ),
    );
  const drawn = rows.reduce((sum, r) => sum + creditOf(r.draws), 0);
  const owed = await pool
    .query<{ net: string }>(
      `SELECT COALESCE(SUM(GREATEST(net, 0)), 0) AS net FROM (
         SELECT SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
           FROM lithic_ledger_entries WHERE wallet = $1 AND account = ANY($2::text[])
          GROUP BY account) t`,
      [w, CREDIT_TIERS.map((t) => `member_credit_${t}`)],
    )
    .then((r) => Number(r.rows[0]?.net ?? 0))
    .catch(() => drawn);
  const allocated = allocateRepaidOldestFirst(
    rows.map((r) => ({ id: r.transaction_token, creditCents: creditOf(r.draws) })),
    Math.max(0, drawn - owed),
  );
  for (const [id, cents] of allocated) out.set(id, cents);
  return out;
}

/** Spread a repaid total over purchases, oldest first. Pure; `purchases` must be oldest first. */
export function allocateRepaidOldestFirst(
  purchases: Array<{ id: string; creditCents: number }>,
  repaidCents: number,
): Map<string, number> {
  const out = new Map<string, number>();
  let left = Math.max(0, repaidCents);
  for (const p of purchases) {
    const applied = Math.min(Math.max(0, p.creditCents), left);
    out.set(p.id, applied);
    left -= applied;
  }
  return out;
}

export async function listCardTransactions(
  wallet: string,
  limit = 50,
): Promise<CardTransactionRow[]> {
  const pool = getPayPool();
  if (!pool) return [];
  const repaidBy = await creditRepaidByTransaction(wallet).catch(() => new Map<string, number>());

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
      creditCents: creditOf(row.draws),
      creditRepaidCents: repaidBy.get(row.transaction_token) ?? 0,
    };
  });
}
