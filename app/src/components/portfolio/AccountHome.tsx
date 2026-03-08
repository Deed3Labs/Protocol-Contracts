import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppKitAccount } from '@reown/appkit/react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Copy,
  Crown,
  Edit3,
  FileText,
  Flame,
  Gift,
  Globe,
  KeyRound,
  Landmark,
  Link2,
  Plus,
  ScanFace,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type AccountTab = 'profile' | 'connections' | 'security' | 'support';
type WalletKind = 'Primary' | 'Hardware' | 'Smart' | 'Embedded';
type SocialVisibility = 'Public' | 'Private';
type Tone = 'emerald' | 'sky' | 'amber' | 'zinc';

interface ProfileFormState {
  legalName: string;
  displayName: string;
  email: string;
  phone: string;
  location: string;
  residency: string;
  timezone: string;
  currency: string;
  bio: string;
}

interface WalletRecord {
  id: string;
  label: string;
  address: string;
  network: string;
  kind: WalletKind;
  verified: boolean;
  note: string;
  lastActive: string;
}

interface WalletDraft {
  label: string;
  address: string;
  network: string;
  kind: WalletKind;
  note: string;
}

interface SocialRecord {
  id: string;
  platform: string;
  handle: string;
  visibility: SocialVisibility;
  status: 'Connected' | 'Pending';
}

interface SocialDraft {
  platform: string;
  handle: string;
  visibility: SocialVisibility;
}

interface SecurityControl {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
}

interface MissionRailItem {
  id: string;
  label: string;
  detail: string;
  progress: number;
  tab: AccountTab;
  icon: LucideIcon;
}

interface AccountAchievement {
  id: string;
  name: string;
  detail: string;
  icon: LucideIcon;
  unlocked: boolean;
  tone: Tone;
  tab: AccountTab;
}

interface AccountPerk {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  unlocked: boolean;
  requirement: string;
  tone: Tone;
}

const ACCOUNT_TABS: AccountTab[] = ['profile', 'connections', 'security', 'support'];
const NETWORK_LABELS: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  84532: 'Base Sepolia',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
};

const DEFAULT_SECURITY_CONTROLS: SecurityControl[] = [
  {
    id: 'signature-lock',
    label: 'Signature lock on sensitive changes',
    description: 'Require a fresh wallet confirmation before profile or payout updates.',
    icon: KeyRound,
    enabled: true,
  },
  {
    id: 'session-review',
    label: 'Session review reminders',
    description: 'Prompt a quick security review when new devices or browsers appear.',
    icon: ShieldCheck,
    enabled: true,
  },
  {
    id: 'biometric-access',
    label: 'Biometric sign-in',
    description: 'Prefer device biometrics or passkeys when your wallet provider supports it.',
    icon: ScanFace,
    enabled: true,
  },
  {
    id: 'social-discovery',
    label: 'Public social discovery',
    description: 'Let other users find your profile from linked social handles.',
    icon: Globe,
    enabled: false,
  },
  {
    id: 'transfer-alerts',
    label: 'High-value transfer alerts',
    description: 'Push immediate alerts for large transfers, new banks, or wallet additions.',
    icon: Bell,
    enabled: true,
  },
];

const BLANK_WALLET_DRAFT: WalletDraft = {
  label: '',
  address: '',
  network: '',
  kind: 'Hardware',
  note: '',
};

const BLANK_SOCIAL_DRAFT: SocialDraft = {
  platform: '',
  handle: '',
  visibility: 'Public',
};

const LEVELS = [
  { label: 'Scout', min: 0, max: 499 },
  { label: 'Navigator', min: 500, max: 849 },
  { label: 'Curator', min: 850, max: 1199 },
  { label: 'Steward', min: 1200, max: 1599 },
  { label: 'Prime', min: 1600, max: 9999 },
] as const;

const sectionMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};
const sectionTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const };

const formatCurrencyCompact = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(amount);

  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}k`;

  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCurrency = (value: number | null | undefined) =>
  `$${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortAddress = (value: string) =>
  value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

const getNetworkLabel = (chainId?: number) => {
  if (!chainId) return 'Connected wallet';
  return NETWORK_LABELS[chainId] ?? `Chain ${chainId}`;
};

const toTitleCase = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const clampPercent = (value: number) => Math.max(0, Math.min(Math.round(value), 100));

const toneClasses: Record<Tone, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  zinc: 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300',
};

function SectionPanel({
  title,
  eyebrow,
  description,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
      <div className="border-b border-zinc-200/70 pb-3 dark:border-zinc-800/70">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            {eyebrow ? (
              <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">{eyebrow}</p>
            ) : null}
            <h2 className="mt-1 text-lg font-light tracking-tight text-black dark:text-white">{title}</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
          {action}
        </div>
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-sm border border-zinc-200/70 p-3 dark:border-zinc-800/70">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-base font-medium text-black dark:text-white">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

function MissionRail({ item, onOpen }: { item: MissionRailItem; onOpen: (tab: AccountTab) => void }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(item.tab)}
      className="group w-full rounded-sm border border-zinc-200/70 p-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-[#121212]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-[#121212] dark:text-zinc-200">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{item.label}</p>
            <p className="mt-1 text-[12px] leading-5 text-zinc-700 dark:text-zinc-300">{item.detail}</p>
          </div>
        </div>
        <span className="shrink-0 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
          {item.progress}%
        </span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-300 group-hover:opacity-100"
          style={{ width: `${item.progress}%` }}
        />
      </div>
    </button>
  );
}

function AchievementTile({
  achievement,
  onOpen,
}: {
  achievement: AccountAchievement;
  onOpen: (tab: AccountTab) => void;
}) {
  const Icon = achievement.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(achievement.tab)}
      className={cn(
        'flex min-h-[88px] w-full flex-col justify-between rounded-sm border border-zinc-200/70 bg-white p-3 text-left text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:bg-[#141414] dark:text-zinc-400 dark:hover:bg-[#121212]'
      )}
      title={achievement.detail}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border',
            achievement.unlocked ? toneClasses[achievement.tone] : toneClasses.zinc
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <span
          className={cn(
            'text-[10px] uppercase tracking-[0.18em]',
            achievement.unlocked ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
          )}
        >
          {achievement.unlocked ? 'Unlocked' : 'Locked'}
        </span>
      </div>
      <div className="mt-4">
        <p className="text-xs font-medium text-black dark:text-white">{achievement.name}</p>
        <p className="mt-1 text-[10px] leading-4 opacity-80">{achievement.detail}</p>
      </div>
    </button>
  );
}

function AccountPulseCard({
  levelLabel,
  levelNumber,
  levelProgress,
  accountXp,
  nextLevelLabel,
  accountStreak,
  checkedInToday,
  onCheckIn,
  rewardPoints,
  profileCompletion,
  securityScore,
  accountSurfaceCount,
  nextSteps,
}: {
  levelLabel: string;
  levelNumber: number;
  levelProgress: number;
  accountXp: number;
  nextLevelLabel: string;
  accountStreak: number;
  checkedInToday: boolean;
  onCheckIn: () => void;
  rewardPoints: number;
  profileCompletion: number;
  securityScore: number;
  accountSurfaceCount: number;
  nextSteps: string[];
}) {
  return (
    <section className="rounded-sm border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#141414]">
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        <div className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Account Pulse
              </p>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-[28px] font-light text-black dark:text-white">{accountStreak}</span>
                <span className="pb-1 text-xs text-zinc-500 dark:text-zinc-400">day streak</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {levelLabel} Lv.{levelNumber}
              </p>
            </div>
            <Button
              variant={checkedInToday ? 'outline' : 'default'}
              size="sm"
              className="rounded-full"
              onClick={onCheckIn}
            >
              <Flame className="h-4 w-4" />
              {checkedInToday ? 'Checked in' : 'Check in'}
            </Button>
          </div>

          <div className="mt-4 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500"
              style={{ width: `${levelProgress}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>{accountXp} XP</span>
            <span>{levelProgress >= 100 ? 'Max tier' : `Next: ${nextLevelLabel}`}</span>
          </div>
        </div>

        <div className="py-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
              <p className="text-sm font-semibold">{rewardPoints}</p>
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Points</p>
            </div>
            <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
              <p className="text-sm font-semibold">{profileCompletion}%</p>
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Profile</p>
            </div>
            <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
              <p className="text-sm font-semibold">{securityScore}%</p>
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Security</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            {accountSurfaceCount} connected surface{accountSurfaceCount === 1 ? '' : 's'} across this account.
          </p>
        </div>

        <div className="pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Focus Queue
            </p>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {Math.min(nextSteps.length, 3)} items
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {(nextSteps.length > 0 ? nextSteps.slice(0, 3) : ['Everything important on this account page is covered.']).map(
              (step, index) => (
                <div key={step} className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    {index + 1}
                  </div>
                  <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">{step}</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountRewardsCard({
  achievements,
  perks,
  onOpen,
}: {
  achievements: AccountAchievement[];
  perks: AccountPerk[];
  onOpen: (tab: AccountTab) => void;
}) {
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
  const unlockedPerks = perks.filter((perk) => perk.unlocked).length;

  return (
    <section className="rounded-sm border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#141414]">
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        <div className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Achievements
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {unlockedCount}/{achievements.length}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {achievements.map((achievement) => (
              <AchievementTile key={achievement.id} achievement={achievement} onOpen={onOpen} />
            ))}
          </div>
        </div>

        <div className="pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Perks & Rewards
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unlockedPerks} active</span>
          </div>
          <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200/70 dark:divide-zinc-800 dark:border-zinc-800/70">
            {perks.map((perk) => (
              <div key={perk.id} className="flex items-start gap-3 py-3">
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border',
                    perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc
                  )}
                >
                  <perk.icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-black dark:text-white">{perk.name}</p>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-[0.16em]',
                        perk.unlocked ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                      )}
                    >
                      {perk.unlocked ? 'Active' : perk.requirement}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                    {perk.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AccountHome() {
  const { address } = useAppKitAccount();
  const { user, chainId } = useAppKitAuth();
  const { totalBalanceUSD, cashBalance, holdings, bankAccounts, bankAccountsLoading } = usePortfolio();
  const { profileMenuUser, setActionModalOpen } = useGlobalModals();
  const [searchParams, setSearchParams] = useSearchParams();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<string>('Not saved yet');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [walletDraft, setWalletDraft] = useState<WalletDraft>(BLANK_WALLET_DRAFT);
  const [socialDialogOpen, setSocialDialogOpen] = useState(false);
  const [editingSocialId, setEditingSocialId] = useState<string | null>(null);
  const [socialDraft, setSocialDraft] = useState<SocialDraft>(BLANK_SOCIAL_DRAFT);
  const [refreshingBanks, setRefreshingBanks] = useState(false);
  const [accountStreak, setAccountStreak] = useState(14);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [rewardPoints, setRewardPoints] = useState(320);

  const initialProfileForm = useMemo<ProfileFormState>(
    () => ({
      legalName: '',
      displayName:
        profileMenuUser?.name && profileMenuUser.name !== 'Username' ? profileMenuUser.name : '',
      email:
        profileMenuUser?.email && profileMenuUser.email !== 'user@example.com'
          ? profileMenuUser.email
          : user?.email || '',
      phone: '',
      location: 'Los Angeles, CA',
      residency: 'United States',
      timezone: 'Pacific Time (PT)',
      currency: 'USD',
      bio: 'Building a portable onchain account center for identity, wallets, and trust signals.',
    }),
    [profileMenuUser, user?.email]
  );

  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfileForm);
  const [securityControls, setSecurityControls] = useState<SecurityControl[]>(DEFAULT_SECURITY_CONTROLS);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<SocialRecord[]>([]);

  const activeTabParam = searchParams.get('tab');
  const activeTab: AccountTab = ACCOUNT_TABS.includes(activeTabParam as AccountTab)
    ? (activeTabParam as AccountTab)
    : 'profile';

  useEffect(() => {
    const onScroll = () => setIsScrolledPast(window.scrollY > 88);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!ACCOUNT_TABS.includes(activeTabParam as AccountTab)) {
      setSearchParams({ tab: 'profile' }, { replace: true });
    }
  }, [activeTabParam, setSearchParams]);

  useEffect(() => {
    setProfileForm((current) => ({
      ...current,
      displayName: current.displayName || initialProfileForm.displayName,
      email: current.email || initialProfileForm.email,
    }));
  }, [initialProfileForm.displayName, initialProfileForm.email]);

  useEffect(() => {
    if (!bannerMessage) return;
    const timer = window.setTimeout(() => setBannerMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [bannerMessage]);

  useEffect(() => {
    if (!address) return;

    setWallets((current) => {
      const primaryWallet: WalletRecord = {
        id: 'wallet-primary',
        label: 'Primary wallet',
        address,
        network: getNetworkLabel(chainId),
        kind: 'Primary',
        verified: true,
        note: 'Active signer for your ClearPath account.',
        lastActive: 'Active now',
      };
      const existing = current.find((wallet) => wallet.id === 'wallet-primary');

      if (!existing) return [primaryWallet, ...current];

      return current.map((wallet) => (wallet.id === 'wallet-primary' ? primaryWallet : wallet));
    });
  }, [address, chainId]);

  useEffect(() => {
    if (!user?.social) return;

    const authSocial: SocialRecord = {
      id: `social-${user.social.provider}`,
      platform: toTitleCase(user.social.provider),
      handle: user.social.id,
      visibility: 'Public',
      status: 'Connected',
    };

    setSocialAccounts((current) => {
      const existing = current.find((account) => account.id === authSocial.id);
      if (!existing) return [authSocial, ...current];
      return current.map((account) => (account.id === authSocial.id ? authSocial : account));
    });
  }, [user?.social]);

  const profileFieldsComplete = useMemo(
    () =>
      [
        profileForm.legalName.trim(),
        profileForm.displayName.trim(),
        profileForm.email.trim(),
        profileForm.phone.trim(),
        profileForm.location.trim(),
        profileForm.bio.trim(),
      ].filter(Boolean).length,
    [profileForm]
  );

  const profileProgress = clampPercent((profileFieldsComplete / 6) * 100);
  const connectionProgress = clampPercent(
    ([wallets.length > 0, socialAccounts.length > 0, bankAccounts.length > 0].filter(Boolean).length / 3) * 100
  );
  const securityEnabledCount = securityControls.filter((control) => control.enabled).length;
  const securityScore = clampPercent((securityEnabledCount / securityControls.length) * 100);
  const supportProgress = clampPercent(
    (Number(profileSavedAt !== 'Not saved yet') + Number(Boolean(profileForm.email)) + Number(Boolean(profileForm.phone)) + Number(securityEnabledCount >= 4)) * 25
  );
  const securityTone = securityScore >= 80 ? 'Strong' : securityScore >= 60 ? 'Balanced' : 'Needs work';
  const activeNetworks = useMemo(
    () => new Set(holdings.map((holding) => holding.chainName).filter(Boolean)).size,
    [holdings]
  );

  const profileCompletion = clampPercent(
    ([
      Boolean(profileForm.legalName.trim()),
      Boolean(profileForm.displayName.trim()),
      Boolean(profileForm.email.trim()),
      Boolean(profileForm.phone.trim()),
      Boolean(profileForm.location.trim()),
      Boolean(profileForm.bio.trim()),
      wallets.length > 0,
      socialAccounts.length > 0,
      bankAccounts.length > 0,
      securityEnabledCount >= 4,
    ].filter(Boolean).length / 10) * 100
  );

  const accountSurfaceCount = wallets.length + socialAccounts.length + bankAccounts.length;
  const accountXp =
    profileCompletion * 9 +
    securityEnabledCount * 50 +
    Math.min(accountStreak * 12, 240) +
    socialAccounts.length * 40 +
    bankAccounts.length * 50;
  const levelIndex = LEVELS.findIndex((level) => accountXp >= level.min && accountXp <= level.max);
  const currentLevel = LEVELS[levelIndex >= 0 ? levelIndex : 0];
  const nextLevel = LEVELS[Math.min((levelIndex >= 0 ? levelIndex : 0) + 1, LEVELS.length - 1)];
  const levelFloor = currentLevel.min;
  const levelCeiling = currentLevel.max;
  const levelProgress = currentLevel.label === nextLevel.label
    ? 100
    : clampPercent(((accountXp - levelFloor) / (levelCeiling - levelFloor + 1)) * 100);

  const missionTrack = useMemo<MissionRailItem[]>(
    () => [
      {
        id: 'profile',
        label: 'Core profile',
        detail: profileProgress === 100 ? 'Identity ready' : `${6 - profileFieldsComplete} fields left`,
        progress: profileProgress,
        tab: 'profile',
        icon: UserRound,
      },
      {
        id: 'connections',
        label: 'Connection map',
        detail:
          connectionProgress === 100
            ? 'Wallets, socials, and rails set'
            : `${3 - [wallets.length > 0, socialAccounts.length > 0, bankAccounts.length > 0].filter(Boolean).length} surfaces left`,
        progress: connectionProgress,
        tab: 'connections',
        icon: Link2,
      },
      {
        id: 'security',
        label: 'Trust lock',
        detail: `${securityEnabledCount}/${securityControls.length} protections active`,
        progress: securityScore,
        tab: 'security',
        icon: ShieldCheck,
      },
      {
        id: 'support',
        label: 'Support pack',
        detail: supportProgress >= 100 ? 'Export and recovery ready' : 'Tighten response coverage',
        progress: supportProgress,
        tab: 'support',
        icon: FileText,
      },
    ],
    [bankAccounts.length, connectionProgress, profileFieldsComplete, profileProgress, securityEnabledCount, securityScore, securityControls.length, socialAccounts.length, supportProgress, wallets.length]
  );

  const accountAchievements = useMemo<AccountAchievement[]>(
    () => [
      {
        id: 'profile-prime',
        name: 'Profile Prime',
        detail: 'Complete all core profile fields',
        icon: Star,
        unlocked: profileProgress === 100,
        tone: 'sky',
        tab: 'profile',
      },
      {
        id: 'wallet-graph',
        name: 'Wallet Graph',
        detail: 'Add more than one trusted wallet',
        icon: Wallet,
        unlocked: wallets.length >= 2,
        tone: 'emerald',
        tab: 'connections',
      },
      {
        id: 'signal-proof',
        name: 'Signal Proof',
        detail: 'Link at least one social handle',
        icon: Sparkles,
        unlocked: socialAccounts.length >= 1,
        tone: 'amber',
        tab: 'connections',
      },
      {
        id: 'trust-lock',
        name: 'Trust Lock',
        detail: 'Reach 4 active protections',
        icon: ShieldCheck,
        unlocked: securityEnabledCount >= 4,
        tone: 'emerald',
        tab: 'security',
      },
      {
        id: 'cash-rail',
        name: 'Cash Rail',
        detail: 'Connect at least one institution',
        icon: Landmark,
        unlocked: bankAccounts.length >= 1,
        tone: 'sky',
        tab: 'connections',
      },
      {
        id: 'archive-ready',
        name: 'Archive Ready',
        detail: 'Save profile once to prepare exports',
        icon: Trophy,
        unlocked: profileSavedAt !== 'Not saved yet',
        tone: 'zinc',
        tab: 'support',
      },
    ],
    [bankAccounts.length, profileProgress, profileSavedAt, securityEnabledCount, socialAccounts.length, wallets.length]
  );

  const accountPerks = useMemo<AccountPerk[]>(
    () => [
      {
        id: 'priority-support',
        name: 'Priority support lane',
        description: 'Faster review context for profile and recovery issues.',
        icon: Crown,
        unlocked: securityEnabledCount >= 4,
        requirement: 'Enable 4 protections',
        tone: 'emerald',
      },
      {
        id: 'verified-ribbon',
        name: 'Verified account ribbon',
        description: 'Stronger trust signal once profile and socials are complete.',
        icon: Sparkles,
        unlocked: profileCompletion >= 80 && socialAccounts.length > 0,
        requirement: 'Finish profile + 1 social',
        tone: 'sky',
      },
      {
        id: 'recovery-fastpass',
        name: 'Recovery fast-pass',
        description: 'Cleaner handoff for identity checks and account escalations.',
        icon: Gift,
        unlocked: Boolean(profileForm.email && profileForm.phone && wallets.length > 0),
        requirement: 'Add phone + email',
        tone: 'amber',
      },
    ],
    [profileCompletion, profileForm.email, profileForm.phone, securityEnabledCount, socialAccounts.length, wallets.length]
  );

  const unlockedAchievementCount = accountAchievements.filter((achievement) => achievement.unlocked).length;
  const nextSteps = [
    !profileForm.legalName.trim() ? 'Add a legal name for compliance-ready account updates.' : null,
    !profileForm.phone.trim() ? 'Add a recovery phone for higher-trust account review.' : null,
    socialAccounts.length === 0 ? 'Link a social account to unlock stronger profile trust.' : null,
    bankAccounts.length === 0 ? 'Connect a funding source to complete your account rail.' : null,
    securityEnabledCount < 4 ? 'Turn on one more protection control to reach a strong security posture.' : null,
  ].filter(Boolean) as string[];

  const handleTabOpen = (tab: AccountTab) => setSearchParams({ tab });

  const handleProfileFieldChange = (field: keyof ProfileFormState, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const handleProfileSave = () => {
    const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    setProfileSavedAt(savedAt);
    setBannerMessage('Profile changes saved to the local UI preview.');
  };

  const handleCopyAddress = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setBannerMessage('Wallet address copied.');
    } catch (error) {
      console.error('Failed to copy wallet address:', error);
      setBannerMessage('Clipboard access was blocked in this environment.');
    }
  };

  const handleAccountPulse = () => {
    if (checkedInToday) {
      setBannerMessage('Daily account pulse already logged.');
      return;
    }

    setCheckedInToday(true);
    setAccountStreak((current) => current + 1);
    setRewardPoints((current) => current + 25);
    setBannerMessage('Daily account pulse logged. +25 reward points.');
  };

  const openWalletDialog = (wallet?: WalletRecord) => {
    setEditingWalletId(wallet?.id ?? null);
    setWalletDraft(
      wallet
        ? {
            label: wallet.label,
            address: wallet.address,
            network: wallet.network,
            kind: wallet.kind,
            note: wallet.note,
          }
        : {
            ...BLANK_WALLET_DRAFT,
            network: getNetworkLabel(chainId),
          }
    );
    setWalletDialogOpen(true);
  };

  const saveWallet = () => {
    if (!walletDraft.label.trim() || !walletDraft.address.trim() || !walletDraft.network.trim()) {
      setBannerMessage('Wallet label, address, and network are required.');
      return;
    }

    const nextWallet: WalletRecord = {
      id: editingWalletId ?? `wallet-${Date.now()}`,
      label: walletDraft.label.trim(),
      address: walletDraft.address.trim(),
      network: walletDraft.network.trim(),
      kind: walletDraft.kind,
      verified: editingWalletId === 'wallet-primary' || walletDraft.kind !== 'Embedded',
      note: walletDraft.note.trim() || 'Added from the account center.',
      lastActive: editingWalletId ? 'Updated just now' : 'Added just now',
    };

    setWallets((current) => {
      if (editingWalletId) {
        return current.map((wallet) => (wallet.id === editingWalletId ? nextWallet : wallet));
      }
      return [...current, nextWallet];
    });

    setWalletDialogOpen(false);
    setWalletDraft(BLANK_WALLET_DRAFT);
    setEditingWalletId(null);
    setBannerMessage(editingWalletId ? 'Wallet details updated.' : 'Associated wallet added.');
  };

  const removeWallet = (walletId: string) => {
    if (walletId === 'wallet-primary') return;
    setWallets((current) => current.filter((wallet) => wallet.id !== walletId));
    setBannerMessage('Wallet removed from this account view.');
  };

  const openSocialDialog = (account?: SocialRecord) => {
    setEditingSocialId(account?.id ?? null);
    setSocialDraft(
      account
        ? {
            platform: account.platform,
            handle: account.handle,
            visibility: account.visibility,
          }
        : BLANK_SOCIAL_DRAFT
    );
    setSocialDialogOpen(true);
  };

  const saveSocial = () => {
    if (!socialDraft.platform.trim() || !socialDraft.handle.trim()) {
      setBannerMessage('Platform and handle are required to link a social account.');
      return;
    }

    const nextSocial: SocialRecord = {
      id:
        editingSocialId ??
        `social-${socialDraft.platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      platform: socialDraft.platform.trim(),
      handle: socialDraft.handle.trim(),
      visibility: socialDraft.visibility,
      status: 'Connected',
    };

    setSocialAccounts((current) => {
      if (editingSocialId) {
        return current.map((account) => (account.id === editingSocialId ? nextSocial : account));
      }
      return [...current, nextSocial];
    });

    setSocialDialogOpen(false);
    setSocialDraft(BLANK_SOCIAL_DRAFT);
    setEditingSocialId(null);
    setBannerMessage(editingSocialId ? 'Social account updated.' : 'Social account linked.');
  };

  const removeSocial = (socialId: string) => {
    setSocialAccounts((current) => current.filter((account) => account.id !== socialId));
    setBannerMessage('Social account removed from this account view.');
  };

  const toggleSecurityControl = (controlId: string) => {
    setSecurityControls((current) =>
      current.map((control) =>
        control.id === controlId ? { ...control, enabled: !control.enabled } : control
      )
    );
  };

  const handleRefreshBanks = async () => {
    setRefreshingBanks(true);
    window.setTimeout(() => {
      setRefreshingBanks(false);
      setBannerMessage('Institution refresh is a UI placeholder for the upcoming sync flow.');
    }, 650);
  };

  return (
    <div className="min-h-screen bg-white pb-20 font-sans text-black transition-colors duration-200 dark:bg-[#0e0e0e] dark:text-white md:pb-0">
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <HeaderNav
        isScrolledPast={isScrolledPast}
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />

      <main className="container mx-auto pt-24 pb-28 md:pt-32">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12 md:gap-12">
          <div className="space-y-8 md:col-span-8">
            <motion.div {...sectionMotion} transition={sectionTransition} className="pt-4">
              <div className="flex flex-wrap items-center gap-2 text-zinc-500 dark:text-zinc-400">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Account Center</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span className="text-xs">{currentLevel.label} Lv.{Math.min(levelIndex + 1, LEVELS.length)}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span className="text-xs">{rewardPoints} pts</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span className="text-xs">{securityTone} posture</span>
              </div>

              <h1 className="mt-2 text-[30px] font-light tracking-tight text-black dark:text-white md:text-[36px]">
                {profileForm.displayName || profileMenuUser?.name || 'Account profile'}
              </h1>

              <p className="mt-2 max-w-2xl text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">
                Manage the identity layer of the product without burying it in settings. This page ties together
                profile, trusted surfaces, privacy controls, and account progression in one cleaner flow.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>{profileForm.email || 'Add an email address'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>{address ? shortAddress(address) : 'Wallet not connected'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>{activeNetworks || 1} active network{activeNetworks === 1 ? '' : 's'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>UI-only preview</span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button
                  size="sm"
                  className="rounded-full bg-black px-4 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  onClick={() => handleTabOpen('profile')}
                >
                  <Edit3 className="h-4 w-4" />
                  Edit profile
                </Button>
                <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => handleTabOpen('connections')}>
                  <Plus className="h-4 w-4" />
                  Add connection
                </Button>
                <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => handleTabOpen('security')}>
                  <Shield className="h-4 w-4" />
                  Review security
                </Button>
              </div>

              {bannerMessage ? (
                <div className="mt-5 border-y border-emerald-500/30 bg-emerald-500/10 px-0 py-3 text-[12px] leading-5 text-emerald-800 dark:text-emerald-300">
                  {bannerMessage}
                </div>
              ) : null}
            </motion.div>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="border-b border-zinc-200/70 pb-3 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-light tracking-tight text-black dark:text-white">Account Snapshot</h2>
                    <p className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                      Core identity and connection signals, shown with the same restrained treatment as the portfolio pages.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {unlockedAchievementCount}/{accountAchievements.length} unlocked
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <HeroMetric label="Protected balance" value={formatCurrencyCompact(totalBalanceUSD)} detail="Combined onchain and linked cash surfaces" />
                <HeroMetric label="Connected surfaces" value={String(accountSurfaceCount)} detail="Wallets, socials, and institutions attached" />
                <HeroMetric label="Profile completion" value={`${profileCompletion}%`} detail="Identity, trust, and support readiness" />
                <HeroMetric label="Cash visibility" value={formatCurrencyCompact(cashBalance.totalCash)} detail="Displayed for UI context only" />
              </div>
            </section>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="border-b border-zinc-200/70 pb-3 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-light tracking-tight text-black dark:text-white">Progress Track</h2>
                    <p className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                      Four account tracks, kept visible without wrapping the whole experience in a single container.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {missionTrack.length} tracks
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {missionTrack.map((item) => (
                  <MissionRail key={item.id} item={item} onOpen={handleTabOpen} />
                ))}
              </div>
            </section>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.04 }}>
              <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })}>
                <TabsList className="h-auto w-full flex-wrap justify-start gap-5 rounded-none border-b border-zinc-200/70 bg-transparent p-0 dark:border-zinc-800/70">
                  <TabsTrigger
                    value="profile"
                    className="rounded-none border-b-2 border-transparent px-0 pb-3 pt-0 text-[11px] uppercase tracking-[0.18em] text-zinc-500 shadow-none data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:border-zinc-100 dark:data-[state=active]:text-zinc-100"
                  >
                    Profile
                  </TabsTrigger>
                  <TabsTrigger
                    value="connections"
                    className="rounded-none border-b-2 border-transparent px-0 pb-3 pt-0 text-[11px] uppercase tracking-[0.18em] text-zinc-500 shadow-none data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:border-zinc-100 dark:data-[state=active]:text-zinc-100"
                  >
                    Connections
                  </TabsTrigger>
                  <TabsTrigger
                    value="security"
                    className="rounded-none border-b-2 border-transparent px-0 pb-3 pt-0 text-[11px] uppercase tracking-[0.18em] text-zinc-500 shadow-none data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:border-zinc-100 dark:data-[state=active]:text-zinc-100"
                  >
                    Security
                  </TabsTrigger>
                  <TabsTrigger
                    value="support"
                    className="rounded-none border-b-2 border-transparent px-0 pb-3 pt-0 text-[11px] uppercase tracking-[0.18em] text-zinc-500 shadow-none data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:border-zinc-100 dark:data-[state=active]:text-zinc-100"
                  >
                    Support
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-8 pt-5">
                  <SectionPanel
                    eyebrow="Identity"
                    title="Personal information"
                    description="Keep editing obvious and direct. The account layer should feel closer to a profile editor than a settings maze."
                    action={<Button variant="outline" size="sm" onClick={handleProfileSave}>Save profile</Button>}
                  >
                    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="legalName">Legal name</Label>
                        <Input id="legalName" value={profileForm.legalName} onChange={(event) => handleProfileFieldChange('legalName', event.target.value)} placeholder="Jane Doe" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display name</Label>
                        <Input id="displayName" value={profileForm.displayName} onChange={(event) => handleProfileFieldChange('displayName', event.target.value)} placeholder="jane.clear" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={profileForm.email} onChange={(event) => handleProfileFieldChange('email', event.target.value)} placeholder="jane@clearpath.app" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Recovery phone</Label>
                        <Input id="phone" value={profileForm.phone} onChange={(event) => handleProfileFieldChange('phone', event.target.value)} placeholder="(555) 123-4567" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location">Location</Label>
                        <Input id="location" value={profileForm.location} onChange={(event) => handleProfileFieldChange('location', event.target.value)} placeholder="Los Angeles, CA" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="residency">Residency</Label>
                        <Input id="residency" value={profileForm.residency} onChange={(event) => handleProfileFieldChange('residency', event.target.value)} placeholder="United States" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="timezone">Timezone</Label>
                        <Input id="timezone" value={profileForm.timezone} onChange={(event) => handleProfileFieldChange('timezone', event.target.value)} placeholder="Pacific Time (PT)" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="currency">Settlement currency</Label>
                        <Input id="currency" value={profileForm.currency} onChange={(event) => handleProfileFieldChange('currency', event.target.value)} placeholder="USD" />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="bio">Bio</Label>
                        <Textarea id="bio" className="min-h-[112px]" value={profileForm.bio} onChange={(event) => handleProfileFieldChange('bio', event.target.value)} placeholder="Tell other users what this account is for." />
                      </div>
                    </div>
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      <HeroMetric label="Core fields" value={`${profileFieldsComplete}/6`} detail="Identity details filled in" />
                      <HeroMetric label="Last saved" value={profileSavedAt} detail="Local UI preview only" />
                      <HeroMetric label="Account mode" value="Preview" detail="No backend or persistence wired yet" />
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Defaults"
                    title="Account defaults"
                    description="Use dividers and compact summary rows instead of more settings cards."
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <HeroMetric label="Primary region" value={profileForm.residency || 'Unset'} detail="Controls disclosures and cash movement defaults" />
                      <HeroMetric label="Notification timezone" value={profileForm.timezone || 'Unset'} detail="Used for statements, support windows, and alerts" />
                      <HeroMetric label="Settlement currency" value={profileForm.currency || 'Unset'} detail="Normalizes account-level exports and summaries" />
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="connections" className="space-y-8 pt-5">
                  <SectionPanel
                    eyebrow="Wallet graph"
                    title="Associated wallets"
                    description="Keep trusted wallet surfaces in a clean list with labels, trust state, and minimal actions."
                    action={<Button variant="outline" size="sm" onClick={() => openWalletDialog()}><Plus className="h-4 w-4" />Add wallet</Button>}
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {wallets.map((wallet, index) => (
                        <div key={wallet.id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-start md:justify-between', index !== wallets.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                          <div className="flex min-w-0 gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                              <Wallet className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-black dark:text-white">{wallet.label}</p>
                                <span className={cn('text-[10px] uppercase tracking-[0.18em]', wallet.verified ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
                                  {wallet.verified ? 'Verified' : 'Pending'}
                                </span>
                              </div>
                              <p className="mt-2 font-mono text-sm text-zinc-600 dark:text-zinc-300">{wallet.address}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                                <span>{wallet.kind}</span>
                                <span>•</span>
                                <span>{wallet.network}</span>
                                <span>•</span>
                                <span>{wallet.lastActive}</span>
                              </div>
                              <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{wallet.note}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <Button variant="outline" size="sm" onClick={() => handleCopyAddress(wallet.address)}><Copy className="h-4 w-4" />Copy</Button>
                            <Button variant="outline" size="sm" onClick={() => openWalletDialog(wallet)}><Edit3 className="h-4 w-4" />Edit</Button>
                            {wallet.id !== 'wallet-primary' ? (
                              <Button variant="outline" size="sm" onClick={() => removeWallet(wallet.id)}><Trash2 className="h-4 w-4" />Remove</Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Social graph"
                    title="Linked social accounts"
                    description="Surface handles as lightweight rows, not mini profile cards."
                    action={<Button variant="outline" size="sm" onClick={() => openSocialDialog()}><Plus className="h-4 w-4" />Link social</Button>}
                  >
                    {socialAccounts.length === 0 ? (
                      <div className="border-y border-dashed border-zinc-300/80 px-0 py-8 text-center dark:border-zinc-700">
                        <p className="text-sm font-medium text-black dark:text-white">No social accounts linked yet</p>
                        <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">Add X, Farcaster, Discord, GitHub, or another identity layer when you are ready.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                        {socialAccounts.map((account, index) => (
                          <div key={account.id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== socialAccounts.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-[#121212] dark:text-zinc-200">
                                {account.platform.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.platform}</p>
                                  <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                                    {account.status} • {account.visibility}
                                  </span>
                                </div>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">{account.handle}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 md:justify-end">
                              <Button variant="outline" size="sm" onClick={() => openSocialDialog(account)}><Edit3 className="h-4 w-4" />Edit</Button>
                              <Button variant="outline" size="sm" onClick={() => removeSocial(account.id)}><Trash2 className="h-4 w-4" />Remove</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Funding rails"
                    title="Linked banks and cash accounts"
                    description="Show banking rails as part of the account graph, but keep the UI-only flow obvious for now."
                    action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={handleRefreshBanks} disabled={refreshingBanks}>{refreshingBanks ? 'Refreshing...' : 'Refresh'}</Button><Button size="sm" onClick={() => setBannerMessage('Funding link and institution onboarding will be wired in the next pass.')}><ArrowUpRight className="h-4 w-4" />Link funds</Button></div>}
                  >
                    {bankAccountsLoading ? (
                      <div className="border-y border-zinc-200/70 px-0 py-8 text-[12px] leading-5 text-zinc-500 dark:border-zinc-800/70 dark:text-zinc-400">Loading linked institutions...</div>
                    ) : bankAccounts.length === 0 ? (
                      <div className="border-y border-dashed border-zinc-300/80 px-0 py-8 text-center dark:border-zinc-700">
                        <p className="text-sm font-medium text-black dark:text-white">No banks connected</p>
                        <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">Link a checking, savings, or brokerage account to complete the funding layer later.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                        {bankAccounts.map((account, index) => (
                          <div key={account.account_id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== bankAccounts.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Landmark className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.name}</p>
                                  <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                                    {account.subtype || account.type || 'linked'}
                                  </span>
                                </div>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{account.mask ? `•••• ${account.mask}` : 'Mask unavailable'}</p>
                              </div>
                            </div>
                            <div className="text-left md:text-right">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Available</p>
                              <p className="mt-2 text-base font-medium text-black dark:text-white">{formatCurrency(account.available)}</p>
                              {account.current != null ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Current {formatCurrency(account.current)}</p> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="security" className="space-y-8 pt-5">
                  <SectionPanel
                    eyebrow="Trust controls"
                    title="Security and privacy"
                    description="Treat protections like a clean checklist with visible state, not a pile of preference cards."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {securityControls.map((control, index) => {
                        const Icon = control.icon;
                        return (
                          <div key={control.id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== securityControls.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{control.label}</p>
                                  <span className={cn('text-[11px] uppercase tracking-[0.16em]', control.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 dark:text-zinc-400')}>
                                    {control.enabled ? 'Enabled' : 'Off'}
                                  </span>
                                </div>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{control.description}</p>
                              </div>
                            </div>
                            <Button variant={control.enabled ? 'default' : 'outline'} size="sm" onClick={() => toggleSecurityControl(control.id)}>
                              {control.enabled ? 'Turn off' : 'Turn on'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Recovery"
                    title="Recovery surfaces"
                    description="Map the primary trust anchors with dividers and labels so the account is readable at a glance."
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <HeroMetric label="Primary signer" value={address ? shortAddress(address) : 'Not connected'} detail="Wallet signatures remain the highest-trust recovery path" />
                      <HeroMetric label="Recovery contacts" value={profileForm.phone || 'Add a recovery phone'} detail="Phone and email speed up security review" />
                      <HeroMetric label="Exposure map" value={`${wallets.length} wallets / ${bankAccounts.length} rails`} detail="Review trusted surfaces regularly to reduce stale links" />
                    </div>
                    <div className="mt-5 space-y-2">
                      {accountPerks.map((perk) => (
                        <div key={perk.id} className="flex items-center justify-between gap-3 text-[12px]">
                          <div className="flex items-center gap-2">
                            <div className={cn('flex h-7 w-7 items-center justify-center rounded-full border', perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc)}>
                              <perk.icon className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="font-medium text-black dark:text-white">{perk.name}</p>
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{perk.description}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                            {perk.unlocked ? 'Active' : perk.requirement}
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="support" className="space-y-8 pt-5">
                  <SectionPanel
                    eyebrow="Documents"
                    title="Statements and exports"
                    description="Keep documents in clean rows with compact actions instead of more tiles."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {[
                        { title: 'Monthly statements', detail: 'Snapshot of balances, linked accounts, and transfers.', cta: 'Prepare PDF' },
                        { title: 'Tax package', detail: 'Export a year-to-date activity package for off-platform review.', cta: 'Generate export' },
                        { title: 'Account archive', detail: 'Bundle profile, wallets, socials, and support metadata.', cta: 'Export JSON' },
                      ].map((item, index, array) => (
                        <div key={item.title} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== array.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                          <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <FileText className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-black dark:text-white">{item.title}</p>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                              </div>
                            </div>
                          <Button variant="outline" size="sm" onClick={() => setBannerMessage(`${item.cta} queued in the local preview.`)}>{item.cta}</Button>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Support"
                    title="Support and privacy requests"
                    description="Put trust-and-safety, support, and privacy requests in one readable stream."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {[
                        { icon: Shield, title: 'Account review', detail: 'Report suspicious changes or request a manual review of linked surfaces.', cta: 'Open review request' },
                        { icon: Sparkles, title: 'Priority support', detail: 'Share profile, connection, and trust context in one support conversation.', cta: 'Contact support' },
                        { icon: AlertTriangle, title: 'Privacy request', detail: 'Request export or deletion of profile metadata stored beyond your wallet signature.', cta: 'Start privacy request' },
                      ].map((item, index, array) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.title} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== array.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-black dark:text-white">{item.title}</p>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                              </div>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setBannerMessage(`${item.title} opened in the local preview.`)}>{item.cta}</Button>
                          </div>
                        );
                      })}
                    </div>
                  </SectionPanel>
                </TabsContent>
              </Tabs>
            </motion.div>
          </div>

          <div className="space-y-8 md:col-span-4">
            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.08 }}>
              <AccountPulseCard
                levelLabel={currentLevel.label}
                levelNumber={Math.min(levelIndex + 1, LEVELS.length)}
                levelProgress={levelProgress}
                accountXp={accountXp}
                nextLevelLabel={currentLevel.label === nextLevel.label ? 'Max tier' : nextLevel.label}
                accountStreak={accountStreak}
                checkedInToday={checkedInToday}
                onCheckIn={handleAccountPulse}
                rewardPoints={rewardPoints}
                profileCompletion={profileCompletion}
                securityScore={securityScore}
                accountSurfaceCount={accountSurfaceCount}
                nextSteps={nextSteps}
              />
            </motion.div>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.12 }}>
              <AccountRewardsCard achievements={accountAchievements} perks={accountPerks} onOpen={handleTabOpen} />
            </motion.div>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="space-y-2 rounded-sm border border-zinc-200/70 bg-gradient-to-r from-zinc-100/70 to-sky-50/60 p-4 dark:border-zinc-800/70 dark:from-[#141414] dark:to-[#10181a]">
                <p className="text-sm font-medium text-black dark:text-white">Portable identity. Cleaner account control.</p>
                <p className="text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
                  This screen stays intentionally UI-first for now. The goal is to make profile, wallet, social, and
                  trust management feel native to the product before the real data layer is wired in.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Dialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen}>
        <DialogContent className="border-zinc-200 dark:border-zinc-800 dark:bg-[#111111]">
          <DialogHeader>
            <DialogTitle>{editingWalletId ? 'Edit associated wallet' : 'Add associated wallet'}</DialogTitle>
            <DialogDescription>
              Save the wallet label, network, and note you want attached to this account center.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="walletLabel">Label</Label>
              <Input id="walletLabel" value={walletDraft.label} onChange={(event) => setWalletDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Treasury Safe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletAddress">Wallet address</Label>
              <Input id="walletAddress" value={walletDraft.address} onChange={(event) => setWalletDraft((current) => ({ ...current, address: event.target.value }))} placeholder="0x..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletNetwork">Network</Label>
              <Input id="walletNetwork" value={walletDraft.network} onChange={(event) => setWalletDraft((current) => ({ ...current, network: event.target.value }))} placeholder="Base" />
            </div>
            <div className="space-y-2">
              <Label>Wallet type</Label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(['Primary', 'Hardware', 'Smart', 'Embedded'] as WalletKind[]).map((kind) => (
                  <Button key={kind} type="button" variant={walletDraft.kind === kind ? 'default' : 'outline'} size="sm" onClick={() => setWalletDraft((current) => ({ ...current, kind }))}>
                    {kind}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletNote">Note</Label>
              <Textarea id="walletNote" className="min-h-[96px]" value={walletDraft.note} onChange={(event) => setWalletDraft((current) => ({ ...current, note: event.target.value }))} placeholder="What is this wallet used for?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWalletDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveWallet}>Save wallet</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={socialDialogOpen} onOpenChange={setSocialDialogOpen}>
        <DialogContent className="border-zinc-200 dark:border-zinc-800 dark:bg-[#111111]">
          <DialogHeader>
            <DialogTitle>{editingSocialId ? 'Edit social account' : 'Link social account'}</DialogTitle>
            <DialogDescription>
              Attach the platform and handle you want displayed or used for support verification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="socialPlatform">Platform</Label>
              <Input id="socialPlatform" value={socialDraft.platform} onChange={(event) => setSocialDraft((current) => ({ ...current, platform: event.target.value }))} placeholder="Farcaster" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="socialHandle">Handle / ID</Label>
              <Input id="socialHandle" value={socialDraft.handle} onChange={(event) => setSocialDraft((current) => ({ ...current, handle: event.target.value }))} placeholder="@janeclear" />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['Public', 'Private'] as SocialVisibility[]).map((visibility) => (
                  <Button key={visibility} type="button" variant={socialDraft.visibility === visibility ? 'default' : 'outline'} size="sm" onClick={() => setSocialDraft((current) => ({ ...current, visibility }))}>
                    {visibility}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSocialDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveSocial}>Save social</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
