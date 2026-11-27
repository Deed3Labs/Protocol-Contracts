/**
 * Merchant category codes to the handful of categories a member recognises.
 *
 * ISO 18245 defines several hundred MCCs. Showing them raw would be showing a member the payment
 * network's filing system; showing four or five is showing them their month. So this is a
 * deliberate flattening, and the losses are on purpose — a hardware shop and a bookshop are both
 * Shopping here, and nobody is worse off for it.
 *
 * The codes below are the real assignments, not a guess at them. Where a range is contiguous in the
 * standard it is expressed as a range; where the standard scatters related merchants across
 * unrelated numbers, they are listed. That is the standard's shape, not an inconsistency here.
 *
 * `other` is a real answer rather than a failure. An unmapped MCC is a merchant type nobody has
 * decided how to file yet, and putting it in the largest bucket would quietly distort the bar.
 */
/*
 * `MerchantCategory`, not `SpendCategory` — clearModel already has one of those, and it is a
 * different thing: a label and an amount for the Activity page's breakdown. This is the kind of
 * merchant. Two meanings behind one name is the shape of bug that made marking a notification read
 * take two goes.
 */
export type MerchantCategory = 'grocery' | 'fuel' | 'dining' | 'bills' | 'shopping' | 'transport' | 'other';

export const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  grocery: 'Groceries',
  fuel: 'Fuel',
  dining: 'Dining',
  bills: 'Bills',
  shopping: 'Shopping',
  transport: 'Transport',
  other: 'Other',
};

/** Discrete codes, by category. */
const EXACT: Record<number, MerchantCategory> = {
  // Food retail
  5411: 'grocery', 5412: 'grocery', 5422: 'grocery', 5441: 'grocery',
  5451: 'grocery', 5462: 'grocery', 5499: 'grocery',
  // Fuel and vehicle energy. 5983 is fuel dealers (heating oil, propane) — a bill in spirit, but
  // the standard files it with fuel and a member reading "Fuel" will not be surprised.
  5541: 'fuel', 5542: 'fuel', 5983: 'fuel',
  // Eating and drinking
  5811: 'dining', 5812: 'dining', 5813: 'dining', 5814: 'dining',
  // Utilities and telecoms
  4812: 'bills', 4814: 'bills', 4815: 'bills', 4816: 'bills', 4821: 'bills',
  4899: 'bills', 4900: 'bills', 6300: 'bills', 5968: 'bills',
  // Retail
  5311: 'shopping', 5310: 'shopping', 5331: 'shopping', 5399: 'shopping',
  5651: 'shopping', 5691: 'shopping', 5732: 'shopping', 5734: 'shopping',
  5912: 'shopping', 5942: 'shopping', 5943: 'shopping', 5999: 'shopping',
  5200: 'shopping', 5211: 'shopping', 5251: 'shopping', 5261: 'shopping',
  // Getting about
  4111: 'transport', 4112: 'transport', 4121: 'transport', 4131: 'transport',
  4784: 'transport', 4789: 'transport', 7523: 'transport',
};

/** Contiguous ranges the standard actually defines as ranges. */
const RANGES: Array<[number, number, MerchantCategory]> = [
  // Airlines occupy 3000–3299 and car rental 3351–3441 — travel, which nobody has asked for a
  // bucket for, so they read as Transport rather than inventing a seventh slice.
  [3000, 3299, 'transport'],
  [3351, 3441, 'transport'],
  // Lodging, 3501–3999. Same reasoning.
  [3501, 3999, 'transport'],
];

/**
 * The category for an MCC, or `other`.
 *
 * Accepts the string Lithic sends as well as a number: MCCs are four digits and leading zeros are
 * meaningful, so they travel as strings and coercing them early loses that.
 */
export function categoryForMcc(mcc: string | number | null | undefined): MerchantCategory {
  if (mcc == null) return 'other';
  const code = typeof mcc === 'number' ? mcc : Number.parseInt(String(mcc).trim(), 10);
  if (!Number.isFinite(code)) return 'other';
  const exact = EXACT[code];
  if (exact) return exact;
  for (const [from, to, category] of RANGES) {
    if (code >= from && code <= to) return category;
  }
  return 'other';
}

/**
 * Sum by category, largest first, for the composition bar.
 *
 * Sorted by size rather than by a fixed category order, because the bar's job is to show what the
 * month was mostly made of — and a fixed order would bury that under whichever category happens to
 * be listed first.
 */
export function totalsByCategory(
  rows: Array<{ category: MerchantCategory; amount: number }>,
): Array<{ category: MerchantCategory; total: number }> {
  const sums = new Map<MerchantCategory, number>();
  for (const row of rows) {
    // Debits are negative; the bar is about what was spent, so magnitude is what matters. A refund
    // must not subtract from a slice and make the month look smaller than it was.
    const spent = row.amount < 0 ? -row.amount : 0;
    if (spent === 0) continue;
    sums.set(row.category, (sums.get(row.category) ?? 0) + spent);
  }
  return [...sums.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}
