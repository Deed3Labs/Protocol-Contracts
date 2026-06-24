import { Wallet, Send, LineChart, Settings, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Single source of truth for the primary navigation (mobile TabBar + desktop SideNav). */
export const navItems: NavItem[] = [
  { to: '/', label: 'Accounts', icon: Wallet, end: true },
  { to: '/pay', label: 'Pay', icon: Send },
  { to: '/transactions', label: 'Transactions', icon: LineChart },
  { to: '/settings', label: 'Settings', icon: Settings },
];
