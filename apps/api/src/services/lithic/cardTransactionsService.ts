import { getPayPool } from '../../config/postgres.js';
import { liveFeeCents, type CreditFeeStatus } from './cardCreditFee.js';

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
  /**
   * The card credit fee on this purchase (decision 55), in cents: 0 when it carried none. Shown under
   * the purchase, never inside `amountCents` (the merchant's figure) or `creditCents`.
   */
  creditFeeCents: number;
  /**
   * Where the fee stands: `charged` while it is owed (held or settled), `returned` once a full refund
   * gave it back, `released` when the purchase was voided before it was ever charged, `waived` when
   * the chain no longer accepted it at settlement. Null with no fee.
   */
  creditFeeState: 'charged' | 'returned' | 'released' | 'waived' | null;
  /** True once all of the fee was given back (a full refund, or credited back in full). */
  creditFeeReturned: boolean;
  /** How much of the fee has been given back so far, in cents (part of it can be credited back). */
  creditFeeReturnedCents: number;
}

interface Row {
  transaction_token: string;
  card_token: string;
  amount_cents: string;
  net_cents: string | null;
  draws: unknown;
  merchant: unknown;
  decided_at: Date;
  fee_cents?: string | number | null;
  fee_status?: string | null;
  fee_returned_cents?: string | number | null;
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
  type HeldRow = { draws: unknown; onchain_status: string | null; fee_draws: unknown; fee_status: string | null };
  const { rows } = await pool
    .query<HeldRow>(
      `SELECT draws, onchain_status, fee_draws, fee_status FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0`,
      [wallet.toLowerCase()],
    )
    .catch(() =>
      pool.query<HeldRow>(
        `SELECT draws, NULL::text AS onchain_status, '[]'::jsonb AS fee_draws, NULL::text AS fee_status
           FROM lithic_auth_decisions
          WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0`,
        [wallet.toLowerCase()],
      ),
    );

  return rows.length ? sumHeldDraws(rows) : empty;
}

/**
 * The sum behind heldDrawsByTier, pure so it can be tested without a database.
 *
 * The card credit fee (decision 55) is held exactly like the purchase's credit part: counted while
 * it is only a hold (`held`), and not once the chain carries it (`charged`: the tiers' own figures
 * include it) or once it is gone (released, waived, returned). So a member never sees it twice, and
 * never sees one that was not charged.
 */
export function sumHeldDraws(
  rows: Array<{ draws: unknown; onchain_status: string | null; fee_draws?: unknown; fee_status?: string | null }>,
): HeldDraws {
  const held: HeldDraws = { cash: 0, savings: 0, asset: 0, income: 0, boost: 0 };
  const add = (draw: { source?: unknown; amountCents?: unknown }, skipCredit: boolean) => {
    const source = String(draw?.source ?? '');
    if (skipCredit && source !== 'cash') return;
    const cents = Number(draw?.amountCents ?? 0);
    if (source in held && Number.isFinite(cents)) held[source as keyof HeldDraws] += cents;
  };
  for (const row of rows) {
    // Settled and issued: the credit part is on chain now, in the tiers' own figures. Counting it
    // here as well would show the member the same purchase twice.
    const onChain = row.onchain_status === 'issued';
    if (Array.isArray(row.draws)) {
      for (const draw of row.draws as Array<{ source?: unknown; amountCents?: unknown }>) add(draw, onChain);
    }
    if (row.fee_status === 'held' && !onChain && Array.isArray(row.fee_draws)) {
      for (const draw of row.fee_draws as Array<{ source?: unknown; amountCents?: unknown }>) add(draw, false);
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
  type RepaidRow = {
    transaction_token: string;
    draws: unknown;
    fee_cents: string | number | null;
    fee_status: string | null;
    fee_returned_cents: string | number | null;
  };
  const { rows } = await pool
    .query<RepaidRow>(
      `SELECT transaction_token, draws, fee_cents, fee_status, fee_returned_cents FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0
          AND dispute_token IS NULL AND COALESCE(onchain_status, '') <> 'waived'
        ORDER BY decided_at ASC`,
      [w],
    )
    .catch(() =>
      pool.query<RepaidRow>(
        `SELECT transaction_token, draws, 0 AS fee_cents, NULL::text AS fee_status, 0 AS fee_returned_cents FROM lithic_auth_decisions
          WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0
          ORDER BY decided_at ASC`,
        [w],
      ),
    );
  // The card credit fee is owed on the same tiers as the purchase, so it is in `owed` below and has
  // to be in what was drawn too, or every fee would read as a repayment not yet made.
  const creditWithFee = (r: RepaidRow) => creditOf(r.draws) + liveFeeCents(r.fee_cents, r.fee_status, r.fee_returned_cents);
  const drawn = rows.reduce((sum, r) => sum + creditWithFee(r), 0);
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
    rows.map((r) => ({ id: r.transaction_token, creditCents: creditWithFee(r) })),
    Math.max(0, drawn - owed),
  );
  for (const [id, cents] of allocated) out.set(id, cents);
  return out;
}

/** The fee fields of a card transaction, from the stored fee and its state. Pure. */
export function creditFeeOf(
  feeCents: unknown,
  status: unknown,
  returnedCents: unknown = 0,
): Pick<CardTransactionRow, 'creditFeeCents' | 'creditFeeState' | 'creditFeeReturned' | 'creditFeeReturnedCents'> {
  const cents = Math.max(0, Math.round(Number(feeCents ?? 0) || 0));
  const s = (typeof status === 'string' ? status : null) as CreditFeeStatus | null;
  if (cents <= 0 || !s) return { creditFeeCents: 0, creditFeeState: null, creditFeeReturned: false, creditFeeReturnedCents: 0 };
  const state = s === 'held' || s === 'charged' ? 'charged' : s;
  const back = state === 'returned' ? cents : state === 'charged' ? Math.min(cents, Math.max(0, Math.round(Number(returnedCents ?? 0) || 0))) : 0;
  return { creditFeeCents: cents, creditFeeState: state, creditFeeReturned: state === 'returned', creditFeeReturnedCents: back };
}

/** Card credit fees over a window: what was charged, and what of it was given back. */
export interface CreditFeeWindow {
  chargedCents: number;
  returnedCents: number;
}

export interface CreditFeeTotals {
  /** The current cycle, when the caller gave its start; null otherwise. */
  cycle: CreditFeeWindow | null;
  /** January 1 (UTC) to now (Reg Z §1026.7(b)(6): fee totals for the period and the year to date). */
  yearToDate: CreditFeeWindow;
}

/**
 * Sum fees into windows. Pure. A fee counts where it was imposed (the swipe); one released, waived or
 * never charged was not imposed and counts nowhere. Given back (a full refund, or a credit back) is
 * shown beside it rather than netted away, so the statement says both.
 */
export function sumCreditFees(
  rows: Array<{ decidedAtMs: number; feeCents: number; status: string | null; returnedCents: number }>,
  windows: { cycleStartMs: number | null; yearStartMs: number },
): CreditFeeTotals {
  const empty = (): CreditFeeWindow => ({ chargedCents: 0, returnedCents: 0 });
  const totals: CreditFeeTotals = { cycle: windows.cycleStartMs === null ? null : empty(), yearToDate: empty() };
  for (const row of rows) {
    const f = creditFeeOf(row.feeCents, row.status, row.returnedCents);
    if (f.creditFeeCents <= 0 || (f.creditFeeState !== 'charged' && f.creditFeeState !== 'returned')) continue;
    const add = (w: CreditFeeWindow) => {
      w.chargedCents += f.creditFeeCents;
      w.returnedCents += f.creditFeeReturnedCents;
    };
    if (row.decidedAtMs >= windows.yearStartMs) add(totals.yearToDate);
    if (totals.cycle && windows.cycleStartMs !== null && row.decidedAtMs >= windows.cycleStartMs) add(totals.cycle);
  }
  return totals;
}

/** A member's card credit fees for the cycle (from `cycleStartMs`) and the year to date. */
export async function cardCreditFeeTotals(wallet: string, cycleStartMs: number | null, now = new Date()): Promise<CreditFeeTotals> {
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1);
  const windows = { cycleStartMs, yearStartMs };
  const pool = getPayPool();
  if (!pool) return sumCreditFees([], windows);
  const since = new Date(Math.min(yearStartMs, cycleStartMs ?? yearStartMs));
  const { rows } = await pool
    .query<{ decided_at: Date; fee_cents: string | number; fee_status: string | null; fee_returned_cents: string | number | null }>(
      `SELECT decided_at, fee_cents, fee_status, fee_returned_cents FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED' AND fee_cents > 0 AND decided_at >= $2`,
      [wallet.toLowerCase(), since],
    )
    // A database that has never decided a fee has none to total.
    .catch(() => ({ rows: [] as never[] }));
  return sumCreditFees(
    rows.map((r) => ({
      decidedAtMs: new Date(r.decided_at).getTime(),
      feeCents: Number(r.fee_cents) || 0,
      status: r.fee_status,
      returnedCents: Number(r.fee_returned_cents ?? 0) || 0,
    })),
    windows,
  );
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

  const params = [wallet.toLowerCase(), Math.min(Math.max(limit, 1), 200)];
  const { rows } = await pool
    .query<Row>(
      `SELECT transaction_token, card_token, amount_cents, net_cents, draws, merchant, decided_at, fee_cents, fee_status,
              fee_returned_cents
         FROM lithic_auth_decisions
        WHERE wallet = $1 AND result = 'APPROVED'
        ORDER BY decided_at DESC
        LIMIT $2`,
      params,
    )
    // A database that has never decided a fee (the columns arrive with the auth store) still lists.
    .catch(() =>
      pool.query<Row>(
        `SELECT transaction_token, card_token, amount_cents, net_cents, draws, merchant, decided_at
           FROM lithic_auth_decisions
          WHERE wallet = $1 AND result = 'APPROVED'
          ORDER BY decided_at DESC
          LIMIT $2`,
        params,
      ),
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
      ...creditFeeOf(row.fee_cents, row.fee_status, row.fee_returned_cents),
    };
  });
}
