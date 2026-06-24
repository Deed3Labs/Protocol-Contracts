import { NavLink } from 'react-router-dom';
import { Wallet, Send, LineChart, Settings, Home, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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

/**
 * Persistent desktop sidebar (lg+), collapsible between a labeled panel (w-64)
 * and an icon-only rail (w-[76px]). Fixed-position so the main content scrolls
 * independently (window scroll). Hidden on mobile (the SideMenu drawer takes over).
 */
export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2.5 px-5')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-lg text-primary-foreground">
          C
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-display text-lg leading-none tracking-tight text-foreground">Clear</div>
            <div className="truncate text-[11px] text-muted-foreground">Turn rent into ownership</div>
          </div>
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

      <div className="space-y-3 p-3">
        {!collapsed && (
          <div className="rounded-2xl border border-border bg-secondary/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Home className="h-4 w-4 text-foreground" />
              <span className="text-sm font-medium text-foreground">Clear Deed</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              $6,240 in equity credits · 25% to your milestone.
            </p>
            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
              <div className="h-full w-1/4 rounded-full bg-primary" />
            </div>
            <button
              type="button"
              className="w-full rounded-xl bg-primary py-2 text-xs font-medium text-primary-foreground"
            >
              View progress
            </button>
          </div>
        )}
        <div className={cn('flex items-center rounded-xl py-1.5', collapsed ? 'justify-center' : 'gap-3 px-2')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
            SS
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">Steven Spark</div>
              <div className="truncate text-xs text-muted-foreground">steven@clearpath.xyz</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
