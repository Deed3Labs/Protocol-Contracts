import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BackIcon } from '@/components/clear/brand/icons';
import TopNav from './TopNav';
import Wordmark from './Wordmark';
import MobileTabBar from './MobileTabBar';
import { MobileActionProvider } from './MobileAction';
import { PaneTitleProvider, usePaneTitle } from './PaneTitle';
import { navItems } from './navItems';
import { capitalise } from '@/lib/clearModel';
import { SETTINGS_PAGES, settingsPageOf } from '@/pages/app/settingsPages';

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
export default function AppChrome(props: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <PaneTitleProvider>
      <Chrome {...props} />
    </PaneTitleProvider>
  );
}

function Chrome({
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
  // Every destination on the nav gets the lockup; a page reached from another gets its way back and
  // its title, like a pane.
  const showLockup = Boolean(active);

  // Routes off the nav — Settings from the avatar, Partners from
  // Send — still need a title, and one that matches what the link promised.
  const OFF_NAV: Record<string, string> = {
    '/partners': 'Clear Partners',
    '/settings': 'Settings',
    '/assurance': 'Assurance',
    '/inbox': 'Inbox',
    '/scan': 'Scan to pay',
    '/code': 'Your code',
    '/learn/assurance-reserve': 'The assurance reserve',
    '/assurance/reserve': 'The assurance reserve',
    '/assurance/reports': 'Reserve reports',
    '/assurance/claim': 'How to make a claim',
    '/learn/disputes': 'Dispute resolution',
  };
  const fallbackTitle = pathname.replace(/^\//, '').split('/')[0];
  const settingsPage = settingsPageOf(pathname);
  // A page can name itself — a thread is called after whoever is in it.
  const paneTitle = usePaneTitle();
  const title =
    paneTitle ??
    active?.label ??
    (settingsPage ? SETTINGS_PAGES[settingsPage].title : undefined) ??
    OFF_NAV[pathname] ??
    (fallbackTitle ? capitalise(fallbackTitle) : 'Clear');
  // A settings pane goes up one level; everything else goes back where it came from.
  const goBack = () => {
    if (settingsPage) return navigate(SETTINGS_PAGES[settingsPage].up);
    // A thread goes up to the list rather than back out of the Inbox.
    if (/^\/inbox\/.+/.test(pathname)) return navigate('/inbox');
    return navigate(-1);
  };

  return (
    <MobileActionProvider>
      <div className="c-text min-h-screen bg-paper">
        <TopNav trailing={trailing} />

        {/* Mobile header — the lockup on every nav page, a pane's back and title elsewhere. */}
        <header className="sticky top-0 z-30 bg-paper px-s2 lg:hidden">
          <div className="c-line items-center! py-s2">
            {showLockup ? (
              <Wordmark sm />
            ) : (
              <span className="c-paneback mb-0! min-w-0">
                {/* A page reached from another page gets a way back; the tab bar is
                    the way back from everything else, so it would be noise there. */}
                {!active && (
                  <button type="button" aria-label="Back" onClick={goBack} className="c-mclose">
                    <BackIcon />
                  </button>
                )}
                {/* A pane's title, as the guide draws it: 15px on a phone. */}
                <span className="c-panetitle truncate text-body!">{title}</span>
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
