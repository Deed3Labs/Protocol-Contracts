import { Landmark, CreditCard, ShieldCheck, BellRing, CircleHelp, LogOut, Sun, Sunset, Moon, Wallet, type LucideIcon } from 'lucide-react';
import SectionCard from '@/components/app-ui/SectionCard';
import CardVisual from '@/components/app-ui/CardVisual';
import { useTheme } from '@/context/ThemeContext';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { cn } from '@/lib/utils';

const THEMES: { id: 'light' | 'dusk' | 'dark'; icon: LucideIcon; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dusk', icon: Sunset, label: 'Dusk' },
  { id: 'dark', icon: Moon, label: 'Dark' },
];

/** Settings — denser card layout to match the dashboard. Theme toggle is live. */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { openManager, wallets } = useLinkedWallets();
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const ActiveIcon = active.icon;

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, accounts, and preferences.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-secondary text-xl font-medium text-secondary-foreground">
              SS
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-medium text-foreground">Steven Spark</div>
              <div className="truncate text-sm text-muted-foreground">steven@useclear.org</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className="rounded-lg bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Member</span>
                <span className="rounded-lg bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">KYC verified</span>
              </div>
            </div>
            <button type="button" className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted">
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
        <SectionCard
          icon={Wallet}
          tint="neutral"
          title="Linked wallets"
          subtitle={`${wallets.length} connected`}
          chevron
          onClick={openManager}
        />
        <SectionCard icon={CreditCard} tint="neutral" title="Cards" subtitle="Manage your cards" chevron onClick={() => {}} />
        <SectionCard icon={ShieldCheck} tint="neutral" title="Security" subtitle="Passcode & biometrics" chevron onClick={() => {}} />
        <SectionCard icon={BellRing} tint="neutral" title="Notifications" subtitle="Alerts & reminders" chevron onClick={() => {}} />

        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">Appearance</span>
            <span className="block text-xs text-muted-foreground">{active.label} mode</span>
          </span>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-secondary p-0.5">
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-label={`${label} theme`}
                aria-pressed={theme === id}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  theme === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <SectionCard icon={CircleHelp} tint="neutral" title="Help & support" subtitle="Guides & contact" chevron onClick={() => {}} />
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 py-3 text-sm font-medium text-destructive transition-transform active:scale-[0.99] sm:w-auto sm:px-8"
      >
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}
