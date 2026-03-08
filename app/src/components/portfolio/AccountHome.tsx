import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppKitAccount } from '@reown/appkit/react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  ChevronRight,
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
import { Badge } from '@/components/ui/badge';
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
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          {eyebrow ? (
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">{eyebrow}</p>
          ) : null}
          <h2 className="mt-1 text-lg font-light tracking-tight text-black dark:text-white">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-lg font-light text-black dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

function MissionRail({ item, onOpen }: { item: MissionRailItem; onOpen: (tab: AccountTab) => void }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(item.tab)}
      className="group w-full border-r border-zinc-200/70 px-4 py-4 text-left last:border-r-0 dark:border-zinc-800/70"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-[#121212] dark:text-zinc-200">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{item.label}</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{item.detail}</p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
          {item.progress}%
        </Badge>
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

function AchievementChip({
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
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-left text-xs transition-colors',
        achievement.unlocked
          ? toneClasses[achievement.tone]
          : 'border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-400'
      )}
      title={achievement.detail}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">{achievement.name}</span>
      <span className="text-[10px] opacity-80">{achievement.unlocked ? 'Unlocked' : achievement.detail}</span>
    </button>
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
  const unlockedPerks = accountPerks.filter((perk) => perk.unlocked);

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
            <motion.section
              {...sectionMotion}
              transition={sectionTransition}
              className="overflow-hidden rounded-sm border border-zinc-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.96),_rgba(240,249,255,0.75)_45%,_rgba(236,253,245,0.62)_100%)] px-6 py-6 dark:border-zinc-800/70 dark:bg-[radial-gradient(circle_at_top_left,_rgba(20,20,20,0.98),_rgba(11,24,27,0.94)_48%,_rgba(16,16,16,0.98)_100%)] md:px-8 md:py-7"
            >
              <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-sky-500/30 bg-sky-500/10 text-[10px] uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300"
                    >
                      Identity Hub
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-zinc-300 bg-white/80 text-[10px] uppercase tracking-[0.18em] text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300"
                    >
                      {currentLevel.label} Lv.{Math.min(levelIndex + 1, LEVELS.length)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"
                    >
                      {unlockedAchievementCount}/{accountAchievements.length} achievements
                    </Badge>
                  </div>

                  <div className="mt-6 flex items-start gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-lg font-medium text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-[#141414] dark:text-zinc-100">
                      {(profileForm.displayName || profileMenuUser?.name || 'U').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                        Profile / Account Center
                      </p>
                      <h1 className="mt-2 text-[36px] font-light tracking-tight text-black dark:text-white md:text-[42px]">
                        {profileForm.displayName || profileMenuUser?.name || 'Account profile'}
                      </h1>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        Shape the identity layer of the product without burying it in settings. This hub is about who
                        the account is, which surfaces it controls, and what trust or perks it has unlocked.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="rounded-full border border-zinc-300/80 px-3 py-1 dark:border-zinc-700">{profileForm.email || 'Add an email address'}</span>
                        <span className="rounded-full border border-zinc-300/80 px-3 py-1 dark:border-zinc-700">{address ? shortAddress(address) : 'Wallet not connected'}</span>
                        <span className="rounded-full border border-zinc-300/80 px-3 py-1 dark:border-zinc-700">{activeNetworks || 1} active network{activeNetworks === 1 ? '' : 's'}</span>
                        <span className="rounded-full border border-zinc-300/80 px-3 py-1 dark:border-zinc-700">UI-only preview</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full xl:max-w-[300px] xl:border-l xl:border-zinc-200/70 xl:pl-6 xl:dark:border-zinc-800/70">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                        Daily Account Pulse
                      </p>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-light text-black dark:text-white">{accountStreak}</span>
                        <span className="pb-1 text-sm text-zinc-500 dark:text-zinc-400">day streak</span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                        {checkedInToday ? 'Pulse locked for today.' : 'Run a quick trust check-in to keep your streak alive.'}
                      </p>
                    </div>
                    <Button
                      variant={checkedInToday ? 'outline' : 'default'}
                      size="sm"
                      className="rounded-full"
                      onClick={handleAccountPulse}
                    >
                      <Flame className="h-4 w-4" />
                      {checkedInToday ? 'Checked in' : 'Check in'}
                    </Button>
                  </div>

                  <div className="mt-5 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500"
                      style={{ width: `${levelProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{accountXp} XP</span>
                    <span>{currentLevel.label === nextLevel.label ? 'Max tier' : `Next: ${nextLevel.label}`}</span>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      <Gift className="mr-1 h-3 w-3" /> {rewardPoints} points
                    </Badge>
                    <Badge variant="outline" className="border-zinc-300 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                      {securityTone} posture
                    </Badge>
                    <Badge variant="outline" className="border-zinc-300 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                      {unlockedPerks.length} perks active
                    </Badge>
                  </div>
                </div>
              </div>

              {bannerMessage ? (
                <div className="mt-6 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                  {bannerMessage}
                </div>
              ) : null}

              <div className="mt-7 grid overflow-hidden border-y border-zinc-200/70 md:grid-cols-4 md:divide-x dark:border-zinc-800/70 dark:md:divide-zinc-800/70">
                <HeroMetric label="Protected balance" value={formatCurrencyCompact(totalBalanceUSD)} detail="Combined onchain and linked cash surfaces" />
                <HeroMetric label="Connected surfaces" value={String(accountSurfaceCount)} detail="Wallets, socials, and institutions attached" />
                <HeroMetric label="Profile completion" value={`${profileCompletion}%`} detail="Identity, connection, and trust readiness" />
                <HeroMetric label="Cash visibility" value={formatCurrencyCompact(cashBalance.totalCash)} detail="Displayed for UI context only" />
              </div>

              <div className="mt-6 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Mission Track</p>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Use progress rails instead of burying important state in settings cards.</p>
                  </div>
                  <Badge variant="outline" className="border-zinc-300 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                    {unlockedAchievementCount}/{accountAchievements.length} unlocked
                  </Badge>
                </div>
                <div className="mt-4 overflow-hidden rounded-sm border border-zinc-200/70 dark:border-zinc-800/70">
                  <div className="grid divide-y divide-zinc-200/70 md:grid-cols-2 md:divide-y-0 md:divide-x xl:grid-cols-4 dark:divide-zinc-800/70">
                    {missionTrack.map((item) => (
                      <MissionRail key={item.id} item={item} onOpen={handleTabOpen} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/70">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="lg:max-w-[52%]">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Achievements</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {accountAchievements.map((achievement) => (
                        <AchievementChip key={achievement.id} achievement={achievement} onOpen={handleTabOpen} />
                      ))}
                    </div>
                  </div>
                  <div className="lg:max-w-[42%]">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Active Perks</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {accountPerks.map((perk) => (
                        <Badge
                          key={perk.id}
                          variant="outline"
                          className={cn(
                            'px-3 py-2 text-left text-xs font-normal',
                            perk.unlocked ? toneClasses[perk.tone] : 'border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-400'
                          )}
                          title={perk.description}
                        >
                          <perk.icon className="mr-1 h-3.5 w-3.5" />
                          {perk.name}
                          <span className="ml-2 text-[10px] opacity-80">{perk.unlocked ? 'Active' : perk.requirement}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.04 }}>
              <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })}>
                <TabsList className="grid w-full grid-cols-2 gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/90 p-1 dark:border-zinc-800 dark:bg-[#111111] sm:grid-cols-4">
                  <TabsTrigger value="profile" className="rounded-full py-2.5 text-sm">Profile</TabsTrigger>
                  <TabsTrigger value="connections" className="rounded-full py-2.5 text-sm">Connections</TabsTrigger>
                  <TabsTrigger value="security" className="rounded-full py-2.5 text-sm">Security</TabsTrigger>
                  <TabsTrigger value="support" className="rounded-full py-2.5 text-sm">Support</TabsTrigger>
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
                    <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                        {profileFieldsComplete}/6 core fields complete
                      </Badge>
                      <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                        Last saved: {profileSavedAt}
                      </Badge>
                      <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                        Local preview only
                      </Badge>
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Defaults"
                    title="Account defaults"
                    description="Use dividers and compact summary rows instead of more settings cards."
                  >
                    <div className="grid overflow-hidden border-y border-zinc-200/70 md:grid-cols-3 md:divide-x dark:border-zinc-800/70 dark:md:divide-zinc-800/70">
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
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                              <Wallet className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-black dark:text-white">{wallet.label}</p>
                                <Badge variant="outline" className={wallet.verified ? toneClasses.emerald : toneClasses.amber}>{wallet.verified ? 'Verified' : 'Pending'}</Badge>
                                <Badge variant="outline" className={toneClasses.zinc}>{wallet.kind}</Badge>
                              </div>
                              <p className="mt-2 font-mono text-sm text-zinc-600 dark:text-zinc-300">{wallet.address}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                <span>{wallet.network}</span>
                                <span>•</span>
                                <span>{wallet.lastActive}</span>
                              </div>
                              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{wallet.note}</p>
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
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Add X, Farcaster, Discord, GitHub, or another identity layer when you are ready.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                        {socialAccounts.map((account, index) => (
                          <div key={account.id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== socialAccounts.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-[#121212] dark:text-zinc-200">
                                {account.platform.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.platform}</p>
                                  <Badge variant="outline" className={toneClasses.sky}>{account.status}</Badge>
                                  <Badge variant="outline" className={toneClasses.zinc}>{account.visibility}</Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{account.handle}</p>
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
                      <div className="border-y border-zinc-200/70 px-0 py-8 text-sm text-zinc-500 dark:border-zinc-800/70 dark:text-zinc-400">Loading linked institutions...</div>
                    ) : bankAccounts.length === 0 ? (
                      <div className="border-y border-dashed border-zinc-300/80 px-0 py-8 text-center dark:border-zinc-700">
                        <p className="text-sm font-medium text-black dark:text-white">No banks connected</p>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Link a checking, savings, or brokerage account to complete the funding layer later.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                        {bankAccounts.map((account, index) => (
                          <div key={account.account_id} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== bankAccounts.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Landmark className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.name}</p>
                                  <Badge variant="outline" className={toneClasses.zinc}>{account.subtype || account.type || 'linked'}</Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{account.mask ? `•••• ${account.mask}` : 'Mask unavailable'}</p>
                              </div>
                            </div>
                            <div className="text-left md:text-right">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Available</p>
                              <p className="mt-2 text-lg font-light text-black dark:text-white">{formatCurrency(account.available)}</p>
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
                              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{control.label}</p>
                                  <Badge variant="outline" className={control.enabled ? toneClasses.emerald : toneClasses.zinc}>{control.enabled ? 'Enabled' : 'Off'}</Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{control.description}</p>
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
                    <div className="grid overflow-hidden border-y border-zinc-200/70 md:grid-cols-3 md:divide-x dark:border-zinc-800/70 dark:md:divide-zinc-800/70">
                      <HeroMetric label="Primary signer" value={address ? shortAddress(address) : 'Not connected'} detail="Wallet signatures remain the highest-trust recovery path" />
                      <HeroMetric label="Recovery contacts" value={profileForm.phone || 'Add a recovery phone'} detail="Phone and email speed up security review" />
                      <HeroMetric label="Exposure map" value={`${wallets.length} wallets / ${bankAccounts.length} rails`} detail="Review trusted surfaces regularly to reduce stale links" />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {accountPerks.map((perk) => (
                        <Badge key={perk.id} variant="outline" className={perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc} title={perk.description}>
                          <perk.icon className="mr-1 h-3.5 w-3.5" />
                          {perk.name}
                        </Badge>
                      ))}
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="support" className="space-y-8 pt-5">
                  <SectionPanel
                    eyebrow="Documents"
                    title="Statements and exports"
                    description="Keep documents in clean rows with action pills instead of more tiles."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {[
                        { title: 'Monthly statements', detail: 'Snapshot of balances, linked accounts, and transfers.', cta: 'Prepare PDF' },
                        { title: 'Tax package', detail: 'Export a year-to-date activity package for off-platform review.', cta: 'Generate export' },
                        { title: 'Account archive', detail: 'Bundle profile, wallets, socials, and support metadata.', cta: 'Export JSON' },
                      ].map((item, index, array) => (
                        <div key={item.title} className={cn('flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between', index !== array.length - 1 && 'border-b border-zinc-200/70 dark:border-zinc-800/70')}>
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                              <FileText className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-black dark:text-white">{item.title}</p>
                              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{item.detail}</p>
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
                              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#121212]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-black dark:text-white">{item.title}</p>
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{item.detail}</p>
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

          <div className="md:col-span-4">
            <motion.aside
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.08 }}
              className="sticky top-28 overflow-hidden rounded-sm border border-zinc-200/70 bg-white dark:border-zinc-800/70 dark:bg-[#111111]"
            >
              <div className="px-5 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Account health</p>
                    <h2 className="mt-1 text-base font-medium text-black dark:text-white">Progress snapshot</h2>
                  </div>
                  <Badge variant="outline" className={profileCompletion >= 80 ? toneClasses.emerald : toneClasses.amber}>
                    {profileCompletion}% complete
                  </Badge>
                </div>
                <div className="mt-4 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500" style={{ width: `${profileCompletion}%` }} />
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Security score</span>
                    <span className="font-medium text-black dark:text-white">{securityScore}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Reward points</span>
                    <span className="font-medium text-black dark:text-white">{rewardPoints}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Active perks</span>
                    <span className="font-medium text-black dark:text-white">{unlockedPerks.length}</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-200/70 px-5 py-5 dark:border-zinc-800/70">
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Next up</p>
                <div className="mt-4 space-y-3">
                  {nextSteps.length === 0 ? (
                    <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                      All major profile, connection, and security checkpoints are covered.
                    </div>
                  ) : (
                    nextSteps.map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => {
                          if (step.toLowerCase().includes('social') || step.toLowerCase().includes('bank')) {
                            handleTabOpen('connections');
                            return;
                          }
                          if (step.toLowerCase().includes('security')) {
                            handleTabOpen('security');
                            return;
                          }
                          handleTabOpen('profile');
                        }}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                          {nextSteps.indexOf(step) + 1}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">{step}</p>
                        </div>
                        <ChevronRight className="mt-0.5 h-4 w-4 text-zinc-400" />
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-200/70 px-5 py-5 dark:border-zinc-800/70">
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Achievement locker</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {accountAchievements.map((achievement) => (
                    <AchievementChip key={achievement.id} achievement={achievement} onOpen={handleTabOpen} />
                  ))}
                </div>
              </div>

              <div className="border-t border-zinc-200/70 px-5 py-5 dark:border-zinc-800/70">
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Perks in play</p>
                <div className="mt-4 space-y-3">
                  {accountPerks.map((perk) => (
                    <div key={perk.id} className="flex items-start gap-3">
                      <div className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border', perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc)}>
                        <perk.icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-black dark:text-white">{perk.name}</p>
                          <Badge variant="outline" className={perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc}>
                            {perk.unlocked ? 'Active' : perk.requirement}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{perk.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.aside>
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
