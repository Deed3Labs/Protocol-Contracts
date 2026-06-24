import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

/**
 * Floating bottom nav (mobile only) — a blurred pill detached from the screen edges.
 * Active tab fills with the primary color and expands to show its label; others are icon-only.
 * Hidden on desktop (lg+), where the SideNav takes over.
 */
export default function TabBar() {
  return (
    <nav
      className="fixed left-1/2 z-50 -translate-x-1/2 lg:hidden"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label}>
            {({ isActive }) => (
              <span
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-2.5 transition-colors duration-300',
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
