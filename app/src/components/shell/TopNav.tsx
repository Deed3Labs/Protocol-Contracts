import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

/**
 * Fixed top navigation (modeled on the old portfolio HeaderNav): logo + hamburger
 * (opens the slide-in SideMenu), desktop nav links, and a profile button. The page
 * scrolls beneath it (window scroll) — no sticky/flex sidebar.
 */
export default function TopNav({ onMenuOpen }: { onMenuOpen: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display text-lg text-primary-foreground">
            C
          </div>
          <button
            type="button"
            onClick={onMenuOpen}
            aria-label="Open menu"
            className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
          >
            <Menu className="h-4 w-4" />
            <span className="hidden sm:inline">Menu</span>
          </button>
        </div>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMenuOpen}
            aria-label="Profile and menu"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
          >
            SS
          </button>
        </div>
      </div>
    </header>
  );
}
