import { NavLink } from 'react-router-dom';
import { Wallet, Send, LineChart, Settings, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const tabs: TabDef[] = [
  { to: '/', label: 'Accounts', icon: Wallet, end: true },
  { to: '/pay', label: 'Pay', icon: Send },
  { to: '/transactions', label: 'Transactions', icon: LineChart },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Floating bottom nav — a blurred pill detached from the screen edges.
 * Active tab fills terracotta and expands to show its label; others are icon-only.
 */
export default function TabBar() {
  return (
    <nav
      className="fixed left-1/2 z-50 -translate-x-1/2"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/80 p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label}>
            {({ isActive }) => (
              <span
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-2.5 transition-colors duration-300',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                {isActive && (
                  <span className="whitespace-nowrap text-[13px] font-medium">{label}</span>
                )}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
