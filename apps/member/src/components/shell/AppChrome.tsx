import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import TopNav from './TopNav';
import Wordmark from './Wordmark';
import MobileTabBar from './MobileTabBar';
import { MobileActionProvider } from './MobileAction';
import { navItems } from './navItems';
import { capitalise } from '@/lib/clearModel';

/**
 * The visual shell. Deliberately free of providers and data so the preview harness can mount it
 * directly.
 *
 * The page colour is set here, on the document chrome, rather than on each component. The guide's
 * own trap: a colour reset kept as an allowlist of surfaces leaks every time a new surface is added,
 * and text goes paper-on-paper. Scoping paper, ink and the text face to the shell means everything
 * inside inherits them and nothing has to opt in.
 *
 * Desktop: the top bar. Mobile: lockup, bell and avatar in the header, and the nav bar pinned to the
 * bottom, with 96px of padding on the content so the last component clears it.
 */
export default function AppChrome({
  children,
  trailing,
}: {
  children: ReactNode;
  /** Bell and avatar. Provider-backed, so they're injected. */
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
    '/inbox': 'Inbox',
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
      <div className="c-text min-h-screen bg-paper">
        <TopNav trailing={trailing} />

        {/* Mobile header — the lockup on Home, the page name elsewhere. */}
        <header className="sticky top-0 z-30 bg-paper px-s2 lg:hidden">
          <div className="c-line items-center! py-s2">
            {isHome ? (
              <Wordmark sm />
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
                    className="-ml-1 text-ink-50"
                  >
                    <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </button>
                )}
                <span className="truncate text-body font-semibold text-ink">{title}</span>
              </span>
            )}
            {trailing}
          </div>
        </header>

        {/* 1168 = the top bar's 1120 plus its 24px sides, so content shares the bar's left edge. */}
        <main className="mx-auto w-full max-w-[1168px] px-s2 pb-s6 pt-s1 lg:px-s3 lg:pb-s4 lg:pt-s3">
          {children}
        </main>

        <MobileTabBar />
      </div>
    </MobileActionProvider>
  );
}
