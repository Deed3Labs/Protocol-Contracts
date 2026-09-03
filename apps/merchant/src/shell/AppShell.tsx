import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Banknote,
  CreditCard,
  Home,
  PlusCircle,
  Receipt,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { useAuth } from '@/auth/authContext';
import { RoleChip } from '@/auth/RoleChip';

/**
 * The layout, at all three widths.
 *
 * Above 900px the action sits left and its context right. Between 520 and 900 it becomes one
 * column with the action first. Below 520 it is the phone layout. **Nothing is removed at any
 * width** — a counter tablet turned portrait is still the same app, and a writer who learned where
 * something was on the tablet must find it on the phone. Only the arrangement changes.
 *
 * `Columns` is the whole mechanism: a CSS grid that collapses, with the action rendered first in
 * source order so it is first in the single-column arrangement without any reordering.
 *
 * Icons are lucide SVGs. Never emoji or Unicode symbols as icons — they render differently on
 * every device, they are read aloud absurdly by screen readers, and half of them are not icons.
 */

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/new', label: 'New charge', icon: PlusCircle },
  { to: '/charges', label: 'Charges', icon: Receipt },
  { to: '/payouts', label: 'Payouts', icon: Banknote, ownerOnly: true },
  { to: '/staff', label: 'Staff', icon: Users, ownerOnly: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { session, canSeeMoney, signOut } = useAuth();

  return (
    <div className="min-h-dvh bg-[var(--clear-surface-0)] text-[var(--clear-text-primary)]">
      <header className="border-b border-[var(--clear-border)] bg-[var(--clear-surface-1)]">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-2.5">
          <CreditCard size={17} className="text-[var(--clear-text-accent)]" aria-hidden />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Clear</span>
          <span className="text-[13px] text-[var(--clear-text-muted)]">for Merchants</span>

          <div className="ml-auto flex items-center gap-3">
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

        <nav className="mx-auto max-w-[1180px] overflow-x-auto px-2">
          <ul className="flex gap-0.5">
            {NAV.filter((n) => !('ownerOnly' in n && n.ownerOnly) || canSeeMoney).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={'end' in item ? item.end : undefined}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13px]',
                      'border-b-2 -mb-px transition-colors',
                      isActive
                        ? 'border-[var(--clear-border-accent)] text-[var(--clear-text-accent)]'
                        : 'border-transparent text-[var(--clear-text-secondary)]',
                    ].join(' ')
                  }
                >
                  <item.icon size={15} aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-5">{children}</main>
    </div>
  );
}

/**
 * Two columns above 900px, one below — action first either way.
 *
 * The breakpoints are the reference's. Expressed in a container query rather than a media query so
 * the arrangement follows the space the content actually has, which is what makes the same code
 * correct in a split-screen tablet as on a full one.
 */
export function Columns({ action, context }: { action: ReactNode; context: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-5 @[900px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">{action}</div>
        <div className="min-w-0">{context}</div>
      </div>
    </div>
  );
}

/** A titled region. Present at every width — only its position moves. */
export function Panel({
  title,
  children,
  footnote,
}: {
  title?: string;
  children: ReactNode;
  footnote?: string;
}) {
  return (
    <section className="mb-5">
      {title && (
        <h2 className="mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
          {title}
        </h2>
      )}
      {children}
      {footnote && (
        <p className="mt-2 text-[11.5px] text-[var(--clear-text-muted)]">{footnote}</p>
      )}
    </section>
  );
}
