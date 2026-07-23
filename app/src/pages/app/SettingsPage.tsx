import { useEffect, useState } from 'react';
import { Landmark, CreditCard, ShieldCheck, BellRing, CircleHelp, LogOut, Sun, Sunset, Moon, Wallet, Users, UserSearch, type LucideIcon } from 'lucide-react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getDirectoryOptout, setDirectoryOptout } from '@/utils/apiClient';
import SectionCard from '@/components/app-ui/SectionCard';
import CardVisual from '@/components/app-ui/CardVisual';
import { AccountModal, CardsModal, SecurityModal, NotificationsModal, SupportModal } from '@/components/app-ui/SettingsModals';
import { useTheme } from '@/context/ThemeContext';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useContacts } from '@/context/ContactsContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useKyc } from '@/context/KycContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useLogout } from '@/hooks/useLogout';
import { cn } from '@/lib/utils';

type SettingsModal = 'account' | 'cards' | 'security' | 'notifications' | 'support' | null;

const THEMES: { id: 'light' | 'dusk' | 'dark'; icon: LucideIcon; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dusk', icon: Sunset, label: 'Dusk' },
  { id: 'dark', icon: Moon, label: 'Dark' },
];

/** Settings — denser card layout to match the dashboard. Theme toggle is live. */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { openManager, wallets } = useLinkedWallets();
  const { openManager: openContacts, contacts } = useContacts();
  const { openManager: openExternal, accounts: externalAccounts } = useExternalAccounts();
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const ActiveIcon = active.icon;
  const [modal, setModal] = useState<SettingsModal>(null);
  const logout = useLogout();
  const { verified, openKyc } = useKyc();
  const profile = useMemberProfile();
  const { address } = useAppKitAccount();

  // Member-directory discoverability (on by default; toggling off opts out of email/phone lookup).
  const [discoverable, setDiscoverable] = useState(true);
  useEffect(() => {
    if (!address) return;
    void getDirectoryOptout(address).then((out) => setDiscoverable(!out));
  }, [address]);
  const toggleDiscoverable = () => {
    if (!address) return;
    const next = !discoverable;
    setDiscoverable(next); // optimistic
    void setDirectoryOptout(address, !next).then((out) => setDiscoverable(!out));
  };

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, accounts, and preferences.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-xl font-medium text-secondary-foreground">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-medium text-foreground">{profile.name}</div>
              <div className="truncate text-sm text-muted-foreground">{profile.handle}</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className="rounded-lg bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Member</span>
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">
                    <ShieldCheck className="h-3 w-3" /> KYC verified
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openKyc()}
                    className="inline-flex items-center gap-1 rounded-lg bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info transition-colors hover:bg-info/15"
                  >
                    <ShieldCheck className="h-3 w-3" /> Verify identity
                  </button>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setModal('account')} className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted">
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
        <CardVisual onManage={() => setModal('cards')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard
          icon={Landmark}
          tint="neutral"
          title="External accounts"
          subtitle={`${externalAccounts.length} ${externalAccounts.length === 1 ? 'bank' : 'banks'} via Plaid`}
          chevron
          onClick={openExternal}
        />
        <SectionCard
          icon={Wallet}
          tint="neutral"
          title="Linked wallets"
          subtitle={`${wallets.length} connected`}
          chevron
          onClick={openManager}
        />
        <SectionCard
          icon={Users}
          tint="neutral"
          title="Contacts"
          subtitle={`${contacts.length} people`}
          chevron
          onClick={() => openContacts()}
        />
        <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <UserSearch className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">Directory discovery</span>
            <span className="block text-xs text-muted-foreground">
              {discoverable ? 'Others can find you by email or phone' : "You're hidden from email/phone lookup"}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={discoverable}
            aria-label="Directory discovery"
            onClick={toggleDiscoverable}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              discoverable ? 'bg-foreground' : 'bg-secondary',
            )}
          >
            <span className={cn('inline-block h-5 w-5 transform rounded-full bg-card shadow transition-transform', discoverable ? 'translate-x-[22px]' : 'translate-x-0.5')} />
          </button>
        </div>

        <SectionCard icon={CreditCard} tint="neutral" title="Cards" subtitle="Cards & virtual account" chevron onClick={() => setModal('cards')} />
        <SectionCard icon={ShieldCheck} tint="neutral" title="Security" subtitle="Passcode & biometrics" chevron onClick={() => setModal('security')} />
        <SectionCard icon={BellRing} tint="neutral" title="Notifications" subtitle="Alerts & reminders" chevron onClick={() => setModal('notifications')} />

        <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-4">
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

        <SectionCard icon={CircleHelp} tint="neutral" title="Help & support" subtitle="Guides & contact" chevron onClick={() => setModal('support')} />
      </div>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 py-3 text-sm font-medium text-destructive transition-transform active:scale-[0.99] sm:w-auto sm:px-8"
      >
        <LogOut className="h-4 w-4" /> Log out
      </button>

      <AccountModal open={modal === 'account'} onOpenChange={(o) => !o && setModal(null)} />
      <CardsModal open={modal === 'cards'} onOpenChange={(o) => !o && setModal(null)} />
      <SecurityModal open={modal === 'security'} onOpenChange={(o) => !o && setModal(null)} />
      <NotificationsModal open={modal === 'notifications'} onOpenChange={(o) => !o && setModal(null)} />
      <SupportModal open={modal === 'support'} onOpenChange={(o) => !o && setModal(null)} />
    </div>
  );
}
