import { Landmark, CreditCard, ShieldCheck, BellRing, CircleHelp, LogOut, Sun, Moon } from 'lucide-react';
import SectionCard from '@/components/app-ui/SectionCard';
import CardVisual from '@/components/app-ui/CardVisual';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

/** Settings — denser card layout to match the dashboard. Theme toggle is live. */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, accounts, and preferences.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-medium text-secondary-foreground">
              SS
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-medium text-foreground">Steven Spark</div>
              <div className="truncate text-sm text-muted-foreground">steven@clearpath.xyz</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Member</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">KYC verified</span>
              </div>
            </div>
            <button type="button" className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted">
              Manage
            </button>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-5">
            <div>
              <div className="text-xs text-muted-foreground">Member since</div>
              <div className="text-sm font-medium text-foreground">Mar 2025</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Linked banks</div>
              <div className="text-sm font-medium text-foreground">2</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="text-sm font-medium text-foreground">Clear+</div>
            </div>
          </div>
        </div>
        <CardVisual />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard icon={Landmark} tint="neutral" title="Linked accounts" subtitle="2 banks via Plaid" chevron onClick={() => {}} />
        <SectionCard icon={CreditCard} tint="neutral" title="Cards" subtitle="Manage your cards" chevron onClick={() => {}} />
        <SectionCard icon={ShieldCheck} tint="neutral" title="Security" subtitle="Passcode & biometrics" chevron onClick={() => {}} />
        <SectionCard icon={BellRing} tint="neutral" title="Notifications" subtitle="Alerts & reminders" chevron onClick={() => {}} />

        <div className="flex items-center gap-3 rounded-3xl border border-border bg-card p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            {isDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">Appearance</span>
            <span className="block text-xs text-muted-foreground">{isDark ? 'Dark' : 'Light'} mode</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Toggle dark mode"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={cn('relative h-7 w-12 rounded-full transition-colors', isDark ? 'bg-primary' : 'bg-input')}
          >
            <span
              className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-card shadow-sm ring-1 ring-black/10 transition-transform dark:ring-white/15"
              style={{ transform: isDark ? 'translateX(20px)' : 'none' }}
            />
          </button>
        </div>

        <SectionCard icon={CircleHelp} tint="neutral" title="Help & support" subtitle="Guides & contact" chevron onClick={() => {}} />
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 py-3 text-sm font-medium text-destructive transition-transform active:scale-[0.99] sm:w-auto sm:px-8"
      >
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}
