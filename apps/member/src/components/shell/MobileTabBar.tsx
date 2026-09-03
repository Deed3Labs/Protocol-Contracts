import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Plus, ScanLine, ArrowLeftRight, PiggyBank, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mobileNavItems } from './navItems';
import { useMobileAction } from './MobileAction';

/**
 * The things you can start from anywhere, in the order they're reached for. Each
 * is a route or a route that opens a surface — see `?do=` in HomePage and
 * SavingsPage — so a quick action can also be linked to.
 */
const QUICK_ACTIONS = [
  { label: 'Scan to pay', icon: ScanLine, to: '/scan' },
  { label: 'Send or request', icon: ArrowLeftRight, to: '/send' },
  { label: 'Add to savings', icon: PiggyBank, to: '/savings?do=add' },
  { label: 'Add money', icon: Landmark, to: '/?do=add-money' },
];

/**
 * Floating mobile nav — design spec §1. Split in two: a pill of destinations on
 * the left, an action button on the right.
 *
 * The split is the point. The tabs are places you go; the button is the thing
 * you came to do, and it changes with the page — Save on Savings, Buy on Earn,
 * and everywhere else a plus that fans out the four things you can start from
 * anywhere. That's what makes room to drop Send from the pill without losing it:
 * it's an action, not a destination, and it was competing with places.
 *
 * Vertical offset lives in `.mobile-tabbar` (index.css) so the safe-area inset
 * and the PWA-standalone lift stay in one place.
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

  const fabIcon = action ? (
    <action.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
  ) : (
    <Plus
      className={cn('h-[21px] w-[21px] shrink-0 transition-transform', open && 'rotate-45')}
      strokeWidth={2}
    />
  );

  return (
    <>
      {/* Tapping anywhere off the fan closes it — the only way back on a phone
          with no cursor to move away. */}
      {open && (
        <button
          type="button"
          aria-label="Close quick actions"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-[2px] lg:hidden"
        />
      )}

      {open && (
        <div className="mobile-quick-actions fixed right-4 z-50 flex flex-col items-end gap-[7px] lg:hidden">
          {QUICK_ACTIONS.map((item, i) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.to)}
              style={{ transitionDelay: `${(QUICK_ACTIONS.length - 1 - i) * 30}ms` }}
              className={cn(
                'flex h-10 items-center gap-2.5 whitespace-nowrap rounded-[14px] border-[0.5px] border-border',
                'bg-card px-3.5 text-[13px] shadow-[0_4px_16px_rgb(0_0_0/0.12)]',
                'animate-in fade-in slide-in-from-bottom-2 fill-mode-both',
              )}
            >
              {item.label}
              <item.icon className="h-4 w-4 shrink-0 text-foreground-secondary" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      )}

      <div className="mobile-tabbar fixed inset-x-4 z-50 flex items-center justify-between gap-2.5 lg:hidden">
        <nav
          aria-label="Primary"
          className={cn(
            'relative flex h-[50px] shrink items-center gap-0.5 overflow-hidden rounded-[17px] px-[5px]',
            'border-[0.5px] border-border bg-background/85 backdrop-blur-[20px]',
            'shadow-[0_6px_22px_rgb(0_0_0/0.11)] transition-opacity',
            open && 'opacity-50',
          )}
        >
          {mobileNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'relative flex h-full w-11 items-center justify-center transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Marks where you are without spending a line on labels */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2.5 top-0 h-[2.5px] rounded-b-[2px] bg-tier-asset"
                    />
                  )}
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 1.9 : 1.75} />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          aria-label={action ? action.label : 'Quick actions'}
          aria-expanded={action ? undefined : open}
          onClick={() => (action ? action.onSelect() : setOpen((v) => !v))}
          className={cn(
            'flex h-[50px] shrink-0 items-center justify-center gap-[7px] rounded-[17px]',
            'bg-foreground text-background shadow-[0_6px_22px_rgb(0_0_0/0.2)]',
            'text-[13px] font-medium transition-transform active:scale-[0.97]',
            action ? 'px-4' : 'w-[50px]',
          )}
        >
          {fabIcon}
          {action && <span>{action.label}</span>}
        </button>
      </div>
    </>
  );
}
