import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppKitAccount } from '@reown/appkit/react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Copy,
  Edit3,
  FileText,
  Globe,
  KeyRound,
  Landmark,
  Link2,
  Lock,
  Plus,
  ScanFace,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
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

const sectionMotion = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};
const sectionTransition = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

function InfoCard({
  title,
  subtitle,
  icon: Icon,
  value,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  value: string;
}) {
  return (
    <div className="rounded-sm border border-zinc-200/70 bg-white/80 p-4 dark:border-zinc-800/70 dark:bg-[#121212]/80">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{title}</p>
          <p className="mt-2 text-xl font-light text-black dark:text-white">{value}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[#171717]">
          <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
        </div>
      </div>
    </div>
  );
}

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
    <section className="rounded-sm border border-zinc-200/70 bg-white dark:border-zinc-800/70 dark:bg-[#111111]">
      <div className="flex flex-col gap-4 border-b border-zinc-200/70 px-5 py-4 dark:border-zinc-800/70 md:flex-row md:items-start md:justify-between">
        <div>
          {eyebrow ? (
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">{eyebrow}</p>
          ) : null}
          <h2 className="mt-1 text-base font-medium text-black dark:text-white">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function AccountHome() {
  const { address } = useAppKitAccount();
  const { user, chainId } = useAppKitAuth();
  const {
    totalBalanceUSD,
    cashBalance,
    holdings,
    bankAccounts,
    bankAccountsLoading,
  } = usePortfolio();
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
      bio: 'Building a portable onchain account center for identity, wallets, and cash management.',
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

  const securityEnabledCount = securityControls.filter((control) => control.enabled).length;
  const securityScore = Math.round((securityEnabledCount / securityControls.length) * 100);
  const securityTone = securityScore >= 80 ? 'Strong' : securityScore >= 60 ? 'Balanced' : 'Needs work';
  const activeNetworks = useMemo(
    () => new Set(holdings.map((holding) => holding.chainName).filter(Boolean)).size,
    [holdings]
  );

  const profileCompletion = useMemo(() => {
    const completed = [
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
    ].filter(Boolean).length;

    return Math.round((completed / 10) * 100);
  }, [profileForm, wallets.length, socialAccounts.length, bankAccounts.length, securityEnabledCount]);

  const accountSurfaceCount = wallets.length + socialAccounts.length + bankAccounts.length;
  const nextSteps = [
    !profileForm.legalName.trim() ? 'Add a legal name for compliance-ready account updates.' : null,
    !profileForm.phone.trim() ? 'Add a recovery phone for high-risk account changes.' : null,
    socialAccounts.length === 0 ? 'Link a social account to make your identity graph portable.' : null,
    bankAccounts.length === 0 ? 'Connect a bank account for deposits, withdrawals, and cash sweeps.' : null,
    securityEnabledCount < 4 ? 'Turn on one more protection control to reach a strong security posture.' : null,
  ].filter(Boolean) as string[];

  const handleProfileFieldChange = (field: keyof ProfileFormState, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const handleProfileSave = () => {
    const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    setProfileSavedAt(savedAt);
    setBannerMessage('Profile changes saved to the local workspace preview.');
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
      setBannerMessage('Institution refresh is a UI placeholder for the upcoming account sync flow.');
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
              className="overflow-hidden rounded-sm border border-zinc-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_rgba(240,249,255,0.75)_45%,_rgba(236,253,245,0.66)_100%)] p-6 dark:border-zinc-800/70 dark:bg-[radial-gradient(circle_at_top_left,_rgba(20,20,20,0.96),_rgba(14,30,32,0.92)_45%,_rgba(15,19,17,0.96)_100%)] md:p-8"
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <Badge
                    variant="outline"
                    className="border-sky-500/30 bg-sky-500/10 text-[10px] uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300"
                  >
                    Identity Hub
                  </Badge>
                  <div className="mt-5 flex items-start gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border border-zinc-200 bg-white/80 text-lg font-medium text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-[#141414] dark:text-zinc-100">
                      {(profileForm.displayName || profileMenuUser?.name || 'U').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                        Profile / Account Center
                      </p>
                      <h1 className="mt-2 text-[36px] font-light tracking-tight text-black dark:text-white md:text-[42px]">
                        {profileForm.displayName || profileMenuUser?.name || 'Account profile'}
                      </h1>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        Manage the identity layer of your account: profile details, associated wallets, linked socials,
                        funding rails, security controls, and support utilities in one place.
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{profileForm.email || 'Add an email address'}</span>
                        <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                        <span>{address ? shortAddress(address) : 'Wallet not connected'}</span>
                        <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                        <span>{activeNetworks || 1} active network{activeNetworks === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 lg:max-w-xs lg:flex-col lg:items-stretch">
                  <Button
                    className="rounded-full bg-black px-5 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                    onClick={() => setSearchParams({ tab: 'profile' })}
                  >
                    <Edit3 className="h-4 w-4" />
                    Edit profile
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full border-zinc-300 bg-white/80 px-5 dark:border-zinc-700 dark:bg-[#121212]"
                    onClick={() => setSearchParams({ tab: 'connections' })}
                  >
                    <Plus className="h-4 w-4" />
                    Add connection
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full border-zinc-300 bg-white/80 px-5 dark:border-zinc-700 dark:bg-[#121212]"
                    onClick={() => setSearchParams({ tab: 'security' })}
                  >
                    <Shield className="h-4 w-4" />
                    Review security
                  </Button>
                </div>
              </div>

              {bannerMessage ? (
                <div className="mt-6 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                  {bannerMessage}
                </div>
              ) : null}

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <InfoCard
                  title="Protected balance"
                  value={formatCurrencyCompact(totalBalanceUSD)}
                  subtitle="Combined onchain and linked cash surfaces"
                  icon={Wallet}
                />
                <InfoCard
                  title="Connected surfaces"
                  value={String(accountSurfaceCount)}
                  subtitle="Wallets, socials, and institutions linked here"
                  icon={Link2}
                />
                <InfoCard
                  title="Security posture"
                  value={securityTone}
                  subtitle={`${securityEnabledCount}/${securityControls.length} controls active`}
                  icon={ShieldCheck}
                />
              </div>
            </motion.section>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.05 }}>
              <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })}>
                <TabsList className="grid w-full grid-cols-2 gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/90 p-1 dark:border-zinc-800 dark:bg-[#111111] sm:grid-cols-4">
                  <TabsTrigger value="profile" className="rounded-full py-2.5 text-sm">
                    Profile
                  </TabsTrigger>
                  <TabsTrigger value="connections" className="rounded-full py-2.5 text-sm">
                    Connections
                  </TabsTrigger>
                  <TabsTrigger value="security" className="rounded-full py-2.5 text-sm">
                    Security
                  </TabsTrigger>
                  <TabsTrigger value="support" className="rounded-full py-2.5 text-sm">
                    Support
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-6 pt-4">
                  <SectionPanel
                    eyebrow="Identity"
                    title="Personal information"
                    description="Set the core account details users, support staff, and compliance flows will rely on."
                    action={
                      <Button variant="outline" size="sm" onClick={handleProfileSave}>
                        Save profile
                      </Button>
                    }
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="legalName">Legal name</Label>
                        <Input
                          id="legalName"
                          value={profileForm.legalName}
                          onChange={(event) => handleProfileFieldChange('legalName', event.target.value)}
                          placeholder="Jane Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display name</Label>
                        <Input
                          id="displayName"
                          value={profileForm.displayName}
                          onChange={(event) => handleProfileFieldChange('displayName', event.target.value)}
                          placeholder="jane.clear"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={profileForm.email}
                          onChange={(event) => handleProfileFieldChange('email', event.target.value)}
                          placeholder="jane@clearpath.app"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Recovery phone</Label>
                        <Input
                          id="phone"
                          value={profileForm.phone}
                          onChange={(event) => handleProfileFieldChange('phone', event.target.value)}
                          placeholder="(555) 123-4567"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location">Location</Label>
                        <Input
                          id="location"
                          value={profileForm.location}
                          onChange={(event) => handleProfileFieldChange('location', event.target.value)}
                          placeholder="Los Angeles, CA"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="residency">Residency</Label>
                        <Input
                          id="residency"
                          value={profileForm.residency}
                          onChange={(event) => handleProfileFieldChange('residency', event.target.value)}
                          placeholder="United States"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="timezone">Timezone</Label>
                        <Input
                          id="timezone"
                          value={profileForm.timezone}
                          onChange={(event) => handleProfileFieldChange('timezone', event.target.value)}
                          placeholder="Pacific Time (PT)"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="currency">Settlement currency</Label>
                        <Input
                          id="currency"
                          value={profileForm.currency}
                          onChange={(event) => handleProfileFieldChange('currency', event.target.value)}
                          placeholder="USD"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="bio">Bio</Label>
                        <Textarea
                          id="bio"
                          value={profileForm.bio}
                          onChange={(event) => handleProfileFieldChange('bio', event.target.value)}
                          placeholder="Tell other users what this account is for."
                          className="min-h-[120px]"
                        />
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-zinc-200/70 bg-zinc-50/80 px-4 py-3 text-sm dark:border-zinc-800/70 dark:bg-[#141414]/70">
                      <div>
                        <p className="font-medium text-black dark:text-white">Profile sync status</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Last saved at {profileSavedAt}</p>
                      </div>
                      <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                        Local preview only
                      </Badge>
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Preferences"
                    title="Account defaults"
                    description="These settings shape how your profile appears across account, wallet, and support flows."
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Primary region</p>
                        <p className="mt-3 text-lg font-light text-black dark:text-white">{profileForm.residency || 'Unset'}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Controls settlement, disclosures, and cash movement defaults.</p>
                      </div>
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Notification timezone</p>
                        <p className="mt-3 text-lg font-light text-black dark:text-white">{profileForm.timezone || 'Unset'}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Used for statements, support windows, and scheduled alerts.</p>
                      </div>
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Settlement currency</p>
                        <p className="mt-3 text-lg font-light text-black dark:text-white">{profileForm.currency || 'Unset'}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Displayed wherever account-level balances and exports are normalized.</p>
                      </div>
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="connections" className="space-y-6 pt-4">
                  <SectionPanel
                    eyebrow="Wallet graph"
                    title="Associated wallets"
                    description="Track the wallets trusted by this account and keep their labels, network assignments, and recovery notes organized."
                    action={
                      <Button variant="outline" size="sm" onClick={() => openWalletDialog()}>
                        <Plus className="h-4 w-4" />
                        Add wallet
                      </Button>
                    }
                  >
                    <div className="space-y-3">
                      {wallets.map((wallet) => (
                        <div
                          key={wallet.id}
                          className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70"
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-black dark:text-white">{wallet.label}</p>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[10px] uppercase tracking-[0.18em]',
                                    wallet.verified
                                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                  )}
                                >
                                  {wallet.verified ? 'Verified' : 'Pending'}
                                </Badge>
                                <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                                  {wallet.kind}
                                </Badge>
                              </div>
                              <p className="mt-2 font-mono text-sm text-zinc-600 dark:text-zinc-300">{wallet.address}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                <span>{wallet.network}</span>
                                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                                <span>{wallet.lastActive}</span>
                              </div>
                              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{wallet.note}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleCopyAddress(wallet.address)}>
                                <Copy className="h-4 w-4" />
                                Copy
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => openWalletDialog(wallet)}>
                                <Edit3 className="h-4 w-4" />
                                Edit
                              </Button>
                              {wallet.id !== 'wallet-primary' ? (
                                <Button variant="outline" size="sm" onClick={() => removeWallet(wallet.id)}>
                                  <Trash2 className="h-4 w-4" />
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Social graph"
                    title="Linked social accounts"
                    description="Connect the handles you want attached to this account for discovery, trust signals, and outbound support verification."
                    action={
                      <Button variant="outline" size="sm" onClick={() => openSocialDialog()}>
                        <Plus className="h-4 w-4" />
                        Link social
                      </Button>
                    }
                  >
                    {socialAccounts.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-zinc-300/80 bg-zinc-50/60 px-4 py-8 text-center dark:border-zinc-700 dark:bg-[#131313]/60">
                        <p className="text-sm font-medium text-black dark:text-white">No social accounts linked yet</p>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                          Add X, Farcaster, Discord, GitHub, or another social identity so users can verify who controls this account.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {socialAccounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex flex-col gap-4 rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-[#101010] dark:text-zinc-200">
                                {account.platform.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.platform}</p>
                                  <Badge
                                    variant="outline"
                                    className="border-sky-500/30 bg-sky-500/10 text-[10px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300"
                                  >
                                    {account.status}
                                  </Badge>
                                  <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                                    {account.visibility}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{account.handle}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => openSocialDialog(account)}>
                                <Edit3 className="h-4 w-4" />
                                Edit
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => removeSocial(account.id)}>
                                <Trash2 className="h-4 w-4" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Funding rails"
                    title="Linked banks and cash accounts"
                    description="Monitor offchain cash surfaces connected to this wallet identity and refresh balances when institutions update."
                    action={
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleRefreshBanks} disabled={refreshingBanks}>
                          {refreshingBanks ? 'Refreshing...' : 'Refresh'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setBannerMessage('Funding link and institution onboarding will be wired in the next pass.')
                          }
                        >
                          <ArrowUpRight className="h-4 w-4" />
                          Link funds
                        </Button>
                      </div>
                    }
                  >
                    {bankAccountsLoading ? (
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 px-4 py-8 text-sm text-zinc-500 dark:border-zinc-800/70 dark:bg-[#141414]/70 dark:text-zinc-400">
                        Loading linked institutions...
                      </div>
                    ) : bankAccounts.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-zinc-300/80 bg-zinc-50/60 px-4 py-8 text-center dark:border-zinc-700 dark:bg-[#131313]/60">
                        <p className="text-sm font-medium text-black dark:text-white">No banks connected</p>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                          Link a checking, savings, or brokerage account to manage transfers and cash visibility from the same account page.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {bankAccounts.map((account) => (
                          <div
                            key={account.account_id}
                            className="flex flex-col gap-4 rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#101010]">
                                <Landmark className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{account.name}</p>
                                  <Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300">
                                    {account.subtype || account.type || 'linked'}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                                  {account.mask ? `•••• ${account.mask}` : 'Mask unavailable'}
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-1 text-right">
                              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Available</p>
                              <p className="text-lg font-light text-black dark:text-white">{formatCurrency(account.available)}</p>
                              {account.current != null ? (
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">Current {formatCurrency(account.current)}</p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="security" className="space-y-6 pt-4">
                  <SectionPanel
                    eyebrow="Trust controls"
                    title="Security and privacy"
                    description="Separate sensitive account controls from profile editing so recovery, alerts, and discovery can be managed intentionally."
                  >
                    <div className="space-y-3">
                      {securityControls.map((control) => {
                        const Icon = control.icon;
                        return (
                          <div
                            key={control.id}
                            className="flex flex-col gap-4 rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#101010]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-black dark:text-white">{control.label}</p>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-[10px] uppercase tracking-[0.18em]',
                                      control.enabled
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300'
                                    )}
                                  >
                                    {control.enabled ? 'Enabled' : 'Off'}
                                  </Badge>
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
                    description="A quick view of how a user could regain access or verify ownership if something looks wrong."
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                          <Wallet className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                          Primary signer
                        </div>
                        <p className="mt-3 font-mono text-sm text-zinc-600 dark:text-zinc-300">{address ? shortAddress(address) : 'Not connected'}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Wallet signatures remain the highest-trust recovery path.</p>
                      </div>
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                          <Smartphone className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                          Recovery contacts
                        </div>
                        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{profileForm.phone || 'Add a recovery phone number'}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Use phone or email for security escalations and account review.</p>
                      </div>
                      <div className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70">
                        <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                          <Lock className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                          Exposure map
                        </div>
                        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{wallets.length} wallets, {bankAccounts.length} institutions</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Review linked surfaces regularly so old connections do not stay trusted forever.</p>
                      </div>
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="support" className="space-y-6 pt-4">
                  <SectionPanel
                    eyebrow="Documents"
                    title="Statements and exports"
                    description="Put account paperwork, tax exports, and activity summaries somewhere predictable so users do not hunt through settings."
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      {[
                        {
                          title: 'Monthly statements',
                          detail: 'Snapshot of balances, linked accounts, and transfers.',
                          cta: 'Prepare PDF',
                        },
                        {
                          title: 'Tax package',
                          detail: 'Export a year-to-date activity package for off-platform review.',
                          cta: 'Generate export',
                        },
                        {
                          title: 'Account archive',
                          detail: 'Bundle profile, wallets, socials, and support metadata.',
                          cta: 'Export JSON',
                        },
                      ].map((item) => (
                        <div
                          key={item.title}
                          className="rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#101010]">
                            <FileText className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                          </div>
                          <p className="mt-4 text-sm font-medium text-black dark:text-white">{item.title}</p>
                          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={() => setBannerMessage(`${item.cta} queued in the local preview.`)}
                          >
                            {item.cta}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Support"
                    title="Support and privacy requests"
                    description="Keep trust-and-safety, support, and privacy entry points close to the account center where users expect them."
                  >
                    <div className="space-y-3">
                      {[
                        {
                          icon: Shield,
                          title: 'Account review',
                          detail: 'Report suspicious changes or ask support to review a linked wallet or bank account.',
                          cta: 'Open review request',
                        },
                        {
                          icon: Sparkles,
                          title: 'Priority support',
                          detail: 'Share profile, connection, and security context in one support conversation.',
                          cta: 'Contact support',
                        },
                        {
                          icon: AlertTriangle,
                          title: 'Privacy request',
                          detail: 'Request export or deletion of profile metadata stored beyond your wallet signature.',
                          cta: 'Start privacy request',
                        },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div
                            key={item.title}
                            className="flex flex-col gap-4 rounded-sm border border-zinc-200/70 bg-zinc-50/70 p-4 dark:border-zinc-800/70 dark:bg-[#141414]/70 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#101010]">
                                <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-black dark:text-white">{item.title}</p>
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                              </div>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setBannerMessage(`${item.title} opened in the local preview.`)}>
                              {item.cta}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </SectionPanel>
                </TabsContent>
              </Tabs>
            </motion.div>
          </div>

          <div className="space-y-6 md:col-span-4">
            <motion.section
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.1 }}
              className="rounded-sm border border-zinc-200/70 bg-white p-5 dark:border-zinc-800/70 dark:bg-[#111111]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Overview</p>
                  <h2 className="mt-1 text-base font-medium text-black dark:text-white">Account health</h2>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] uppercase tracking-[0.18em]',
                    profileCompletion >= 80
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {profileCompletion}% complete
                </Badge>
              </div>

              <div className="mt-5 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500"
                  style={{ width: `${profileCompletion}%` }}
                />
              </div>

              <div className="mt-5 space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Security score</span>
                  <span className="font-medium text-black dark:text-white">{securityScore}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Cash visibility</span>
                  <span className="font-medium text-black dark:text-white">{formatCurrencyCompact(cashBalance.totalCash)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Linked institutions</span>
                  <span className="font-medium text-black dark:text-white">{bankAccounts.length}</span>
                </div>
              </div>
            </motion.section>

            <motion.section
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.14 }}
              className="rounded-sm border border-zinc-200/70 bg-white p-5 dark:border-zinc-800/70 dark:bg-[#111111]"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Next up</p>
              <h2 className="mt-1 text-base font-medium text-black dark:text-white">Tighten the account</h2>
              <div className="mt-4 space-y-3">
                {nextSteps.length === 0 ? (
                  <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-300">
                    All major profile, connection, and security checkpoints are covered.
                  </div>
                ) : (
                  nextSteps.map((step) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() => {
                        if (step.toLowerCase().includes('social') || step.toLowerCase().includes('bank')) {
                          setSearchParams({ tab: 'connections' });
                          return;
                        }
                        if (step.toLowerCase().includes('security')) {
                          setSearchParams({ tab: 'security' });
                          return;
                        }
                        setSearchParams({ tab: 'profile' });
                      }}
                      className="flex w-full items-start gap-3 rounded-sm border border-zinc-200/70 px-3 py-3 text-left hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-[#151515]"
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
            </motion.section>

            <motion.section
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.18 }}
              className="rounded-sm border border-zinc-200/70 bg-white p-5 dark:border-zinc-800/70 dark:bg-[#111111]"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Footprint</p>
              <h2 className="mt-1 text-base font-medium text-black dark:text-white">Connected surfaces</h2>
              <div className="mt-5 space-y-3">
                {[
                  { icon: Wallet, label: 'Wallets', value: wallets.length },
                  { icon: UserRound, label: 'Social accounts', value: socialAccounts.length },
                  { icon: Landmark, label: 'Institutions', value: bankAccounts.length },
                  { icon: Globe, label: 'Networks', value: activeNetworks || 1 },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center justify-between rounded-sm border border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
                      <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                        <Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        <span>{item.label}</span>
                      </div>
                      <span className="text-sm font-medium text-black dark:text-white">{item.value}</span>
                    </div>
                  );
                })}
              </div>
            </motion.section>

            <motion.section
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.22 }}
              className="rounded-sm border border-zinc-200/70 bg-white p-5 dark:border-zinc-800/70 dark:bg-[#111111]"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Quick actions</p>
              <h2 className="mt-1 text-base font-medium text-black dark:text-white">Useful jumps</h2>
              <div className="mt-4 space-y-2">
                {[
                  { icon: CheckCircle2, label: 'Review profile completeness', tab: 'profile' as AccountTab },
                  { icon: Link2, label: 'Manage linked accounts', tab: 'connections' as AccountTab },
                  { icon: ShieldCheck, label: 'Run security review', tab: 'security' as AccountTab },
                  { icon: FileText, label: 'Prepare account export', tab: 'support' as AccountTab },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setSearchParams({ tab: item.tab })}
                      className="flex w-full items-center justify-between rounded-sm border border-zinc-200/70 px-3 py-3 text-left hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-[#151515]"
                    >
                      <div className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                        <Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        <span>{item.label}</span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-zinc-400" />
                    </button>
                  );
                })}
              </div>
            </motion.section>
          </div>
        </div>
      </main>

      <Dialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen}>
        <DialogContent className="border-zinc-200 dark:border-zinc-800 dark:bg-[#111111]">
          <DialogHeader>
            <DialogTitle>{editingWalletId ? 'Edit associated wallet' : 'Add associated wallet'}</DialogTitle>
            <DialogDescription>
              Save the wallet label, network, and notes you want attached to this account center.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="walletLabel">Label</Label>
              <Input
                id="walletLabel"
                value={walletDraft.label}
                onChange={(event) => setWalletDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Treasury Safe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletAddress">Wallet address</Label>
              <Input
                id="walletAddress"
                value={walletDraft.address}
                onChange={(event) => setWalletDraft((current) => ({ ...current, address: event.target.value }))}
                placeholder="0x..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletNetwork">Network</Label>
              <Input
                id="walletNetwork"
                value={walletDraft.network}
                onChange={(event) => setWalletDraft((current) => ({ ...current, network: event.target.value }))}
                placeholder="Base"
              />
            </div>
            <div className="space-y-2">
              <Label>Wallet type</Label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(['Primary', 'Hardware', 'Smart', 'Embedded'] as WalletKind[]).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={walletDraft.kind === kind ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWalletDraft((current) => ({ ...current, kind }))}
                  >
                    {kind}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletNote">Note</Label>
              <Textarea
                id="walletNote"
                className="min-h-[96px]"
                value={walletDraft.note}
                onChange={(event) => setWalletDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="What is this wallet used for?"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWalletDialogOpen(false)}>
                Cancel
              </Button>
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
              <Input
                id="socialPlatform"
                value={socialDraft.platform}
                onChange={(event) => setSocialDraft((current) => ({ ...current, platform: event.target.value }))}
                placeholder="Farcaster"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="socialHandle">Handle / ID</Label>
              <Input
                id="socialHandle"
                value={socialDraft.handle}
                onChange={(event) => setSocialDraft((current) => ({ ...current, handle: event.target.value }))}
                placeholder="@janeclear"
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['Public', 'Private'] as SocialVisibility[]).map((visibility) => (
                  <Button
                    key={visibility}
                    type="button"
                    variant={socialDraft.visibility === visibility ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSocialDraft((current) => ({ ...current, visibility }))}
                  >
                    {visibility}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSocialDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveSocial}>Save social</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
