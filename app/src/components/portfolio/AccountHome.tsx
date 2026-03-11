import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppKitAccount } from '@reown/appkit/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Copy,
  Crown,
  Edit3,
  FileText,
  Gift,
  Globe,
  Info,
  KeyRound,
  Landmark,
  Link2,
  Plus,
  RefreshCw,
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
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  createMemberMembershipCheckout,
  createMemberWalletLinkHandoff,
  createMemberSocialAccount,
  deleteMemberSocialAccount,
  deleteMemberWallet,
  getMemberAccountCenter,
  getMemberMembershipSummary,
  type MemberAccountCenterResponse,
  type MemberBillingSummaryResponse,
  type MemberSocialAccountResponse,
  type MemberWalletResponse,
  updateMemberProfile,
  updateMemberSecurity,
  updateMemberSocialAccount,
  updateMemberWallet,
  bootstrapMemberAccount,
} from '@/utils/apiClient';
import { savePendingWalletLinkHandoff } from '@/utils/walletLinkHandoff';

type AccountTab = 'profile' | 'connections' | 'security' | 'support';
type WalletKind = 'Primary' | 'Hardware' | 'Smart' | 'Embedded';
type SocialVisibility = 'Public' | 'Private';
type Tone = 'emerald' | 'sky' | 'amber' | 'zinc';
type WalletDialogMode = 'link' | 'edit';

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
  description: string;
  network: string;
  kind: WalletKind;
  verified: boolean;
  note: string;
  lastActive: string;
}

interface WalletDraft {
  label: string;
  description: string;
  kind: WalletKind;
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
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  statusLabel?: string;
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
  tab: AccountTab;
}

interface AccountSetupTask {
  id: string;
  title: string;
  detail: string;
  rewardXp: number;
  progress: number;
  progressLabel: string;
  tab: AccountTab;
  icon: LucideIcon;
  completed: boolean;
}

interface AccountNextUnlock {
  id: string;
  name: string;
  detail: string;
  requirement: string;
  tab: AccountTab;
  icon: LucideIcon;
  tone: Tone;
}

interface AccountBenefitItem {
  id: string;
  name: string;
  detail: string;
  requirement: string;
  tab: AccountTab;
  icon: LucideIcon;
  tone: Tone;
  live: boolean;
}

const ACCOUNT_TABS: AccountTab[] = ['profile', 'connections', 'security', 'support'];
const ACCOUNT_TAB_LABELS: Record<AccountTab, string> = {
  profile: 'Profile',
  connections: 'Connections',
  security: 'Security',
  support: 'Support',
};
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
  description: '',
  kind: 'Hardware',
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

const formatSavedAtLabel = (value: string | null | undefined) => {
  if (!value) return 'Not saved yet';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Saved';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const formatLocation = (cityRegion: string | null | undefined, residencyCountry: string | null | undefined) => {
  if (cityRegion && residencyCountry) return `${cityRegion}, ${residencyCountry}`;
  return cityRegion || residencyCountry || '';
};

const profileFormFromAccount = (
  account: MemberAccountCenterResponse,
  fallbackEmail?: string
): ProfileFormState => ({
  legalName: account.profile.privateProfile?.legalName || '',
  displayName:
    account.profile.publicProfile.displayName ||
    account.profile.publicProfile.username ||
    '',
  email: account.profile.privateProfile?.email || fallbackEmail || '',
  phone: account.profile.privateProfile?.phone || '',
  location: formatLocation(
    account.profile.privateProfile?.cityRegion,
    account.member.residencyCountry
  ),
  residency: account.member.residencyCountry || '',
  timezone: account.profile.publicProfile.timezone || '',
  currency: account.member.settlementCurrency || '',
  bio: account.profile.publicProfile.bio || '',
});

const securityControlsFromAccount = (account: MemberAccountCenterResponse): SecurityControl[] =>
  DEFAULT_SECURITY_CONTROLS.map((control) => {
    switch (control.id) {
      case 'signature-lock':
        return { ...control, enabled: account.security.signatureLock };
      case 'session-review':
        return { ...control, enabled: account.security.sessionReview };
      case 'biometric-access':
        return { ...control, enabled: account.security.biometricAccess };
      case 'social-discovery':
        return { ...control, enabled: account.security.socialDiscovery };
      case 'transfer-alerts':
        return { ...control, enabled: account.security.transferAlerts };
      default:
        return control;
    }
  });

const walletRecordFromApi = (wallet: MemberWalletResponse): WalletRecord => ({
  id: `wallet-${wallet.id}`,
  label: wallet.label || (wallet.isPrimary ? 'Primary wallet' : 'Associated wallet'),
  address: wallet.walletAddress,
  description: wallet.description || '',
  network: wallet.isPrimary ? 'Primary signer' : 'Linked wallet',
  kind: wallet.kind === 'EMBEDDED'
    ? 'Embedded'
    : wallet.kind === 'HARDWARE'
      ? 'Hardware'
      : wallet.kind === 'SMART'
        ? 'Smart'
        : 'Primary',
  verified: Boolean(wallet.verifiedAt) || wallet.isPrimary,
  note: wallet.description || (
    wallet.isPrimary
      ? 'Active signer for your ClearPath account.'
      : wallet.verifiedAt
        ? 'Authenticated and linked as a sign-in wallet for this Clear account.'
        : 'Saved on your Clear account. Connect and authenticate with this wallet to activate it as a sign-in alias.'
  ),
  lastActive: wallet.isPrimary ? 'Active now' : wallet.verifiedAt ? 'Authenticated' : 'Pending verification',
});

const socialRecordFromApi = (account: MemberSocialAccountResponse): SocialRecord => ({
  id: `social-${account.id}`,
  platform: account.platform,
  handle: account.handle,
  visibility: account.visibility === 'PRIVATE' ? 'Private' : 'Public',
  status: account.status === 'PENDING' ? 'Pending' : 'Connected',
});

const walletKindToApi = (kind: WalletKind): 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED' => {
  switch (kind) {
    case 'Hardware':
      return 'HARDWARE';
    case 'Smart':
      return 'SMART';
    case 'Embedded':
      return 'EMBEDDED';
    case 'Primary':
    default:
      return 'PRIMARY';
  }
};

const socialVisibilityToApi = (visibility: SocialVisibility): 'PUBLIC' | 'PRIVATE' =>
  visibility === 'Private' ? 'PRIVATE' : 'PUBLIC';

const parseLocalEntityId = (value: string, prefix: string): number | null => {
  if (!value.startsWith(prefix)) return null;
  const parsed = Number.parseInt(value.slice(prefix.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPercent = (value: number) => Math.max(0, Math.min(Math.round(value), 100));

const toneClasses: Record<Tone, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  zinc: 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-[#101010] dark:text-zinc-300',
};

const ACCOUNT_TAB_BUTTON_PRIMARY_CLASS =
  'rounded-full border-black/10 bg-black text-white font-normal shadow-none hover:bg-black/90 dark:border-white/10 dark:bg-white dark:text-black dark:hover:bg-white/90';

const ACCOUNT_TAB_BUTTON_SECONDARY_CLASS =
  'h-[34px] rounded-full border-zinc-200 bg-zinc-100 text-black font-normal shadow-none hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-[#141414] dark:text-white dark:hover:bg-[#141414]/80';

const ACCOUNT_TAB_BUTTON_SUCCESS_CLASS =
  'h-[34px] rounded-full border-zinc-200 bg-emerald-500/10 text-emerald-700 font-normal shadow-none hover:bg-emerald-500/15 dark:border-zinc-800 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15';

function SectionPanel({
  title,
  eyebrow,
  description,
  action,
  withTopBorder = true,
  children,
}: {
  title: string;
  eyebrow?: string;
  description: string;
  action?: ReactNode;
  withTopBorder?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <div className={cn('border-b border-zinc-200/70 py-4 dark:border-zinc-800/70', withTopBorder && 'border-t dark:border-zinc-800/70')}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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
      <div className="pt-3">{children}</div>
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

function RailSectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="h-px flex-1 bg-zinc-200/70 dark:bg-zinc-800/70" />
      {meta ? <p className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">{meta}</p> : null}
    </div>
  );
}

function RailMetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 flex-1 rounded-sm border border-zinc-200/70 px-2.5 py-2 dark:border-zinc-800/70">
      <p className="truncate text-[10px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-black dark:text-white">{value}</p>
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

function AccountFocusRailCard({
  tasks,
  currentTask,
  queuedTasks,
  completedTaskCount,
  levelLabel,
  levelNumber,
  levelProgress,
  accountXp,
  pointsToNextLevel,
  rewardPoints,
  onOpen,
}: {
  tasks: AccountSetupTask[];
  currentTask: AccountSetupTask | null;
  queuedTasks: AccountSetupTask[];
  completedTaskCount: number;
  levelLabel: string;
  levelNumber: number;
  levelProgress: number;
  accountXp: number;
  pointsToNextLevel: number;
  rewardPoints: number;
  onOpen: (tab: AccountTab) => void;
}) {
  const totalTaskCount = tasks.length;
  const openTaskCount = Math.max(totalTaskCount - completedTaskCount, 0);
  const railState = totalTaskCount === 0 ? 'awaiting' : openTaskCount === 0 ? 'complete' : 'active';

  return (
    <section className="overflow-hidden rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#141414]">
      <div className="px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Setup queue</p>
            <p className="mt-1 text-sm font-medium text-black dark:text-white">
              {railState === 'active'
                ? `${openTaskCount} open task${openTaskCount === 1 ? '' : 's'}`
                : railState === 'complete'
                  ? 'All setup tasks complete'
                  : 'Awaiting new tasks'}
            </p>
          </div>
          <div className="text-right text-[10px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            <p>{totalTaskCount > 0 ? `${completedTaskCount}/${totalTaskCount} done` : 'No tasks'}</p>
            <p className="mt-1">{rewardPoints} pts</p>
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
        {railState === 'active' && currentTask ? (
          <button
            type="button"
            onClick={() => onOpen(currentTask.tab)}
            className="group block w-full text-left transition-colors hover:text-black dark:hover:text-white"
          >
            <RailSectionHeader label="Current task" meta={`+${currentTask.rewardXp} XP`} />
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border', toneClasses[currentTask.completed ? 'emerald' : 'sky'])}>
                  <currentTask.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white">{currentTask.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">{currentTask.detail}</p>
                </div>
              </div>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              <span>{currentTask.progressLabel}</span>
              <span>Open {ACCOUNT_TAB_LABELS[currentTask.tab]}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all"
                style={{ width: `${currentTask.progress}%` }}
              />
            </div>
          </button>
        ) : railState === 'complete' ? (
          <div>
            <RailSectionHeader label="Current task" meta="Ready" />
            <div className="mt-3 flex items-start gap-3">
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border', toneClasses.emerald)}>
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-black dark:text-white">Setup complete</p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">
                  Your profile, linked accounts, protections, and recovery details are in place. Check back here when new account tasks are available.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <RailSectionHeader label="Current task" meta="Waiting" />
            <div className="mt-3">
              <p className="text-sm font-medium text-black dark:text-white">No setup tasks assigned</p>
              <p className="mt-1 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">
                New setup items will appear here when your account needs attention or new requirements are added.
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-stretch gap-2">
          <RailMetricCard label="Open" value={openTaskCount} />
          <RailMetricCard label="Done" value={completedTaskCount} />
          <RailMetricCard label="Points" value={rewardPoints} />
        </div>
      </div>

      {railState === 'active' && queuedTasks.length > 0 ? (
        <div className="border-t border-zinc-200/70 dark:border-zinc-800/70">
          <div className="px-3 py-3">
            <RailSectionHeader label="Up next" meta={`${queuedTasks.length} queued`} />
          </div>
          <div className="border-t border-zinc-200/70 divide-y divide-zinc-200/70 dark:border-zinc-800/70 dark:divide-zinc-800/70">
            {queuedTasks.map((task, index) => {
              const Icon = task.icon;

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpen(task.tab)}
                  className="group grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-[#111111]"
                >
                  <span className="pt-0.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[12px] font-medium text-black dark:text-white">{task.title}</p>
                          <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border', task.completed ? toneClasses.emerald : toneClasses.zinc)}>
                            <Icon className="h-3 w-3" />
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{task.progressLabel}</p>
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="border-t border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          <span>{levelLabel} Lv.{levelNumber}</span>
          <span>{accountXp} XP</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>{pointsToNextLevel === 0 ? 'Top tier reached' : `${pointsToNextLevel} XP to next level`}</span>
          <span>{totalTaskCount > 0 ? `${completedTaskCount}/${totalTaskCount} complete` : 'Waiting'}</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all"
            style={{ width: `${levelProgress}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function AccountBenefitsRailCard({
  liveBenefits,
  nextUnlock,
  onDeckBenefits,
  onOpen,
}: {
  liveBenefits: AccountBenefitItem[];
  nextUnlock: AccountNextUnlock | null;
  onDeckBenefits: AccountBenefitItem[];
  onOpen: (tab: AccountTab) => void;
}) {
  return (
    <section className="overflow-hidden rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#141414]">
      <div className="px-3 py-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Why finish setup</p>
        <p className="mt-1 text-sm font-medium text-black dark:text-white">What improves as this account matures</p>
      </div>

      <div className="border-t border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
        <RailSectionHeader label="Live now" meta={`${liveBenefits.length} active`} />
        {liveBenefits.length > 0 ? (
          <div className="mt-3 space-y-3">
            {liveBenefits.map((benefit) => (
              <button
                key={benefit.id}
                type="button"
                onClick={() => onOpen(benefit.tab)}
                className="group flex w-full items-start gap-3 text-left transition-colors hover:text-black dark:hover:text-white"
              >
                <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border', toneClasses[benefit.tone])}>
                  <benefit.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-medium text-black dark:text-white">{benefit.name}</p>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Live</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{benefit.detail}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
            No account benefits are live yet. Finishing setup will unlock the first trust and recovery upgrades.
          </p>
        )}
      </div>

      {nextUnlock ? (
        <div className="border-t border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
          <RailSectionHeader label="Next unlock" />
          <button
            type="button"
            onClick={() => onOpen(nextUnlock.tab)}
            className="group mt-3 flex w-full items-start gap-3 text-left transition-colors hover:text-black dark:hover:text-white"
          >
            <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border', toneClasses[nextUnlock.tone])}>
              <nextUnlock.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white">{nextUnlock.name}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
              </div>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{nextUnlock.detail}</p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{nextUnlock.requirement}</p>
            </div>
          </button>
        </div>
      ) : null}

      {onDeckBenefits.length > 0 ? (
        <div className="border-t border-zinc-200/70 dark:border-zinc-800/70">
          <div className="px-3 py-3">
            <RailSectionHeader label="On deck" meta={`${onDeckBenefits.length} pending`} />
          </div>
          <div className="border-t border-zinc-200/70 divide-y divide-zinc-200/70 dark:border-zinc-800/70 dark:divide-zinc-800/70">
            {onDeckBenefits.map((benefit) => (
              <button
                key={benefit.id}
                type="button"
                onClick={() => onOpen(benefit.tab)}
                className="group flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-zinc-50 last:rounded-b-sm dark:hover:bg-[#111111]"
              >
                <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border', toneClasses[benefit.tone])}>
                  <benefit.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-medium text-black dark:text-white">{benefit.name}</p>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{benefit.requirement}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

    </section>
  );
}

export default function AccountHome() {
  const navigate = useNavigate();
  const { address } = useAppKitAccount();
  const { user, chainId, isAuthenticated } = useAppKitAuth();
  const { totalBalanceUSD, cashBalance, holdings, bankAccounts, bankAccountsLoading, refreshBankBalance } = usePortfolio();
  const { profileMenuUser, setActionModalOpen } = useGlobalModals();
  const [searchParams, setSearchParams] = useSearchParams();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const tabsAnchorRef = useRef<HTMLDivElement | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<string>('Not saved yet');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [walletDialogMode, setWalletDialogMode] = useState<WalletDialogMode>('link');
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [walletDraft, setWalletDraft] = useState<WalletDraft>(BLANK_WALLET_DRAFT);
  const [socialDialogOpen, setSocialDialogOpen] = useState(false);
  const [editingSocialId, setEditingSocialId] = useState<string | null>(null);
  const [socialDraft, setSocialDraft] = useState<SocialDraft>(BLANK_SOCIAL_DRAFT);
  const [refreshingBanks, setRefreshingBanks] = useState(false);
  const [memberAccount, setMemberAccount] = useState<MemberAccountCenterResponse | null>(null);
  const [membershipSummary, setMembershipSummary] = useState<MemberBillingSummaryResponse | null>(null);

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
      bio: 'Building across onchain communities and keeping every account connected in one place.',
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
    const membershipParam = searchParams.get('membership');
    if (membershipParam === 'success') {
      setBannerMessage('Membership checkout completed. Refreshing membership status.');
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('membership');
      setSearchParams(nextParams, { replace: true });
    } else if (membershipParam === 'cancelled') {
      setBannerMessage('Membership checkout was cancelled.');
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('membership');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    async function loadMemberAccount() {
      if (!isAuthenticated) {
        return;
      }

      setAccountLoading(true);
      const bootstrap = await bootstrapMemberAccount();
      if (!bootstrap || cancelled) {
        if (!cancelled) {
          setAccountLoading(false);
          setBannerMessage('We could not load your member account.');
        }
        return;
      }

      const account = await getMemberAccountCenter();
      const membership = await getMemberMembershipSummary();
      if (cancelled) return;

      if (account) {
        setMemberAccount(account);
        setProfileForm(profileFormFromAccount(account, user?.email));
        setProfileSavedAt(formatSavedAtLabel(account.profile.publicProfile.updatedAt));
        setSecurityControls(securityControlsFromAccount(account));
        setWallets(account.wallets.map(walletRecordFromApi));
        setSocialAccounts(account.socialAccounts.map(socialRecordFromApi));
      }

      if (membership) {
        setMembershipSummary(membership.billing);
      }

      setAccountLoading(false);
    }

    void loadMemberAccount();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.email]);

  useEffect(() => {
    if (!address || memberAccount) return;

    setWallets((current) => {
      const primaryWallet: WalletRecord = {
        id: 'wallet-primary',
        label: 'Primary wallet',
        address,
        description: '',
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
  }, [address, chainId, memberAccount]);

  useEffect(() => {
    if (!user?.social || memberAccount) return;

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
  }, [user?.social, memberAccount]);

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

  const linkedAccountGroupCount = [wallets.length > 0, socialAccounts.length > 0, bankAccounts.length > 0].filter(Boolean).length;
  const profileProgress = clampPercent((profileFieldsComplete / 6) * 100);
  const connectionProgress = clampPercent((linkedAccountGroupCount / 3) * 100);
  const securityEnabledCount = securityControls.filter((control) => control.enabled).length;
  const securityScore = clampPercent((securityEnabledCount / securityControls.length) * 100);
  const supportChecklistCount =
    Number(profileSavedAt !== 'Not saved yet') +
    Number(Boolean(profileForm.email)) +
    Number(Boolean(profileForm.phone)) +
    Number(securityEnabledCount >= 4);
  const supportProgress = clampPercent(supportChecklistCount * 25);
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

  const missionTrack = useMemo<MissionRailItem[]>(
    () => [
      {
        id: 'profile',
        label: 'Profile setup',
        detail: profileProgress === 100 ? 'Identity ready' : `${6 - profileFieldsComplete} fields left`,
        progress: profileProgress,
        tab: 'profile',
        icon: UserRound,
      },
      {
        id: 'connections',
        label: 'Connected accounts',
        detail:
          connectionProgress === 100
            ? 'Wallets, socials, and banks linked'
            : `${3 - linkedAccountGroupCount} connections left`,
        progress: connectionProgress,
        tab: 'connections',
        icon: Link2,
      },
      {
        id: 'security',
        label: 'Security',
        detail: `${securityEnabledCount}/${securityControls.length} protections active`,
        progress: securityScore,
        tab: 'security',
        icon: ShieldCheck,
      },
      {
        id: 'support',
        label: 'Documents & support',
        detail: supportProgress >= 100 ? 'Documents and recovery ready' : 'Complete recovery and export setup',
        progress: supportProgress,
        tab: 'support',
        icon: FileText,
      },
    ],
    [bankAccounts.length, connectionProgress, linkedAccountGroupCount, profileFieldsComplete, profileProgress, securityEnabledCount, securityScore, securityControls.length, socialAccounts.length, supportProgress, wallets.length]
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
        rarity: 'rare',
        statusLabel: profileProgress === 100 ? 'COMPLETE' : undefined,
        tab: 'profile',
      },
      {
        id: 'wallet-graph',
        name: 'Wallet Graph',
        detail: 'Add more than one trusted wallet',
        icon: Wallet,
        unlocked: wallets.length >= 2,
        tone: 'emerald',
        rarity: 'epic',
        statusLabel: wallets.length >= 2 ? 'TRUSTED' : undefined,
        tab: 'connections',
      },
      {
        id: 'signal-proof',
        name: 'Signal Proof',
        detail: 'Link at least one social handle',
        icon: Sparkles,
        unlocked: socialAccounts.length >= 1,
        tone: 'amber',
        rarity: 'legendary',
        statusLabel: socialAccounts.length >= 1 ? 'LIVE' : undefined,
        tab: 'connections',
      },
      {
        id: 'trust-lock',
        name: 'Trust Lock',
        detail: 'Reach 4 active protections',
        icon: ShieldCheck,
        unlocked: securityEnabledCount >= 4,
        tone: 'emerald',
        rarity: 'epic',
        statusLabel: securityEnabledCount >= 4 ? 'SECURED' : undefined,
        tab: 'security',
      },
      {
        id: 'cash-rail',
        name: 'Cash Rail',
        detail: 'Connect at least one institution',
        icon: Landmark,
        unlocked: bankAccounts.length >= 1,
        tone: 'sky',
        rarity: 'rare',
        statusLabel: bankAccounts.length >= 1 ? 'READY' : undefined,
        tab: 'connections',
      },
      {
        id: 'archive-ready',
        name: 'Archive Ready',
        detail: 'Save profile once to prepare exports',
        icon: Trophy,
        unlocked: profileSavedAt !== 'Not saved yet',
        tone: 'zinc',
        rarity: 'common',
        statusLabel: profileSavedAt !== 'Not saved yet' ? 'SAVED' : undefined,
        tab: 'support',
      },
    ],
    [bankAccounts.length, profileProgress, profileSavedAt, securityEnabledCount, socialAccounts.length, wallets.length]
  );
  const unlockedAchievementCount = accountAchievements.filter((achievement) => achievement.unlocked).length;

  const accountPerks = useMemo<AccountPerk[]>(
    () => [
      {
        id: 'priority-support',
        name: 'Priority support lane',
        description: 'Faster review context for profile and recovery issues.',
        icon: Crown,
        unlocked: securityEnabledCount >= 4,
        requirement: '4 protections',
        tone: 'emerald',
        tab: 'security',
      },
      {
        id: 'verified-ribbon',
        name: 'Verified account ribbon',
        description: 'Stronger trust signal once profile and socials are complete.',
        icon: Sparkles,
        unlocked: profileCompletion >= 80 && socialAccounts.length > 0,
        requirement: 'Finish profile',
        tone: 'sky',
        tab: 'profile',
      },
      {
        id: 'recovery-fastpass',
        name: 'Recovery fast-pass',
        description: 'Cleaner handoff for identity checks and account escalations.',
        icon: Gift,
        unlocked: Boolean(profileForm.email && profileForm.phone && wallets.length > 0),
        requirement: 'Add recovery info',
        tone: 'amber',
        tab: 'security',
      },
    ],
    [profileCompletion, profileForm.email, profileForm.phone, securityEnabledCount, socialAccounts.length, wallets.length]
  );
  const unlockedPerkCount = accountPerks.filter((perk) => perk.unlocked).length;

  const accountSetupTasks = useMemo<AccountSetupTask[]>(
    () => {
      const remainingProfileFields = Math.max(6 - profileFieldsComplete, 0);
      const missingConnections = Math.max(3 - linkedAccountGroupCount, 0);
      const protectionsToGoal = Math.max(4 - securityEnabledCount, 0);
      const recoveryStepsLeft = Math.max(4 - supportChecklistCount, 0);

      const tasks: AccountSetupTask[] = [
        {
          id: 'task-profile',
          title: 'Finish core profile',
          detail: remainingProfileFields === 0 ? 'Core identity details are complete and ready to review.' : 'Add your remaining identity details so your account is easier to verify.',
          rewardXp: 120,
          progress: profileProgress,
          progressLabel: remainingProfileFields === 0 ? 'Complete' : `${remainingProfileFields} fields left`,
          tab: 'profile',
          icon: UserRound,
          completed: remainingProfileFields === 0,
        },
        {
          id: 'task-connections',
          title: 'Link trusted accounts',
          detail: missingConnections === 0 ? 'Wallets, social accounts, and banks are all linked.' : 'Add the remaining account types to complete your connected account map.',
          rewardXp: 150,
          progress: connectionProgress,
          progressLabel: missingConnections === 0 ? 'Complete' : `${missingConnections} left`,
          tab: 'connections',
          icon: Link2,
          completed: missingConnections === 0,
        },
        {
          id: 'task-security',
          title: 'Tighten security',
          detail: protectionsToGoal === 0 ? 'Your core protections are active for sign-in and transfer reviews.' : 'Turn on more protections to strengthen sensitive changes and alerts.',
          rewardXp: 140,
          progress: clampPercent((Math.min(securityEnabledCount, 4) / 4) * 100),
          progressLabel: protectionsToGoal === 0 ? 'Ready' : `${protectionsToGoal} left`,
          tab: 'security',
          icon: ShieldCheck,
          completed: protectionsToGoal === 0,
        },
        {
          id: 'task-recovery',
          title: 'Prepare recovery',
          detail: recoveryStepsLeft === 0 ? 'Recovery contacts and export setup are ready.' : 'Add recovery details and save your profile once to prepare account support.',
          rewardXp: 110,
          progress: supportProgress,
          progressLabel: recoveryStepsLeft === 0 ? 'Ready' : `${recoveryStepsLeft} steps left`,
          tab: 'support',
          icon: FileText,
          completed: recoveryStepsLeft === 0,
        },
      ];

      return tasks.sort((left, right) => Number(left.completed) - Number(right.completed));
    },
    [connectionProgress, linkedAccountGroupCount, profileFieldsComplete, profileProgress, securityEnabledCount, supportChecklistCount, supportProgress]
  );
  const completedTaskCount = accountSetupTasks.filter((task) => task.completed).length;

  const nextUnlock = useMemo<AccountNextUnlock | null>(() => {
    const lockedPerk = accountPerks.find((perk) => !perk.unlocked);
    if (lockedPerk) {
      return {
        id: lockedPerk.id,
        name: lockedPerk.name,
        detail: lockedPerk.description,
        requirement: lockedPerk.requirement,
        tab: lockedPerk.tab,
        icon: lockedPerk.icon,
        tone: lockedPerk.tone,
      };
    }

    const lockedAchievement = accountAchievements.find((achievement) => !achievement.unlocked);
    if (lockedAchievement) {
      return {
        id: lockedAchievement.id,
        name: lockedAchievement.name,
        detail: lockedAchievement.detail,
        requirement: `Open ${ACCOUNT_TAB_LABELS[lockedAchievement.tab]}`,
        tab: lockedAchievement.tab,
        icon: lockedAchievement.icon,
        tone: lockedAchievement.tone,
      };
    }

    return null;
  }, [accountAchievements, accountPerks]);

  const focusTask = accountSetupTasks.find((task) => !task.completed) ?? accountSetupTasks[0] ?? null;
  const queuedTasks = accountSetupTasks.filter((task) => focusTask ? task.id !== focusTask.id : true).slice(0, 2);
  const rewardPoints =
    completedTaskCount * 110 +
    unlockedAchievementCount * 45 +
    unlockedPerkCount * 55 +
    Number(profileSavedAt !== 'Not saved yet') * 30;
  const accountXp =
    profileCompletion * 9 +
    securityEnabledCount * 50 +
    completedTaskCount * 150 +
    unlockedAchievementCount * 40 +
    unlockedPerkCount * 45 +
    linkedAccountGroupCount * 45 +
    Number(profileSavedAt !== 'Not saved yet') * 35;
  const levelIndex = LEVELS.findIndex((level) => accountXp >= level.min && accountXp <= level.max);
  const currentLevel = LEVELS[levelIndex >= 0 ? levelIndex : 0];
  const nextLevel = LEVELS[Math.min((levelIndex >= 0 ? levelIndex : 0) + 1, LEVELS.length - 1)];
  const levelFloor = currentLevel.min;
  const levelCeiling = currentLevel.max;
  const levelProgress = currentLevel.label === nextLevel.label
    ? 100
    : clampPercent(((accountXp - levelFloor) / (levelCeiling - levelFloor + 1)) * 100);
  const pointsToNextLevel = currentLevel.label === nextLevel.label ? 0 : Math.max(nextLevel.min - accountXp, 0);

  const accountBenefits = useMemo<AccountBenefitItem[]>(
    () => [
      ...accountPerks.map((perk) => ({
        id: perk.id,
        name: perk.name,
        detail: perk.description,
        requirement: perk.requirement,
        tab: perk.tab,
        icon: perk.icon,
        tone: perk.tone,
        live: perk.unlocked,
      })),
      ...accountAchievements.map((achievement) => ({
        id: achievement.id,
        name: achievement.name,
        detail: achievement.detail,
        requirement: achievement.statusLabel ?? `Open ${ACCOUNT_TAB_LABELS[achievement.tab]}`,
        tab: achievement.tab,
        icon: achievement.icon,
        tone: achievement.tone,
        live: achievement.unlocked,
      })),
    ],
    [accountAchievements, accountPerks]
  );

  const liveBenefits = accountBenefits.filter((benefit) => benefit.live).slice(0, 2);
  const onDeckBenefits = accountBenefits
    .filter((benefit) => !benefit.live && benefit.id !== nextUnlock?.id)
    .slice(0, 2);

  const handleTabOpen = (tab: AccountTab) => setSearchParams({ tab });
  const handleHeroAction = (tab: AccountTab) => {
    setSearchParams({ tab });
    window.requestAnimationFrame(() => {
      tabsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleProfileFieldChange = (field: keyof ProfileFormState, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const handleProfileSave = async () => {
    const profile = await updateMemberProfile({
      legalName: profileForm.legalName || null,
      displayName: profileForm.displayName || null,
      email: profileForm.email || null,
      phone: profileForm.phone || null,
      cityRegion: profileForm.location || null,
      residencyCountry: profileForm.residency || null,
      timezone: profileForm.timezone || null,
      settlementCurrency: profileForm.currency || null,
      bio: profileForm.bio || null,
    });

    if (!profile) {
      setBannerMessage('Profile update failed. Try again.');
      return;
    }

    const savedAt = formatSavedAtLabel(profile.profile.publicProfile.updatedAt);
    setProfileSavedAt(savedAt);
    setBannerMessage('Profile updated.');
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

  const resetWalletDialog = () => {
    setWalletDialogOpen(false);
    setWalletDialogMode('link');
    setEditingWalletId(null);
    setWalletDraft(BLANK_WALLET_DRAFT);
  };

  const openWalletLinkDialog = (wallet?: WalletRecord) => {
    setWalletDialogMode('link');
    setEditingWalletId(null);
    setWalletDraft(
      wallet
        ? {
            label: wallet.label,
            description: wallet.description,
            kind: wallet.kind,
          }
        : BLANK_WALLET_DRAFT
    );
    setWalletDialogOpen(true);
  };

  const openWalletEditDialog = (wallet: WalletRecord) => {
    setWalletDialogMode('edit');
    setEditingWalletId(wallet.id);
    setWalletDraft({
      label: wallet.label,
      description: wallet.description,
      kind: wallet.kind,
    });
    setWalletDialogOpen(true);
  };

  const saveWallet = async () => {
    if (!editingWalletId) return;
    if (!walletDraft.label.trim()) {
      setBannerMessage('Wallet name is required.');
      return;
    }

    const persistedWallets = await updateMemberWallet(parseLocalEntityId(editingWalletId, 'wallet-') ?? 0, {
      label: walletDraft.label.trim(),
      description: walletDraft.description.trim() || null,
      kind: walletKindToApi(walletDraft.kind),
    });

    if (!persistedWallets) {
      setBannerMessage('Wallet update failed.');
      return;
    }

    setWallets(persistedWallets.map(walletRecordFromApi));
    resetWalletDialog();
    setBannerMessage('Wallet updated.');
  };

  const startWalletLinkHandoff = async () => {
    if (!walletDraft.label.trim()) {
      setBannerMessage('Wallet name is required before you continue.');
      return;
    }

    const handoff = await createMemberWalletLinkHandoff({
      label: walletDraft.label.trim(),
      description: walletDraft.description.trim() || null,
    });
    if (!handoff) {
      setBannerMessage('We could not start wallet linking.');
      return;
    }
    savePendingWalletLinkHandoff({
      token: handoff.token,
      label: handoff.label || walletDraft.label.trim(),
      description: handoff.description || walletDraft.description.trim(),
      createdAt: handoff.createdAt,
      expiresAt: handoff.expiresAt,
    });
    resetWalletDialog();
    navigate('/wallet-link');
  };

  const removeWallet = async (walletId: string) => {
    if (walletId === 'wallet-primary') return;
    const persistedWallets = await deleteMemberWallet(parseLocalEntityId(walletId, 'wallet-') ?? 0);
    if (!persistedWallets) {
      setBannerMessage('Wallet removal failed.');
      return;
    }
    setWallets(persistedWallets.map(walletRecordFromApi));
    setBannerMessage('Wallet removed.');
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

  const saveSocial = async () => {
    if (!socialDraft.platform.trim() || !socialDraft.handle.trim()) {
      setBannerMessage('Platform and handle are required to link a social account.');
      return;
    }

    const persistedSocials = editingSocialId
      ? await updateMemberSocialAccount(parseLocalEntityId(editingSocialId, 'social-') ?? 0, {
          platform: socialDraft.platform.trim(),
          handle: socialDraft.handle.trim(),
          visibility: socialVisibilityToApi(socialDraft.visibility),
        })
      : await createMemberSocialAccount({
          platform: socialDraft.platform.trim(),
          handle: socialDraft.handle.trim(),
          visibility: socialVisibilityToApi(socialDraft.visibility),
        });

    if (!persistedSocials) {
      setBannerMessage(editingSocialId ? 'Social account update failed.' : 'Social account link failed.');
      return;
    }

    setSocialAccounts(persistedSocials.map(socialRecordFromApi));

    setSocialDialogOpen(false);
    setSocialDraft(BLANK_SOCIAL_DRAFT);
    setEditingSocialId(null);
    setBannerMessage(editingSocialId ? 'Social account updated.' : 'Social account linked.');
  };

  const removeSocial = async (socialId: string) => {
    const persistedSocials = await deleteMemberSocialAccount(parseLocalEntityId(socialId, 'social-') ?? 0);
    if (!persistedSocials) {
      setBannerMessage('Social account removal failed.');
      return;
    }
    setSocialAccounts(persistedSocials.map(socialRecordFromApi));
    setBannerMessage('Social account removed.');
  };

  const toggleSecurityControl = async (controlId: string) => {
    const nextControls = securityControls.map((control) =>
      control.id === controlId ? { ...control, enabled: !control.enabled } : control
    );

    const persistedSecurity = await updateMemberSecurity({
      signatureLock: nextControls.find((control) => control.id === 'signature-lock')?.enabled,
      sessionReview: nextControls.find((control) => control.id === 'session-review')?.enabled,
      biometricAccess: nextControls.find((control) => control.id === 'biometric-access')?.enabled,
      socialDiscovery: nextControls.find((control) => control.id === 'social-discovery')?.enabled,
      transferAlerts: nextControls.find((control) => control.id === 'transfer-alerts')?.enabled,
    });

    if (!persistedSecurity) {
      setBannerMessage('Security update failed.');
      return;
    }

    setSecurityControls(
      DEFAULT_SECURITY_CONTROLS.map((control) => {
        switch (control.id) {
          case 'signature-lock':
            return { ...control, enabled: persistedSecurity.signatureLock };
          case 'session-review':
            return { ...control, enabled: persistedSecurity.sessionReview };
          case 'biometric-access':
            return { ...control, enabled: persistedSecurity.biometricAccess };
          case 'social-discovery':
            return { ...control, enabled: persistedSecurity.socialDiscovery };
          case 'transfer-alerts':
            return { ...control, enabled: persistedSecurity.transferAlerts };
          default:
            return control;
        }
      })
    );
  };

  const handleRefreshBanks = async () => {
    setRefreshingBanks(true);
    try {
      await refreshBankBalance(true);
      setBannerMessage('Connected accounts refreshed.');
    } finally {
      setRefreshingBanks(false);
    }
  };

  const handleMembershipCheckout = async () => {
    setMembershipLoading(true);
    try {
      const checkout = await createMemberMembershipCheckout({
        plan: ((memberAccount?.member.membershipPlan || 'YEARLY') as 'YEARLY' | 'LIFETIME'),
        successUrl: `${window.location.origin}/account?tab=profile&membership=success`,
        cancelUrl: `${window.location.origin}/account?tab=profile&membership=cancelled`,
      });
      if (!checkout?.session.url) {
        setBannerMessage('Membership checkout could not be started.');
        return;
      }
      window.location.assign(checkout.session.url);
    } catch (error) {
      setBannerMessage(
        error instanceof Error ? error.message : 'Membership checkout could not be started.'
      );
    } finally {
      setMembershipLoading(false);
    }
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
              <div className="mb-1 mt-4 flex flex-wrap items-center gap-2 text-zinc-500 dark:text-zinc-400">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Account Center</span>
                <div className="group relative">
                  <Info className="h-4 w-4 cursor-help" />
                  <div className="absolute left-0 top-6 z-10 hidden max-w-[240px] rounded bg-zinc-900 px-2 py-1 text-xs text-white group-hover:block">
                    Profile, linked accounts, recovery details, and security settings in one place.
                  </div>
                </div>
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
                Manage your profile, connected accounts, security settings, and documents from one place.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>{profileForm.email || 'Add an email address'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>{address ? shortAddress(address) : 'Wallet not connected'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>{activeNetworks || 1} active network{activeNetworks === 1 ? '' : 's'}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <span>Account overview</span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-normal text-white transition-colors hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                  onClick={() => handleHeroAction('profile')}
                >
                  <Edit3 className="h-4 w-4" />
                  Edit profile
                </button>
                <button
                  type="button"
                  className="rounded-full border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-normal text-black transition-colors hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-[#141414] dark:text-white dark:hover:bg-[#141414]/80"
                  onClick={() => handleHeroAction('connections')}
                >
                  Add connection
                </button>
                <button
                  type="button"
                  className="rounded-full border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-normal text-black transition-colors hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-[#141414] dark:text-white dark:hover:bg-[#141414]/80"
                  onClick={() => handleHeroAction('security')}
                >
                  Review security
                </button>
              </div>

              {bannerMessage ? (
                <div className="mt-5 border-y border-emerald-500/30 bg-emerald-500/10 px-0 py-3 text-[12px] leading-5 text-emerald-800 dark:text-emerald-300">
                  {bannerMessage}
                </div>
              ) : null}

              {memberAccount ? (
                <div className="mt-5 flex flex-wrap items-center gap-3 border-y border-zinc-200/70 py-3 text-[12px] leading-5 text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-300">
                  <span>
                    Membership: {memberAccount.member.membershipStatus.replace(/_/g, ' ')}
                    {memberAccount.member.membershipPlan ? ` • ${memberAccount.member.membershipPlan}` : ''}
                  </span>
                  {membershipSummary?.subscription?.status ? (
                    <span>Stripe: {membershipSummary.subscription.status}</span>
                  ) : null}
                  {memberAccount.member.membershipStatus !== 'ACTIVE' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS}
                      onClick={handleMembershipCheckout}
                      disabled={membershipLoading}
                    >
                      <Crown className="h-4 w-4" />
                      {membershipLoading ? 'Starting checkout...' : 'Activate membership'}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {accountLoading ? (
                <p className="mt-4 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                  Loading account center details...
                </p>
              ) : null}
            </motion.div>

            <section>
              <div className="border-y border-zinc-200/70 py-4 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-light tracking-tight text-black dark:text-white">Account Snapshot</h2>
                    <p className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                      Track your profile, connected accounts, and account readiness at a glance.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {unlockedAchievementCount}/{accountAchievements.length} unlocked
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <HeroMetric label="Protected balance" value={formatCurrencyCompact(totalBalanceUSD)} detail="Combined balance across wallets and linked cash accounts" />
                <HeroMetric label="Linked accounts" value={String(accountSurfaceCount)} detail="Wallets, social profiles, and banks linked" />
                <HeroMetric label="Profile completion" value={`${profileCompletion}%`} detail="Progress across profile, connections, and security" />
                <HeroMetric label="Cash visibility" value={formatCurrencyCompact(cashBalance.totalCash)} detail="Available across linked cash accounts" />
              </div>
            </section>

            <section>
              <div className="border-y border-zinc-200/70 py-4 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-light tracking-tight text-black dark:text-white">Progress Track</h2>
                    <p className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                      Follow setup progress across your profile, connections, security, and support readiness.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {missionTrack.length} tracks
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {missionTrack.map((item) => (
                  <MissionRail key={item.id} item={item} onOpen={handleTabOpen} />
                ))}
              </div>
            </section>

            <motion.div
              {...sectionMotion}
              transition={{ ...sectionTransition, delay: 0.04 }}
              ref={tabsAnchorRef}
              className="scroll-mt-28 md:scroll-mt-32"
            >
              <Tabs value={activeTab}>
                <div className="flex items-center gap-6 overflow-x-auto border-y border-zinc-200/70 py-2 no-scrollbar dark:border-zinc-800/70">
                  {ACCOUNT_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => handleTabOpen(tab)}
                      className={cn(
                        'relative whitespace-nowrap py-1.5 text-sm font-medium transition-colors',
                        activeTab === tab
                          ? 'text-black dark:text-white'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      )}
                    >
                      {ACCOUNT_TAB_LABELS[tab]}
                      {activeTab === tab ? (
                        <motion.div
                          layoutId="accountActiveTab"
                          className="absolute bottom-0 left-0 right-0 h-[2px] bg-black dark:bg-white"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>

                <TabsContent value="profile" className="space-y-8 pt-2">
                  <SectionPanel
                    withTopBorder={false}
                    eyebrow="Identity"
                    title="Personal information"
                    description="Update your name, contact details, location, and profile bio."
                    action={<Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={handleProfileSave}>Save profile</Button>}
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
                    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <HeroMetric label="Core fields" value={`${profileFieldsComplete}/6`} detail="Identity details filled in" />
                      <HeroMetric label="Last updated" value={profileSavedAt} detail="Most recent profile update" />
                      <HeroMetric label="Profile status" value={profileSavedAt === 'Not saved yet' ? 'Draft' : 'Updated'} detail="Review and change these details anytime" />
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Defaults"
                    title="Account defaults"
                    description="Review your region, timezone, and settlement preferences."
                  >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <HeroMetric label="Primary region" value={profileForm.residency || 'Unset'} detail="Used for account disclosures and transfer settings" />
                      <HeroMetric label="Notification timezone" value={profileForm.timezone || 'Unset'} detail="Used for statements, alerts, and support updates" />
                      <HeroMetric label="Settlement currency" value={profileForm.currency || 'Unset'} detail="Used for balances, exports, and account summaries" />
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="connections" className="space-y-8 pt-2">
                  <SectionPanel
                    withTopBorder={false}
                    eyebrow="Wallets"
                    title="Associated wallets"
                    description="Manage wallets saved on this Clear account. Start by naming the wallet, then connect it in AppKit and approve one wallet-link signature to finish linking."
                    action={(
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => openWalletLinkDialog()}>
                          <Link2 className="h-4 w-4" />
                          Link wallet
                        </Button>
                      </div>
                    )}
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
                            <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => handleCopyAddress(wallet.address)}><Copy className="h-4 w-4" />Copy</Button>
                            {!wallet.verified && wallet.id !== 'wallet-primary' ? (
                              <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => openWalletLinkDialog(wallet)}><Link2 className="h-4 w-4" />Finish linking</Button>
                            ) : null}
                            <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => openWalletEditDialog(wallet)}><Edit3 className="h-4 w-4" />Edit</Button>
                            {wallet.id !== 'wallet-primary' ? (
                              <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => removeWallet(wallet.id)}><Trash2 className="h-4 w-4" />Remove</Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Social"
                    title="Linked social accounts"
                    description="Manage the social accounts linked to your profile."
                    action={<Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => openSocialDialog()}><Plus className="h-4 w-4" />Link social</Button>}
                  >
                    {socialAccounts.length === 0 ? (
                      <div className="border-y border-dashed border-zinc-300/80 px-0 py-8 text-center dark:border-zinc-700">
                        <p className="text-sm font-medium text-black dark:text-white">No social accounts linked yet</p>
                        <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">Link X, Farcaster, Discord, GitHub, or any other social profile you want connected to this account.</p>
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
                              <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => openSocialDialog(account)}><Edit3 className="h-4 w-4" />Edit</Button>
                              <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => removeSocial(account.id)}><Trash2 className="h-4 w-4" />Remove</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Funding"
                    title="Linked banks and cash accounts"
                    description="Review linked bank accounts and manage the cash accounts connected to your profile."
                    action={
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleRefreshBanks}
                          disabled={refreshingBanks}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', refreshingBanks && 'animate-spin')} />
                          {refreshingBanks ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => setBannerMessage('Funding setup started.')}><ArrowUpRight className="h-4 w-4" />Link funds</Button>
                      </div>
                    }
                  >
                    {bankAccountsLoading ? (
                      <div className="border-y border-zinc-200/70 px-0 py-8 text-[12px] leading-5 text-zinc-500 dark:border-zinc-800/70 dark:text-zinc-400">Loading linked institutions...</div>
                    ) : bankAccounts.length === 0 ? (
                      <div className="border-y border-dashed border-zinc-300/80 px-0 py-8 text-center dark:border-zinc-700">
                        <p className="text-sm font-medium text-black dark:text-white">No banks connected</p>
                        <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">Link a checking, savings, or brokerage account to manage funding and cash transfers.</p>
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

                <TabsContent value="security" className="space-y-8 pt-2">
                  <SectionPanel
                    withTopBorder={false}
                    eyebrow="Security"
                    title="Security and privacy"
                    description="Manage sign-in protections, alerts, and profile visibility settings."
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
                            <Button
                              variant="outline"
                              size="sm"
                              className={control.enabled ? ACCOUNT_TAB_BUTTON_SUCCESS_CLASS : ACCOUNT_TAB_BUTTON_SECONDARY_CLASS}
                              onClick={() => toggleSecurityControl(control.id)}
                            >
                              {control.enabled ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                              {control.enabled ? 'Turn off' : 'Turn on'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Recovery"
                    title="Recovery methods"
                    description="Review your primary recovery details and trusted account access points."
                  >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <HeroMetric label="Primary signer" value={address ? shortAddress(address) : 'Not connected'} detail="Your main wallet used to confirm sensitive account changes" />
                      <HeroMetric label="Recovery contacts" value={profileForm.phone || 'Add a recovery phone'} detail="Add phone and email to speed up account recovery" />
                      <HeroMetric label="Linked accounts" value={`${wallets.length} wallets / ${bankAccounts.length} banks`} detail="Review connected wallets and banks from one place" />
                    </div>
                    <div className="mt-6 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                      {accountPerks.map((perk) => (
                        <div
                          key={perk.id}
                          className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <div
                              className={cn(
                                'flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border bg-white dark:bg-[#121212]',
                                perk.unlocked ? toneClasses[perk.tone] : toneClasses.zinc
                              )}
                            >
                              <perk.icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-black dark:text-white">{perk.name}</p>
                              <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{perk.description}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400 md:text-right">
                            {perk.unlocked ? 'Active' : perk.requirement}
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>
                </TabsContent>

                <TabsContent value="support" className="space-y-8 pt-2">
                  <SectionPanel
                    withTopBorder={false}
                    eyebrow="Documents"
                    title="Statements and exports"
                    description="Access statements, exports, and account records."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {[
                        { title: 'Monthly statements', detail: 'Download a summary of balances, linked accounts, and transfers.', cta: 'Prepare PDF', message: 'Monthly statements are being prepared.' },
                        { title: 'Tax package', detail: 'Export your year-to-date activity for tax review.', cta: 'Generate export', message: 'Tax package is being prepared.' },
                        { title: 'Account archive', detail: 'Download a full record of your account details and connected profiles.', cta: 'Export JSON', message: 'Account archive is being prepared.' },
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
                          <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setBannerMessage(item.message)}><ArrowUpRight className="h-4 w-4" />{item.cta}</Button>
                        </div>
                      ))}
                    </div>
                  </SectionPanel>

                  <SectionPanel
                    eyebrow="Support"
                    title="Support and privacy requests"
                    description="Get help with account reviews, support requests, and privacy requests."
                  >
                    <div className="overflow-hidden border-y border-zinc-200/70 dark:border-zinc-800/70">
                      {[
                        { icon: Shield, title: 'Account review', detail: 'Report suspicious activity or request a manual review of your linked accounts.', cta: 'Open review request', message: 'Account review request started.' },
                        { icon: Sparkles, title: 'Priority support', detail: 'Contact support with your profile and connection details included.', cta: 'Contact support', message: 'Support request started.' },
                        { icon: AlertTriangle, title: 'Privacy request', detail: 'Request a copy of your data or submit a deletion request for account information.', cta: 'Start privacy request', message: 'Privacy request started.' },
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
                            <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setBannerMessage(item.message)}><ArrowUpRight className="h-4 w-4" />{item.cta}</Button>
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
              <AccountFocusRailCard
                tasks={accountSetupTasks}
                currentTask={focusTask}
                queuedTasks={queuedTasks}
                completedTaskCount={completedTaskCount}
                levelLabel={currentLevel.label}
                levelNumber={Math.min(levelIndex + 1, LEVELS.length)}
                levelProgress={levelProgress}
                accountXp={accountXp}
                pointsToNextLevel={pointsToNextLevel}
                rewardPoints={rewardPoints}
                onOpen={handleHeroAction}
              />
            </motion.div>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.12 }}>
              <AccountBenefitsRailCard
                liveBenefits={liveBenefits}
                nextUnlock={nextUnlock}
                onDeckBenefits={onDeckBenefits}
                onOpen={handleHeroAction}
              />
            </motion.div>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="space-y-2 rounded-sm border border-zinc-200/70 bg-gradient-to-r from-zinc-100/70 to-sky-50/60 p-4 dark:border-zinc-800/70 dark:from-[#141414] dark:to-[#10181a]">
                <p className="text-sm font-medium text-black dark:text-white">Keep moving the account forward.</p>
                <p className="text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
                  Finish open tasks, unlock the remaining perks, and keep recovery details current so the account stays ready.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Dialog
        open={walletDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetWalletDialog();
            return;
          }
          setWalletDialogOpen(true);
        }}
      >
        <DialogContent className="border-zinc-200 dark:border-zinc-800 dark:bg-[#111111]">
          <DialogHeader>
            <DialogTitle>
              {walletDialogMode === 'edit'
                ? 'Edit linked wallet'
                : 'Start linking a wallet'}
            </DialogTitle>
            <DialogDescription>
              {walletDialogMode === 'edit'
                ? 'Update how this wallet appears on your Clear account.'
                : 'Add a wallet name and optional description. The app will then open a dedicated wallet-link handoff page where you can connect the new wallet and finish linking it safely.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="walletLabel">Wallet name</Label>
              <Input id="walletLabel" value={walletDraft.label} onChange={(event) => setWalletDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Treasury Safe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walletDescription">Description</Label>
              <Textarea id="walletDescription" className="min-h-[96px]" value={walletDraft.description} onChange={(event) => setWalletDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional note about what this wallet is for." />
            </div>
            {walletDialogMode === 'edit' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="walletAddress">Wallet address</Label>
                  <Input
                    id="walletAddress"
                    value={wallets.find((wallet) => wallet.id === editingWalletId)?.address ?? ''}
                    readOnly
                    placeholder="Wallet address"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Wallet type</Label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {(['Primary', 'Hardware', 'Smart', 'Embedded'] as WalletKind[]).map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={walletDraft.kind === kind ? ACCOUNT_TAB_BUTTON_PRIMARY_CLASS : ACCOUNT_TAB_BUTTON_SECONDARY_CLASS}
                        onClick={() => setWalletDraft((current) => ({ ...current, kind }))}
                      >
                        {kind}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={resetWalletDialog}>Cancel</Button>
              {walletDialogMode === 'edit' ? (
                <Button variant="outline" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={saveWallet}>Save wallet</Button>
              ) : (
                <Button variant="outline" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => void startWalletLinkHandoff()}>
                  <Link2 className="h-4 w-4" />
                  Continue to wallet handoff
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={socialDialogOpen} onOpenChange={setSocialDialogOpen}>
        <DialogContent className="border-zinc-200 dark:border-zinc-800 dark:bg-[#111111]">
          <DialogHeader>
            <DialogTitle>{editingSocialId ? 'Edit social account' : 'Link social account'}</DialogTitle>
            <DialogDescription>
              Add a platform and handle to link it to your profile.
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
                  <Button
                    key={visibility}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={socialDraft.visibility === visibility ? ACCOUNT_TAB_BUTTON_PRIMARY_CLASS : ACCOUNT_TAB_BUTTON_SECONDARY_CLASS}
                    onClick={() => setSocialDraft((current) => ({ ...current, visibility }))}
                  >
                    {visibility}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setSocialDialogOpen(false)}>Cancel</Button>
              <Button variant="outline" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={saveSocial}>Save social</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
