import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * The layout, at all three widths.
 *
 * Above 900px the action sits left and its context right. Between 520 and 900 it becomes one
 * column with the action first. Below 520 it is the phone layout. **Nothing is removed at any
 * width** — a counter tablet turned portrait is still the same app, and a writer who learned where
 * something was on the tablet must find it on the phone. Only the arrangement changes.
 *
 * The top bar is the reference's exactly: a wordmark carrying the shop's name, and five plain text
 * links. Things that are deliberately NOT here, having been in an earlier draft of this file:
 *
 * - **New charge.** It is the primary button on Home, not a sixth link. Putting it in the nav gives
 *   a writer two routes to the same place and makes the one real action look like navigation.
 * - **A role chip.** The brief asks for one on every screen *of the refund flow*, where authority
 *   moves between two people and the tablet has to say whose hands it is in. On Home it is chrome.
 * - **Sign out.** It lives in Settings, where a writer looks for it once a day at most.
 */

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/charges', label: 'Charges' },
  { to: '/payouts', label: 'Payouts', ownerOnly: true },
  { to: '/staff', label: 'Staff', ownerOnly: true },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { canSeeMoney } = useAuth();

  return (
    <div className="@container min-h-dvh bg-[var(--clear-surface-2)] text-[var(--clear-text-primary)]">
      <div className="mx-auto flex min-h-dvh max-w-[960px] flex-col px-5 py-6 @[520px]:px-6">
        <header className="mb-[18px] flex items-center justify-between gap-4 border-b-[0.5px] border-[var(--clear-border)] pb-[13px]">
          <span className="text-[15px] font-semibold tracking-[-0.2px]">
            Clear{' '}
            <span className="font-normal text-[var(--clear-text-muted)]">
              for {STUB_MERCHANT.name}
            </span>
          </span>

          <nav className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[12px] text-[var(--clear-text-secondary)] @[900px]:gap-x-5 @[900px]:text-[13px]">
            {NAV.filter((n) => !('ownerOnly' in n && n.ownerOnly) || canSeeMoney).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : undefined}
                className={({ isActive }) =>
                  isActive
                    ? 'text-[var(--clear-text-primary)]'
                    : 'text-[var(--clear-text-secondary)]'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

/**
 * Two equal columns above 900px, one below — action first either way.
 *
 * A container query rather than a media query, so the arrangement follows the space the content
 * actually has: correct in a split-screen tablet as well as a full one.
 */
export function Columns({ action, context }: { action: ReactNode; context: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col">{action}</div>
        <div className="flex min-w-0 flex-col">{context}</div>
      </div>
    </div>
  );
}
