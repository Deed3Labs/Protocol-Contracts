import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

/**
 * Desktop left sidebar (lg+). Hidden on mobile, where the floating TabBar takes over.
 */
export default function SideNav() {
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-border bg-background px-4 py-6 lg:flex">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display text-lg text-primary-foreground">
          C
        </div>
        <span className="font-display text-xl tracking-tight text-foreground">Clear</span>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/settings"
        className="mt-auto flex items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/60"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
          SS
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">Steven Spark</div>
          <div className="truncate text-xs text-muted-foreground">Member</div>
        </div>
      </NavLink>
    </aside>
  );
}
