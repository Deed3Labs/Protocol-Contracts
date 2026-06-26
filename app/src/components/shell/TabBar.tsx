import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useMoneyActions } from '@/context/MoneyActionsContext';
import { cn } from '@/lib/utils';
import { navItems, type NavItem } from './navItems';

// Reserve the widest label so the active tab — and therefore the whole pill — keeps a
// constant width as you switch pages, rather than resizing per active label.
const widestLabel = navItems.reduce((w, i) => (i.label.length > w.length ? i.label : w), '');

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
          {isActive && (
            <span className="grid text-[13px] font-medium">
              <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
                {widestLabel}
              </span>
              <span className="col-start-1 row-start-1 whitespace-nowrap text-center">{label}</span>
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Floating mobile footer (lg:hidden): the main nav pill on the left, a standalone
 * Add-money button on the right. Bottom offset is in `.mobile-tabbar` (index.css), which
 * lifts the bar higher in installed/PWA standalone mode for easier thumb reach.
 */
export default function TabBar() {
  const { openAddMoney } = useMoneyActions();
  return (
    <div className="mobile-tabbar fixed inset-x-0 z-50 flex items-center justify-between px-4 lg:hidden">
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
        onClick={openAddMoney}
        className="flex items-center justify-center rounded-full bg-primary p-4 text-primary-foreground shadow-[0_8px_30px_rgb(0_0_0/0.18)] transition-transform active:scale-95"
      >
        <Plus className="h-5 w-5 shrink-0" strokeWidth={2.5} />
      </button>
    </div>
  );
}
