import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navItems, type NavItem } from './navItems';

function Tab({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink to={to} end={end} aria-label={label}>
      {({ isActive }) => (
        <span
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2.5 transition-colors duration-300',
            isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
          {isActive && <span className="whitespace-nowrap text-[13px] font-medium">{label}</span>}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Floating bottom nav (mobile only) — a blurred pill detached from the screen edges.
 * Active tab fills + expands to its label; a prominent center "+" exposes Add money
 * (which lives in the top bar on desktop). Hidden on desktop (lg+).
 */
export default function TabBar() {
  return (
    <nav
      className="fixed left-1/2 z-50 -translate-x-1/2 lg:hidden"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl">
        {navItems.slice(0, 2).map((item) => (
          <Tab key={item.to} {...item} />
        ))}
        <button
          type="button"
          aria-label="Add money"
          className="mx-0.5 flex items-center justify-center rounded-lg bg-primary px-3 py-2.5 text-primary-foreground shadow-sm transition-transform active:scale-95"
        >
          <Plus className="h-5 w-5 shrink-0" strokeWidth={2.5} />
        </button>
        {navItems.slice(2).map((item) => (
          <Tab key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
