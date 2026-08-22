import { Fragment, type ComponentType, type SVGProps } from 'react';
import { NavLink } from 'react-router-dom';
import { Wallet, Send, Receipt, Settings, Home, X, CreditCard, Umbrella, type LucideIcon } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { usePay } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';

const DEED_GOAL = 25000; // equity-credit milestone, matches ClearDeedCard
import { cn } from '@/lib/utils';
import Wordmark from '@/components/app-ui/Wordmark';
import { SunIcon, DuskIcon, MoonIcon } from '@/components/app-ui/ThemeIcons';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}
interface NavGroup {
  title: string;
  items: NavEntry[];
}

const groups: NavGroup[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Accounts', icon: Wallet, end: true }] },
  {
    title: 'Money',
    items: [
      { to: '/pay', label: 'Pay', icon: Send },
      { to: '/transactions', label: 'Transactions', icon: Receipt },
    ],
  },
  {
    title: 'Credit',
    items: [
      { to: '/borrow', label: 'Borrow', icon: CreditCard },
      { to: '/assurance', label: 'Assurance', icon: Umbrella },
    ],
  },
  { title: 'Account', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
];

const THEMES: { id: 'light' | 'dusk' | 'dark'; icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: 'light', icon: SunIcon, label: 'Light' },
  { id: 'dusk', icon: DuskIcon, label: 'Dusk' },
  { id: 'dark', icon: MoonIcon, label: 'Dark' },
];

/**
 * Shared sidebar contents, rendered by both the persistent desktop Sidebar and the
 * mobile SideMenu drawer so the two are identical. `collapsed` is the desktop icon-rail
 * mode; `onClose` shows a close button (mobile drawer); `onNavigate` fires on nav clicks
 * (mobile: closes the drawer).
 */
export default function SidebarNav({
  collapsed = false,
  onNavigate,
  onClose,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const profile = useMemberProfile();
  const { summary } = usePay();
  const deedCredits = Math.round(summary?.totalEquity ?? 0);
  const deedPct = Math.min(100, Math.round((deedCredits / DEED_GOAL) * 100));

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2.5 px-5')}>
        <img src={ClearPathLogo} alt="Clear" className="h-9 w-9 shrink-0 rounded-md border border-border object-cover" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <Wordmark className="text-xl" />
            <div className="-mt-0.5 truncate text-[11px] text-muted-foreground">Turn rent into ownership</div>
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {collapsed ? (
          /* icon rail — flat list with dividers between groups, evenly spaced */
          <div className="flex flex-col gap-1.5">
            {groups.map((g, gi) => (
              <Fragment key={g.title}>
                {gi > 0 && <div className="mx-auto h-px w-7 bg-border" />}
                {g.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={label}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center justify-center rounded-xl py-2.5 transition-colors',
                        isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                  </NavLink>
                ))}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.title}>
                <h3 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </h3>
                <div className="space-y-0.5">
                  {g.items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                          isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      <div>
        {!collapsed && (
          <div className="space-y-3 p-3">
            <div className="rounded-lg border border-border bg-secondary/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Home className="h-4 w-4 text-foreground" />
                <span className="text-sm font-medium text-foreground">Clear Deed</span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                ${deedCredits.toLocaleString()} in equity credits · {deedPct}% to your milestone.
              </p>
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-lg bg-background">
                <div className="h-full rounded-lg bg-primary transition-[width] duration-500" style={{ width: `${deedPct}%` }} />
              </div>
              <button type="button" className="w-full rounded-xl bg-primary py-2 text-xs font-medium text-primary-foreground">
                View progress
              </button>
            </div>

            {/* theme switch */}
            <div className="flex rounded-lg border border-border bg-secondary p-1">
              {THEMES.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  aria-label={label}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
                    theme === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* profile footer — full-width divider above */}
        <div className="border-t border-border p-3">
          <div className={cn('flex items-center rounded-xl py-1.5', collapsed ? 'justify-center' : 'gap-3 px-2')}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-xs font-medium text-secondary-foreground">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{profile.name}</div>
                <div className="truncate text-xs text-muted-foreground">{profile.handle}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
