import type { YieldPool, HeldBond, BondTerm, EarnData } from '@/lib/clearModel';
import type { EarnPoolRow, EarnBondRow, EarnTermRow } from '@/utils/apiClient';

/**
 * The Earn page's products, as a member reads them.
 *
 * The one judgement here is what a bond is *worth*. The page shows `worthToday`, which is the
 * accrued value between what was paid and the face — not the face itself. That is deliberate and
 * it matters twice: it is what the credit line actually lends against, and it is the only figure
 * that changes between purchase and maturity. Showing face would tell a member they hold more
 * than they can borrow against, on the same screen that offers to lend it to them.
 */
const fromCents = (cents: number) => cents / 100;

export function toYieldPool(row: EarnPoolRow | null, fallback: YieldPool): YieldPool {
  if (!row) return fallback;
  return {
    apy: Number(row.apyPercent.toFixed(2)),
    lent: fromCents(row.lentCents),
    capacity: fromCents(row.capacityCents),
    position: fromCents(row.positionCents),
    // Earned is the position above what was put in, which needs deposit history the chain does
    // not hold — the pool knows what the shares are worth, not what they cost.
    earned: fallback.earned,
  };
}

export function toHeldBonds(rows: EarnBondRow[]): HeldBond[] {
  const now = Date.now() / 1000;
  return rows.map((row) => {
    const monthsLeft = Math.max(0, Math.round((row.maturityUnix - now) / (30 * 86_400)));
    return {
      id: row.bondId,
      face: fromCents(row.faceCents),
      paid: fromCents(row.paidCents),
      worthToday: fromCents(row.worthTodayCents),
      monthsLeft,
      // The term as ISSUED, which is issue date to maturity -- not what is left. Deriving it from
      // months remaining would relabel a member's three-year bond as a one-year bond two years in.
      months: Math.max(1, Math.round((row.maturityUnix - row.issuedAtUnix) / (30 * 86_400))),
      maturesOn: new Date(row.maturityUnix * 1000).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  });
}

export function toBondTerms(rows: EarnTermRow[]): BondTerm[] {
  return rows.map((row) => ({
    months: row.months,
    price: fromCents(row.priceCents),
    face: fromCents(row.faceCents),
    rate: Number(row.ratePercent.toFixed(2)),
  }));
}

/**
 * Earn, with anything the chain cannot answer left as it was.
 *
 * `earnedToDate` and `reserveDate` stay on their fallbacks: the first needs deposit history and
 * the second is a projection, and neither is something the contracts hold.
 */
export function toEarnData(
  pool: EarnPoolRow | null,
  bonds: EarnBondRow[],
  terms: EarnTermRow[],
  fallback: EarnData,
): EarnData {
  return {
    ...fallback,
    pool: toYieldPool(pool, fallback.pool),
    // An empty portfolio is the truth for a member who holds no bonds, and the page has a state
    // for it. Terms are different — no terms means the collection quoted nothing, so the
    // placeholder stands rather than offering a member an empty menu.
    bonds: toHeldBonds(bonds),
    terms: terms.length > 0 ? toBondTerms(terms) : fallback.terms,
  };
}
