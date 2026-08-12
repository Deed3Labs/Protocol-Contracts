import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { mobileNavItems } from './navItems';

/**
 * Floating mobile tab bar — design spec §1. iOS-style pill, deliberately NOT
 * flush to the bottom edge.
 *
 * Vertical offset lives in `.mobile-tabbar` (index.css) so the safe-area inset
 * and the PWA-standalone lift stay in one place. Everything else is here:
 * 16px side insets, a 28px pill, blurred translucent fill, hairline border and
 * a soft shadow for lift.
 *
 * Five items — Activity is desktop-only (see navItems).
 */
export default function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'mobile-tabbar fixed inset-x-4 z-50 flex items-center justify-around',
        'rounded-[28px] border-[0.5px] border-border bg-background/80 px-1.5 py-2.5',
        'shadow-[0_6px_24px_rgb(0_0_0/0.10),0_1px_3px_rgb(0_0_0/0.06)] backdrop-blur-[20px]',
        'lg:hidden',
      )}
    >
      {mobileNavItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex min-w-14 flex-col items-center gap-[3px] transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )
          }
        >
          <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          <span className="text-[10px] leading-none">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
