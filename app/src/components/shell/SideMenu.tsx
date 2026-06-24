import { NavLink, useNavigate } from 'react-router-dom';
import { X, ChevronRight, Sun, Moon, ShieldCheck, FileText, CircleHelp, LogOut, type LucideIcon } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';
import { navItems } from './navItems';

const secondary: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: 'Security & privacy' },
  { icon: FileText, label: 'Documents' },
  { icon: CircleHelp, label: 'Help center' },
];

/**
 * Collapsible side menu — a hamburger-triggered slide-in overlay (modeled on the
 * old portfolio SideMenu). Primary nav, account links, theme switch, and log out.
 */
export default function SideMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="animate-slide-in-left relative flex h-full w-full max-w-[340px] flex-col border-r border-border bg-background p-6 shadow-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg font-medium text-secondary-foreground">
              SS
            </div>
            <div>
              <div className="font-medium text-foreground">Steven Spark</div>
              <div className="text-xs text-muted-foreground">Member</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="-mx-2 flex-1 space-y-7 overflow-y-auto px-2">
          <div>
            <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Navigate</h3>
            <div className="space-y-0.5">
              {navItems.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2.5 transition-colors',
                      isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )
                  }
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{label}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 opacity-60" />
                </NavLink>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</h3>
            <div className="space-y-0.5">
              {secondary.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{label}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 opacity-60" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance</h3>
            <div className="flex rounded-xl border border-border bg-secondary p-1">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all',
                  !isDark ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Sun className="h-4 w-4" /> Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all',
                  isDark ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Moon className="h-4 w-4" /> Dark
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/');
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-5 w-5" /> Log out
          </button>
          <div className="mt-4 text-center text-xs text-muted-foreground">Clear · v1.0</div>
        </div>
      </div>
    </div>
  );
}
