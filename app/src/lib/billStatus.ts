/*
 * Where a bill stands right now.
 *
 * Bills are monthly and identified only by a day-of-month, so "is this late?" needs both the due day
 * AND the last payment: a bill due on the 26th is not overdue on the 28th if it was paid on the 27th.
 * Every module on the Pay page reads status from here so the list, the attention band and the detail
 * pane can never disagree about the same bill.
 */

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming' | 'undated';

/** Days out at which a bill starts asking for attention. */
export const DUE_SOON_DAYS = 7;

export interface BillTiming {
  status: BillStatus;
  /** The due date that matters right now — this cycle's if unpaid, next cycle's if already paid. */
  dueDate: Date | null;
  /** Whole days until due; negative means that many days late. Null when the bill has no due day. */
  daysUntil: number | null;
  /** Short human phrasing: "Due in 4 days", "3 days late", "Paid Jul 2". */
  label: string;
}

const DAY_MS = 86_400_000;
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A due date in the given month, clamped so "the 31st" still resolves in February. */
function dueIn(year: number, month: number, dueDay: number): Date {
  return new Date(year, month, Math.min(dueDay, daysInMonth(year, month)));
}

export function billTiming(dueDay: number | null, lastPaidAt: string | null, now: Date = new Date()): BillTiming {
  const paid = lastPaidAt ? new Date(lastPaidAt) : null;
  const paidValid = paid && !Number.isNaN(paid.getTime()) ? paid : null;

  if (!dueDay) {
    return {
      status: 'undated',
      dueDate: null,
      daysUntil: null,
      label: paidValid ? `Paid ${shortDate(paidValid)}` : '',
    };
  }

  const today = startOfDay(now);
  const thisCycleDue = dueIn(today.getFullYear(), today.getMonth(), dueDay);
  // A payment counts for this cycle if it landed on or after the 1st of the current month.
  const cycleStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const paidThisCycle = !!paidValid && paidValid >= cycleStart;

  if (paidThisCycle && paidValid) {
    const nextDue = dueIn(today.getFullYear(), today.getMonth() + 1, dueDay);
    return {
      status: 'paid',
      dueDate: nextDue,
      daysUntil: Math.round((nextDue.getTime() - today.getTime()) / DAY_MS),
      label: `Paid ${shortDate(paidValid)}`,
    };
  }

  const daysUntil = Math.round((thisCycleDue.getTime() - today.getTime()) / DAY_MS);

  if (daysUntil < 0) {
    const late = Math.abs(daysUntil);
    return { status: 'overdue', dueDate: thisCycleDue, daysUntil, label: `${late} ${late === 1 ? 'day' : 'days'} late` };
  }
  if (daysUntil === 0) return { status: 'due-soon', dueDate: thisCycleDue, daysUntil, label: 'Due today' };
  if (daysUntil <= DUE_SOON_DAYS) {
    return { status: 'due-soon', dueDate: thisCycleDue, daysUntil, label: `Due in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}` };
  }
  return { status: 'upcoming', dueDate: thisCycleDue, daysUntil, label: `Due ${shortDate(thisCycleDue)}` };
}

/** Sort key: what needs attention first — overdue, then soonest due, with paid last. */
export function billUrgency(t: BillTiming): number {
  if (t.status === 'overdue') return -1000 + (t.daysUntil ?? 0);
  if (t.status === 'paid') return 9000;
  if (t.status === 'undated') return 8000;
  return t.daysUntil ?? 5000;
}
