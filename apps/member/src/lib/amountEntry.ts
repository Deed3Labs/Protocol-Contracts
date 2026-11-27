/**
 * Typing an amount on a keypad.
 *
 * Entry is string-based, not numeric. "250." is a state somebody passes through on the way to
 * "250.5", and parsing on every press would erase the decimal point the moment it was entered.
 *
 * Its own module so the rules can be tested without a DOM, and so the pad component only exports
 * a component.
 */
/** At most one decimal point, at most two decimal places, and a leading "." becomes "0.". */
export function applyKey(current: string, key: string): string {
  if (key === 'del') return current.slice(0, -1);

  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }

  // Cents only go to two places. Silently ignoring the third keypress beats accepting it and
  // rounding somebody's deposit behind their back.
  const [, decimals] = current.split('.');
  if (decimals !== undefined && decimals.length >= 2) return current;

  // No leading zeros: "0" then "5" is five, not "05".
  if (current === '0') return key;
  return current + key;
}

