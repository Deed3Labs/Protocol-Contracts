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

/** Whole-number counts, e.g. equity credits: "15,000". */
export function count(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
