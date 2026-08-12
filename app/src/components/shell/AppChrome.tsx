import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import TopNav from './TopNav';
import MobileTabBar from './MobileTabBar';
import { navItems } from './navItems';

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
  const active = navItems.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  const isHome = pathname === '/';

  return (
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
            <span className="text-[15px] font-medium text-foreground">{active?.label ?? 'Clear'}</span>
          )}
          {trailing && <div className="flex items-center gap-1">{trailing}</div>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-5 pb-24 pt-4 lg:px-8 lg:pb-12 lg:pt-7">
        {children}
      </main>

      <MobileTabBar />
    </div>
  );
}
