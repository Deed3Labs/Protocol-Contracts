import { NavLink } from 'react-router-dom';
import { Wallet, Send, LineChart, Settings, Home, X, Sun, Sunset, Moon, type LucideIcon } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';
import Wordmark from '@/components/app-ui/Wordmark';
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
      { to: '/transactions', label: 'Transactions', icon: LineChart },
    ],
  },
  { title: 'Account', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
];

const THEMES: { id: 'light' | 'dusk' | 'dark'; icon: LucideIcon; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dusk', icon: Sunset, label: 'Dusk' },
  { id: 'dark', icon: Moon, label: 'Dark' },
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

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2.5 px-5')}>
        <img src={ClearPathLogo} alt="Clear" className="h-9 w-9 shrink-0 rounded-md border border-border object-cover" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <Wordmark className="text-2xl" />
            <div className="-mt-1 truncate text-[11px] text-muted-foreground">Turn rent into ownership</div>
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

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {groups.map((g) => (
          <div key={g.title}>
            {collapsed ? (
              <div className="mx-2 mb-2 h-px bg-border" />
            ) : (
              <h3 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.title}
              </h3>
            )}
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={collapsed ? label : undefined}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                      isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )
                  }
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
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
                $6,240 in equity credits · 25% to your milestone.
              </p>
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-lg bg-background">
                <div className="h-full w-1/4 rounded-lg bg-primary" />
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
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* profile footer — full-width divider above */}
        <div className="border-t border-border p-3">
          <div className={cn('flex items-center rounded-xl py-1.5', collapsed ? 'justify-center' : 'gap-3 px-2')}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-medium text-secondary-foreground">
              SS
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">Steven Spark</div>
                <div className="truncate text-xs text-muted-foreground">steven@useclear.org</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
