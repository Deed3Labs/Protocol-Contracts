import {
  TIER_SHORT_LABEL,
  capitalise,
  type ActivityRow,
  type SpendCategory,
} from './clearModel';

/*
 * What the Activity list shows: filters, search, sort, the tag beside each row, and the share each
 * spending group takes of the cycle. Pure, so the page only renders.
 */

export type Direction = 'all' | 'in' | 'out';
export type PaidFrom = 'any' | 'cash' | 'credit' | 'savings';
export type When = 'cycle' | 'last3' | 'year' | 'custom';
export type ActivitySort = 'newest' | 'oldest' | 'largest';

export interface ActivityFilters {
  direction: Direction;
  paidFrom: PaidFrom;
  when: When;
}

export const DEFAULT_FILTERS: ActivityFilters = { direction: 'all', paidFrom: 'any', when: 'cycle' };

export const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];
export const PAID_FROM: { id: PaidFrom; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'cash', label: 'Cash' },
  { id: 'credit', label: 'Credit' },
  { id: 'savings', label: 'Savings' },
];
export const WHEN: { id: When; label: string }[] = [
  { id: 'cycle', label: 'This cycle' },
  { id: 'last3', label: 'Last 3' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];
export const ACTIVITY_SORTS: { id: ActivitySort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'largest', label: 'Largest' },
];

/** Which pocket a row came out of, for the Paid from filter. */
export function paidFromOf(row: ActivityRow): Exclude<PaidFrom, 'any'> {
  if (row.paidFromTier || row.source === 'credit') return 'credit';
  if (row.source === 'savings') return 'savings';
  return 'cash';
}

/**
 * Rows that pass the filters and the search. When is not applied: rows carry a display date, not a
 * cycle, so the list is whatever the server returned for the range.
 */
export function filterRows(rows: ActivityRow[], filters: ActivityFilters, query: string): ActivityRow[] {
  const term = query.trim().toLowerCase().replace(/[$,]/g, '');
  return rows.filter((row) => {
    if (filters.direction === 'in' && row.amount <= 0) return false;
    if (filters.direction === 'out' && row.amount >= 0) return false;
    if (filters.paidFrom !== 'any' && paidFromOf(row) !== filters.paidFrom) return false;
    if (!term) return true;
    return row.name.toLowerCase().includes(term) || Math.abs(row.amount).toFixed(2).includes(term);
  });
}

/** Newest is the order rows arrive in; oldest reverses it; largest is by size either way. */
export function sortRows(rows: ActivityRow[], sort: ActivitySort): ActivityRow[] {
  if (sort === 'oldest') return [...rows].reverse();
  if (sort === 'largest') return [...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return rows;
}

/** Rows under their day, in the order given. Days are sections, not captions. */
export function groupByDay(rows: ActivityRow[]): { day: string; rows: ActivityRow[] }[] {
  const groups: { day: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.day === row.date) last.rows.push(row);
    else groups.push({ day: row.date, rows: [row] });
  }
  return groups;
}

/** The tag beside a row: what paid for it, or what it was, and the colour that goes with it. */
export function rowTag(row: ActivityRow): { label: string; className?: string } {
  if (row.termPayment) {
    return { label: `Term plan · ${row.termPayment.index} of ${row.termPayment.count}`, className: 'c-t-inc' };
  }
  if (row.kind === 'sent') return { label: row.counterpartyHandle ? `Sent · ${row.counterpartyHandle}` : 'Sent' };
  if (row.paidFromTier) {
    const className = { savings: 'c-t-sav', asset: 'c-t-ast', income: 'c-t-inc', boost: undefined }[row.paidFromTier];
    return { label: TIER_SHORT_LABEL[row.paidFromTier], className };
  }
  if (row.source === 'savings') return { label: 'Savings', className: 'c-t-sav' };
  return { label: capitalise(row.source) };
}

/**
 * Each group's whole-number share of the cycle, summing to 100: the catch-all group takes what
 * rounding leaves, so four figures never add to 99. Largest first, with Everything else last.
 */
export function categoryShares(categories: SpendCategory[], total: number): (SpendCategory & { pct: number })[] {
  const isRest = (c: SpendCategory) => c.label === 'Everything else';
  const ordered = [...categories].sort((a, b) => Number(isRest(a)) - Number(isRest(b)) || b.amount - a.amount);
  if (total <= 0) return ordered.map((c) => ({ ...c, pct: 0 }));
  const shares = ordered.map((c) => ({ ...c, pct: Math.round((c.amount / total) * 100) }));
  const rest = shares.find(isRest);
  if (rest) rest.pct = 100 - shares.filter((c) => !isRest(c)).reduce((sum, c) => sum + c.pct, 0);
  return shares;
}
