/**
 * Money formatting for the member app.
 *
 * Balances and limits read as round figures ($3,200); amounts that need to be
 * exact — transactions, carry cost — keep their cents ($52.10). Never renders a
 * negative (spec §3, rule 1): direction is carried by an explicit sign character
 * at the call site, so a value can't accidentally print as "$-40".
 */
export function money(value: number, opts: { cents?: boolean } = {}): string {
  const n = Math.abs(value);
  const cents = opts.cents ?? !Number.isInteger(n);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
}

/**
 * Signed amount with a true minus sign, not a hyphen: "+$2,000.00" / "−$52.10".
 * Transactions keep their cents; pass `{ cents: false }` for round summary
 * figures like a cycle total.
 */
export function signedMoney(value: number, opts: { cents?: boolean } = {}): string {
  return `${value < 0 ? '−' : '+'}${money(value, { cents: opts.cents ?? true })}`;
}

/**
 * Abbreviated figures for pool-scale numbers: "$740k", "$1.0M". Only for
 * context lines — never for a balance the member could act on, which should
 * always be exact.
 */
export function compactMoney(value: number): string {
  const n = Math.abs(value);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return money(n);
}

/** Whole-number counts, e.g. equity credits: "15,000". */
export function count(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * A dollar amount that always carries its decimals, including a round one: "$412.00".
 *
 * The merchant convention, and the one the design reference uses without exception — there is not
 * a single bare round figure anywhere in it. It differs from `money` above deliberately, and the
 * difference is not an inconsistency to be tidied away:
 *
 * A member app shows *balances* — a limit, what is left, a pool position — and a balance reads
 * better round, because a member is judging a magnitude. A merchant app shows *transactions* only:
 * a charge, a payout, a refund. Every figure on that surface is an exact sum somebody will
 * reconcile against a bank statement, and dropping ".00" from one of them makes the whole column
 * look like it has been rounded.
 *
 * So the rule is "balances round, transactions exact", and a merchant has no balances.
 */
export function dollars(value: number): string {
  return money(value, { cents: true });
}

/**
 * Equity credits: no decimals, but still a dollar sign — "$15,000".
 *
 * A credit is a whole thing, never a fraction of one, so decimals on it would be noise. It keeps
 * the symbol because it is denominated in dollars even though it is not cash. `count` gives the
 * bare number for places that supply their own unit.
 */
export function credits(value: number): string {
  return `$${count(value)}`;
}
