import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import TopNav from './TopNav';
import MobileTabBar from './MobileTabBar';
import { MobileActionProvider } from './MobileAction';
import { navItems } from './navItems';
import { capitalise } from '@/lib/clearModel';

/**
 * The visual shell — design spec §1. Deliberately free of providers and data so
 * the preview harness can mount it directly.
 *
 * Desktop: horizontal top bar. Mobile: compact header + floating tab bar, with
 * 96px of bottom padding on the content so the last card clears the pill.
 */
export default function AppChrome({
  children,
  trailing,
}: {
  children: ReactNode;
  /** Avatar / notifications cluster. Provider-backed, so it's injected. */
  trailing?: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = navItems.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  const isHome = pathname === '/';

  // Routes off the nav — Settings from the avatar, Contacts and Partners from
  // Send — still need a title, and one that matches what the link promised.
  const OFF_NAV: Record<string, string> = {
    '/contacts': 'Contacts',
    '/partners': 'Clear Partners',
    '/settings': 'Settings',
    '/assurance': 'Assurance',
    '/alerts': 'Alerts',
    '/scan': 'Scan to pay',
    '/learn/patronage': 'How patronage works',
    '/learn/assurance-reserve': 'The assurance reserve',
    '/learn/disputes': 'Dispute resolution',
  };
  const fallbackTitle = pathname.replace(/^\//, '').split('/')[0];
  const title =
    active?.label ?? OFF_NAV[pathname] ?? (fallbackTitle ? capitalise(fallbackTitle) : 'Clear');

  return (
    <MobileActionProvider>
      <div className="min-h-screen bg-background">
      <TopNav trailing={trailing} />

      {/* Mobile header — wordmark on Home, page name elsewhere */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md lg:hidden">
        <div className="flex h-14 items-center justify-between px-5">
          {isHome ? (
            <NavLink to="/" className="text-[15px] font-medium leading-none text-foreground">
              Clear
            </NavLink>
          ) : (
            <span className="flex min-w-0 items-center gap-2.5">
              {/* A page reached from another page gets a way back; the tab bar is
                  the way back from everything else, so it would be noise there.
                  Settings is excluded because it has levels of its own and draws
                  the back arrow for them itself — two would disagree. */}
              {!active && pathname !== '/settings' && (
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => navigate(-1)}
                  className="-ml-1 text-foreground-secondary"
                >
                  <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
              )}
              <span className="truncate text-[15px] font-medium text-foreground">{title}</span>
            </span>
          )}
          {trailing && <div className="flex items-center gap-1">{trailing}</div>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-5 pb-24 pt-4 lg:px-10 lg:pb-12 lg:pt-7">
        {children}
      </main>

      <MobileTabBar />
      </div>
    </MobileActionProvider>
  );
}
