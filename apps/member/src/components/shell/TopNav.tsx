import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import Wordmark from './Wordmark';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

/**
 * Desktop top bar — the guide's `.topbar`.
 *
 * Lockup left; nav, then the bell and avatar as their own group on the right, so anything added to
 * the corner later sits with them rather than a nav-width gap away. The current page is ink at 500,
 * the rest ink-50. One ink-28 rule underneath — structure, not content.
 */
export default function TopNav({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 hidden bg-paper px-s3 lg:block">
      <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between border-b border-ink-28 py-s2">
        <Wordmark />

        <div className="c-tbright">
          <nav className="c-tbnav" aria-label="Main">
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => cn('hover:text-ink', isActive && 'c-on')}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          {trailing}
        </div>
      </div>
    </header>
  );
}
