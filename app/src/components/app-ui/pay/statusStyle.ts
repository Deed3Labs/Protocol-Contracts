import type { BillStatus } from '@/lib/billStatus';

/*
 * One place for how each bill status looks, so the attention band, the list and the detail pane
 * always tint the same bill the same way. Logic lives in lib/billStatus; this is purely presentation.
 *
 * Note the app has no `warning` colour token (only positive/negative/info), so "due soon" uses the
 * amber utilities already used elsewhere for bill categories rather than inventing a token.
 */

/** Tint for the bill's icon tile. */
export const STATUS_TINT: Record<BillStatus, string> = {
  overdue: 'bg-negative/10 text-negative',
  'due-soon': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  upcoming: 'bg-secondary text-foreground',
  paid: 'bg-secondary text-muted-foreground',
  undated: 'bg-secondary text-foreground',
};

/** Colour for the status line under a bill's name. */
export const STATUS_TEXT: Record<BillStatus, string> = {
  overdue: 'text-negative',
  'due-soon': 'text-amber-600 dark:text-amber-400',
  upcoming: 'text-muted-foreground',
  paid: 'text-muted-foreground',
  undated: 'text-muted-foreground',
};

/** Pill treatment for the detail header. */
export const STATUS_PILL: Record<BillStatus, string> = {
  overdue: 'bg-negative/10 text-negative',
  'due-soon': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  upcoming: 'bg-secondary text-muted-foreground',
  paid: 'bg-positive/10 text-positive',
  undated: 'bg-secondary text-muted-foreground',
};
