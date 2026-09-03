import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { RoleChip } from '@/auth/RoleChip';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * The layout, at all three widths.
 *
 * Above 900px the action sits left and its context right. Between 520 and 900 it becomes one
 * column with the action first. Below 520 it is the phone layout. **Nothing is removed at any
 * width** — a counter tablet turned portrait is still the same app, and a writer who learned where
 * something was on the tablet must find it on the phone. Only the arrangement changes.
 *
 * The top bar is the reference's: a wordmark carrying the shop's name, and plain text links.
 * **No icons in the nav.** Six words a writer reads once and then navigates by position; icons
 * would be six more things to learn and, at this size, six ambiguous glyphs.
 */

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/new', label: 'New charge' },
  { to: '/charges', label: 'Charges' },
  { to: '/payouts', label: 'Payouts', ownerOnly: true },
  { to: '/staff', label: 'Staff', ownerOnly: true },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { session, canSeeMoney, signOut } = useAuth();

  return (
    <div className="min-h-dvh bg-[var(--clear-surface-0)] text-[var(--clear-text-primary)]">
      <div className="mx-auto max-w-[1180px] px-5">
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b-[0.5px] border-[var(--clear-border)] pb-3.5 pt-4">
          <span className="text-[15px] font-semibold tracking-[-0.2px]">
            Clear <span className="font-normal text-[var(--clear-text-muted)]">for {STUB_MERCHANT.name}</span>
          </span>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--clear-text-secondary)]">
            {NAV.filter((n) => !('ownerOnly' in n && n.ownerOnly) || canSeeMoney).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : undefined}
                className={({ isActive }) =>
                  isActive ? 'text-[var(--clear-text-primary)]' : 'text-[var(--clear-text-secondary)]'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {/* Every screen carries a role chip: who is acting is never implicit. */}
            {session && <RoleChip name={session.staff.name} role={session.staff.role} />}
            {session && (
              <button
                type="button"
                onClick={signOut}
                className="text-[11.5px] text-[var(--clear-text-secondary)] underline underline-offset-2"
              >
                Sign out
              </button>
            )}
          </div>
          </div>
        </header>

        <main className="py-5">{children}</main>
      </div>
    </div>
  );
}

/**
 * Two columns above 900px, one below — action first either way.
 *
 * A container query rather than a media query, so the arrangement follows the space the content
 * actually has: correct in a split-screen tablet as well as a full one.
 */
export function Columns({ action, context }: { action: ReactNode; context: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col">{action}</div>
        <div className="flex min-w-0 flex-col">{context}</div>
      </div>
    </div>
  );
}
