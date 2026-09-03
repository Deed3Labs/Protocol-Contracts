/**
 * The cents boundary.
 *
 * The domain works in whole units, matching `splitQuote`, `refundQuote` and `money`. The server
 * persists integer cents (`amountCents`, `payoutCents`) because money in a database must not be a
 * float. Both are right; the danger is the conversion happening ad hoc at a dozen call sites, one
 * of which forgets and shows a member a bill a hundred times too large.
 *
 * So it happens here, once, in two functions with names that say which side they land on.
 */

/** Server cents to domain units: 41200 -> 412. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Domain units to server cents: 412 -> 41200.
 *
 * Rounding alone is not enough. `4.1 * 100` is `409.99999999999994` and `1.005 * 100` is
 * `100.49999999999999` — the first rounds correctly by luck, the second rounds *down* to 100 and
 * quietly loses a cent on a figure a person would read as 100.5. Normalising the product to a
 * fixed number of decimals first pulls both back to what the decimal value actually was, so a
 * half-cent rounds up the way someone reading the number expects.
 */
export function toCents(units: number): number {
  return Math.round(Number((units * 100).toFixed(6)));
}
