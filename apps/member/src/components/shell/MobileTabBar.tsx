import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { mobileNavItems } from './navItems';
import { useMobileAction } from './MobileAction';
import { ActivityIcon, CardIcon, EarnIcon, HomeIcon, PlusIcon, SavingsIcon } from '@/components/clear/brand/icons';

/**
 * The quick actions — the same four Home offers on desktop, in the same order. Each is a route or a
 * route that opens a surface (see `?do=` in HomePage and SavingsPage), so a quick action can also be
 * linked to.
 */
const QUICK_ACTIONS = [
  { label: 'Add money', to: '/?do=add-money' },
  { label: 'Send', to: '/send' },
  { label: 'Save', to: '/savings?do=add' },
  { label: 'Pay', to: '/card' },
];

/** The guide's glyph for each destination. */
const GLYPH: Record<string, typeof HomeIcon> = {
  '/': HomeIcon,
  '/savings': SavingsIcon,
  '/earn': EarnIcon,
  '/activity': ActivityIcon,
  '/card': CardIcon,
};

/**
 * Mobile nav: the destinations in a bordered, rounded pill at the left and the action button, a
 * rounded square, at the right, with the space between them left open.
 *
 * The selected destination sits on a light key with its glyph in the ground colour; the rest are
 * ink-70. The action button is always icon-only. A page that declares an action of its own (Save,
 * Scan, Buy...) names it in the button's accessible label rather than on its face, so the bar keeps
 * one shape on every page. Without one, the button opens the quick-actions fan: right-aligned above
 * the nav, the plus rotating to a close, the screen behind dimmed rather than replaced, because
 * these are shortcuts, not a destination.
 *
 * Vertical offset lives in `.mobile-tabbar` (index.css) so the safe-area inset and the PWA-standalone
 * lift stay in one place.
 */
export default function MobileTabBar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const action = useMobileAction();

  // A fan left open across a navigation would cover the page you just landed on.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* The page behind dims to 12%, as drawn. Tapping it closes the fan. */}
      {open && (
        <button
          type="button"
          aria-label="Close quick actions"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-paper/88 lg:hidden"
        />
      )}

      {open && (
        <div className="c-qafan mobile-quick-actions fixed right-s2 z-50 lg:hidden">
          {QUICK_ACTIONS.map((item) => (
            <button key={item.label} type="button" className="c-qaitem" onClick={() => navigate(item.to)}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="c-navwrap mobile-tabbar fixed inset-x-s2 z-50 lg:hidden">
        <nav aria-label="Main" className="c-navbar">
          {mobileNavItems.map(({ to, label, end }) => {
            const Glyph = GLYPH[to] ?? HomeIcon;
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) => cn(isActive && 'c-on')}
              >
                {({ isActive }) => <Glyph strokeWidth={isActive ? 1.9 : 1.75} />}
              </NavLink>
            );
          })}
        </nav>

        <button
          type="button"
          aria-label={action ? action.label : open ? 'Close quick actions' : 'Quick actions'}
          aria-expanded={action ? undefined : open}
          onClick={() => (action ? action.onSelect() : setOpen((v) => !v))}
          className={cn('c-navfab', !action && open && 'c-open')}
        >
          {action ? <action.icon strokeWidth={2} /> : <PlusIcon />}
        </button>
      </div>
    </>
  );
}
