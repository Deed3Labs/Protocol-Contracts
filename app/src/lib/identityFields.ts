/**
 * The two fields a member types, in the two formats the card issuer will not negotiate on.
 *
 * Their own module rather than sitting beside the component: they are pure, they are the part most
 * worth testing, and a validation bug here is a 400 discovered *after* a social security number has
 * already been sent — the worst possible moment to find one.
 */

const nowMinus18Years = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d;
};

/** MM/DD/YYYY as typed → YYYY-MM-DD as Lithic wants. Returns null when it isn't a real date. */
export function toIsoDob(typed: string): string | null {
  const m = typed.trim().match(/^(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Round-trip check: `2026-02-31` parses to March 3rd rather than failing.
  if (date.getUTCMonth() + 1 !== Number(mm) || date.getUTCDate() !== Number(dd)) return null;
  if (date > nowMinus18Years()) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** SSN as typed → 000-00-0000. Accepts it with or without dashes; rejects anything else. */
export function toFormattedSsn(typed: string): string | null {
  const digits = typed.replace(/\D/g, '');
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
