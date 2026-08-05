import {
  ArrowLeftRight,
  ArrowDownLeft,
  Briefcase,
  Receipt,
  CreditCard,
  Repeat,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon + tint per transaction category. Lives here rather than inside a component so the
 * activity table and the detail modal can share it without importing each other.
 */
export type Category = 'Transfer' | 'Deposit' | 'Payroll' | 'Bill' | 'Card' | 'Subscription';

export const CATEGORY: Record<Category, { icon: LucideIcon; tint: string }> = {
  Transfer: { icon: ArrowLeftRight, tint: 'bg-info/10 text-info' },
  Deposit: { icon: ArrowDownLeft, tint: 'bg-positive/10 text-positive' },
  Payroll: { icon: Briefcase, tint: 'bg-positive/10 text-positive' },
  Bill: { icon: Receipt, tint: 'bg-negative/10 text-negative' },
  Card: { icon: CreditCard, tint: 'bg-secondary text-foreground' },
  Subscription: { icon: Repeat, tint: 'bg-violet-500/10 text-violet-500 dark:text-violet-400' },
};
