import type { BillType } from '@/context/PayContext';

/*
 * One colour per bill category, shared by everything that draws one.
 *
 * The month bar teaches the mapping (amber = utilities); the list rows reinforce it. That only works
 * if both read from here — two hand-maintained palettes drift, and a legend that disagrees with the
 * rows is worse than no colour at all.
 */

/** Solid fill — bar segments and legend dots. */
export const CATEGORY_BAR: Record<BillType, string> = {
  rent: 'bg-emerald-500',
  utility: 'bg-amber-500',
  subscription: 'bg-violet-500',
  card: 'bg-sky-500',
  phone: 'bg-rose-500',
  other: 'bg-muted-foreground/40',
};

/** Soft tint + matching foreground — icon tiles on rows and headers. */
export const CATEGORY_TINT: Record<BillType, string> = {
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  utility: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  subscription: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  card: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  phone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  other: 'bg-secondary text-muted-foreground',
};
