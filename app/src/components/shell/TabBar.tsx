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
 * Floating mobile footer (lg:hidden): the main nav pill on the left, and a standalone
 * Add-money button on the right (no surrounding card). Hidden on desktop, where the
 * Sidebar + top-bar Add money take over.
 */
export default function TabBar() {
  return (
    <div
      className="fixed inset-x-0 z-50 flex items-center justify-between px-4 lg:hidden"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      {/* Main nav — left */}
      <nav className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl">
        {navItems.map((item) => (
          <Tab key={item.to} {...item} />
        ))}
      </nav>

      {/* Add money — right, standalone button */}
      <button
        type="button"
        aria-label="Add money"
        className="flex items-center justify-center rounded-lg bg-primary p-4 text-primary-foreground shadow-[0_8px_30px_rgb(0_0_0/0.18)] transition-transform active:scale-95"
      >
        <Plus className="h-5 w-5 shrink-0" strokeWidth={2.5} />
      </button>
    </div>
  );
}
