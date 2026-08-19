import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import Wordmark from './Wordmark';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

/**
 * Desktop top bar — design spec §1.
 *
 * Wordmark left, nav right, 0.5px bottom border. Active item takes the primary
 * text color, inactive the secondary one. Hidden below `lg`, where the floating
 * pill takes over.
 *
 * `trailing` is a slot for the avatar/notifications cluster: the real menus need
 * the member/wallet providers, which the preview harness doesn't mount.
 */
export default function TopNav({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 hidden bg-background/85 backdrop-blur-md lg:block">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-6 border-b-[0.5px] border-border px-10">
        <Wordmark />

        <div className="flex items-center gap-6">
          <nav className="flex items-center gap-4">
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'text-[13px] transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-foreground-secondary',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          {trailing && <div className="flex items-center gap-1.5">{trailing}</div>}
        </div>
      </div>
    </header>
  );
}
