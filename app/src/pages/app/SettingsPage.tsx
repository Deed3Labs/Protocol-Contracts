import { Landmark, CreditCard, ShieldCheck, BellRing, CircleHelp, LogOut, Sun, Moon } from 'lucide-react';
import ScreenHeader from '@/components/app-ui/ScreenHeader';
import SectionCard from '@/components/app-ui/SectionCard';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

/**
 * Settings — profile, linked accounts, cards, security, preferences.
 * Scaffold: appearance toggle is live; the rest are placeholders pending wiring.
 */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="animate-fade-in lg:mx-auto lg:max-w-2xl">
      <ScreenHeader title="Settings" />

      <div className="mb-6 flex items-center gap-3 rounded-3xl border border-black/[0.06] bg-card p-4 dark:border-white/[0.06]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-lg font-medium text-accent-foreground">
          SS
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-foreground">Steven Spark</div>
          <div className="truncate text-xs text-muted-foreground">steven@clearpath.xyz</div>
        </div>
        <button
          type="button"
          className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
        >
          Manage
        </button>
      </div>

      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Account</h3>
      <div className="space-y-2.5">
        <SectionCard icon={Landmark} tint="external" title="Linked accounts" subtitle="2 banks via Plaid" chevron />
        <SectionCard icon={CreditCard} tint="neutral" title="Cards" subtitle="Manage your cards" chevron />
        <SectionCard icon={ShieldCheck} tint="neutral" title="Security" subtitle="Passcode & biometrics" chevron />
      </div>

      <h3 className="mb-3 mt-7 text-xs font-medium text-muted-foreground">Preferences</h3>
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 rounded-3xl border border-black/[0.06] bg-card p-4 dark:border-white/[0.06]">
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
            className={cn(
              'relative h-7 w-12 rounded-full transition-colors',
              isDark ? 'bg-primary' : 'bg-input',
            )}
          >
            <span
              className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-card shadow-sm ring-1 ring-black/10 transition-transform dark:ring-white/15"
              style={{ transform: isDark ? 'translateX(20px)' : 'none' }}
            />
          </button>
        </div>
        <SectionCard icon={BellRing} tint="neutral" title="Notifications" subtitle="Alerts & reminders" chevron />
        <SectionCard icon={CircleHelp} tint="neutral" title="Help & support" chevron />
      </div>

      <button
        type="button"
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 py-3 text-sm font-medium text-destructive transition-transform active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}
