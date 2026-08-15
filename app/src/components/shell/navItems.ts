import { House, PiggyBank, TrendingUp, ArrowLeftRight, Receipt, CreditCard, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Nav items are desktop-only unless they also appear in the mobile pill. */
  mobile?: boolean;
}

/**
 * Primary navigation — design spec §1.
 *
 * Six items on desktop. The mobile pill carries four places: Activity is reached
 * through "See all" on Home, and Send moved to the nav's action button, where it
 * belongs — sending is something you do, not somewhere you go, and as a tab it
 * was competing with destinations.
 *
 * Settings is deliberately absent — it lives behind the avatar menu.
 */
export const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true, mobile: true },
  { to: '/savings', label: 'Savings', icon: PiggyBank, mobile: true },
  { to: '/earn', label: 'Earn', icon: TrendingUp, mobile: true },
  { to: '/send', label: 'Send', icon: ArrowLeftRight },
  { to: '/activity', label: 'Activity', icon: Receipt },
  { to: '/card', label: 'Card', icon: CreditCard, mobile: true },
];

export const mobileNavItems = navItems.filter((i) => i.mobile);
