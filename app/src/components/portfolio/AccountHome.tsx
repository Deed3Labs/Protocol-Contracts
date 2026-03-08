import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppKitAccount } from '@reown/appkit/react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
  Info,
  KeyRound,
  Landmark,
  Link2,
  Lock,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent } from '@/components/ui/tabs';
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

interface AccountPulseMilestone {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  achieved: boolean;
}

interface AccountPulseDay {
  date: Date;
  active: boolean;
  points: number;
  isPast: boolean;
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

const rarityColors = {
  common: 'text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-900/40',
  rare: 'text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20',
  epic: 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20',
  legendary: 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
};

const rarityGlow = {
  common: '',
  rare: 'shadow-[0_0_10px_rgba(14,165,233,0.12)]',
  epic: 'shadow-[0_0_12px_hsl(var(--equity)/0.10)]',
  legendary: 'shadow-[0_0_14px_rgba(245,158,11,0.18)]',
};

const ACCOUNT_TAB_BUTTON_PRIMARY_CLASS =
  'rounded-full border-black/10 bg-black text-white font-normal shadow-none hover:bg-black/90 dark:border-white/10 dark:bg-white dark:text-black dark:hover:bg-white/90';

const ACCOUNT_TAB_BUTTON_SECONDARY_CLASS =
  'rounded-full border-zinc-200 bg-zinc-100 text-black font-normal shadow-none hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-[#141414] dark:text-white dark:hover:bg-[#141414]/80';

const ACCOUNT_TAB_BUTTON_SUCCESS_CLASS =
  'rounded-full border-zinc-200 bg-emerald-500/10 text-emerald-700 font-normal shadow-none hover:bg-emerald-500/15 dark:border-zinc-800 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15';

const ACCOUNT_ACTIVITY_COLORS = ['#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const formatDateShort = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const formatPoints = (value: number) => `${value.toLocaleString('en-US')} pts`;

function generateAccountPulseHeatmap(today: Date, seed: number, checkedInToday: boolean): AccountPulseDay[][] {
  const todayStart = startOfDay(today);
  const weeks: AccountPulseDay[][] = [];

  for (let w = 3; w >= 0; w -= 1) {
    const week: AccountPulseDay[] = [];

    for (let d = 0; d < 7; d += 1) {
      const date = new Date(todayStart);
      date.setDate(date.getDate() - (w * 7 + (6 - d)));
      const isPast = date <= todayStart;
      const score = ((w + 1) * 71 + (d + 1) * 29 + seed * 17) % 100;
      const isToday = date.getTime() === todayStart.getTime();
      const active = isPast && (isToday ? checkedInToday : score > 32);
      const points = active ? 10 + ((score * 7) % 24) : 0;

      week.push({ date, active, points, isPast });
    }

    weeks.push(week);
  }

  return weeks;
}

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
    <section className={cn(withTopBorder ? 'border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70' : 'pt-0')}>
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

function AccountPulseCard({
  levelLabel,
  levelNumber,
  levelProgress,
  accountXp,
  nextLevelLabel,
  pointsToNextLevel,
  accountStreak,
  checkedInToday,
  onCheckIn,
  rewardPoints,
  profileCompletion,
  securityScore,
  accountSurfaceCount,
  milestones,
  weeks,
}: {
  levelLabel: string;
  levelNumber: number;
  levelProgress: number;
  accountXp: number;
  nextLevelLabel: string;
  pointsToNextLevel: number;
  accountStreak: number;
  checkedInToday: boolean;
  onCheckIn: () => void;
  rewardPoints: number;
  profileCompletion: number;
  securityScore: number;
  accountSurfaceCount: number;
  milestones: AccountPulseMilestone[];
  weeks: AccountPulseDay[][];
}) {
  const streakTarget = 60;
  const recentDays = weeks.flat().slice(-14);
  const weeklyTotals = weeks.map((week) => week.reduce((sum, day) => sum + (day.active ? day.points : 0), 0));
  const activeRecentDays = recentDays.filter((day) => day.active).length;
  const unlockedMilestones = milestones.filter((milestone) => milestone.achieved).length;
  const nextMilestone = milestones.find((milestone) => !milestone.achieved);
  const streakRingData = [
    { name: 'Active', value: Math.min(accountStreak, streakTarget), color: '#10b981' },
    { name: 'Remaining', value: Math.max(streakTarget - Math.min(accountStreak, streakTarget), 0), color: '#3f3f46' },
  ];
  const weeklyConsistencyData = weeklyTotals.map((total, index) => ({
    label: `W${index + 1}`,
    total,
  }));

  return (
    <section className="rounded-sm border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-[#141414]">
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
            Account Pulse
          </span>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <div className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative h-24 w-24 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={streakRingData}
                      dataKey="value"
                      innerRadius={31}
                      outerRadius={42}
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                      paddingAngle={streakRingData[1].value > 0 ? 2 : 0}
                      isAnimationActive
                      animationDuration={700}
                    >
                      {streakRingData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Flame className="mb-0.5 h-3.5 w-3.5 text-orange-500" />
                  <span className="text-base font-semibold leading-none">{accountStreak}</span>
                  <span className="mt-0.5 text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Days
                  </span>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Account Level {levelLabel} Lv.{levelNumber}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {nextMilestone ? `Next: ${nextMilestone.label}` : 'All account milestones unlocked'}
                </p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
                    <p className="text-sm font-semibold">{profileCompletion}%</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Profile</p>
                  </div>
                  <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
                    <p className="text-sm font-semibold">{securityScore}%</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Security</p>
                  </div>
                  <div className="rounded-sm border border-zinc-200/70 p-2 text-center dark:border-zinc-800/70">
                    <p className="text-sm font-semibold">{rewardPoints}</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Points</p>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                    <span>{Math.round(levelProgress)}% to {nextLevelLabel}</span>
                    <span>{levelProgress >= 100 ? 'Max tier' : `${pointsToNextLevel} XP left`}</span>
                  </div>
                  <Progress value={levelProgress} className="h-1.5" />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onCheckIn}
              disabled={checkedInToday}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-sm bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-100/90"
            >
              <Flame className="h-4 w-4" />
              {checkedInToday ? 'Checked in' : 'Check in'}
            </button>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {accountSurfaceCount} linked account{accountSurfaceCount === 1 ? '' : 's'} across this profile. {accountXp} XP total.
            </p>
          </div>

          <div className="py-3">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Milestone Track
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{unlockedMilestones}/{milestones.length}</p>
            </div>

            <div className="relative">
              <div className="absolute left-4 right-4 top-[14px] h-px bg-zinc-200 dark:bg-zinc-700" />
              <div className="grid grid-cols-5 gap-2">
                {milestones.map((milestone) => (
                  <div key={milestone.id} className="text-center">
                    <div
                      className={cn(
                        'relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full border',
                        milestone.achieved
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-[#0e0e0e] dark:text-zinc-400'
                      )}
                      title={milestone.label}
                    >
                      <milestone.icon className="h-3 w-3" />
                    </div>
                    <p className={cn('mt-2 text-[10px] font-medium', milestone.achieved ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400')}>
                      {milestone.shortLabel}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Recent Activity
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {activeRecentDays}/14 active days
              </p>
            </div>
            <div className="mb-2.5 grid grid-cols-14 gap-1">
              {recentDays.map((day, index) => (
                <div
                  key={`${day.date.toISOString()}-${index}`}
                  className={cn(
                    'h-5 rounded-sm border border-zinc-200/80 dark:border-zinc-800',
                    !day.active && 'bg-zinc-100 dark:bg-[#141414]'
                  )}
                  style={day.active ? { backgroundColor: `hsl(var(--equity) / ${0.22 + Math.min(day.points / 34, 1) * 0.62})` } : undefined}
                  title={day.active ? `${formatDateShort(day.date)} · ${formatPoints(day.points)}` : `${formatDateShort(day.date)} · inactive`}
                />
              ))}
            </div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Last 14 days</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Less</span>
                <div className="flex gap-0.5">
                  {[0.2, 0.45, 0.7, 0.95].map((opacity) => (
                    <div
                      key={opacity}
                      className="h-2.5 w-2.5 rounded-sm bg-emerald-500"
                      style={{ opacity }}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">More</span>
              </div>
            </div>
            <div className="rounded-sm border border-zinc-200/70 p-2 dark:border-zinc-800/70">
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyConsistencyData} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#71717a', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide domain={[0, 'dataMax + 20']} />
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{
                        background: '#18181b',
                        border: '1px solid #3f3f46',
                        borderRadius: '8px',
                        padding: '8px 10px',
                      }}
                      labelStyle={{ color: '#a1a1aa', fontSize: 11 }}
                      itemStyle={{ color: '#e4e4e7', fontSize: 11 }}
                      formatter={(value: number | string | undefined) => [formatPoints(Number(value ?? 0)), 'Activity']}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {weeklyConsistencyData.map((week, index) => (
                        <Cell
                          key={week.label}
                          fill={ACCOUNT_ACTIVITY_COLORS[index % ACCOUNT_ACTIVITY_COLORS.length]}
                          fillOpacity={0.9}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {weeklyTotals.map((weekTotal, index) => (
                  <p key={index} className="text-center text-[10px] text-zinc-500 dark:text-zinc-400">
                    W{index + 1}: {formatPoints(weekTotal)}
                  </p>
                ))}
              </div>
            </div>
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
      <div className="space-y-4">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <div className="pb-3">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Achievements
              </span>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                <Trophy className="mr-1 h-3 w-3" /> {unlockedCount}/{achievements.length}
              </Badge>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {achievements.map((achievement) => (
                <button
                  key={achievement.id}
                  type="button"
                  onClick={() => onOpen(achievement.tab)}
                  className={cn(
                    'flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded border p-2 text-center transition-all',
                    achievement.unlocked
                      ? cn(rarityColors[achievement.rarity], rarityGlow[achievement.rarity], 'hover:scale-[1.02]')
                      : 'border-dotted border-zinc-300 bg-zinc-100/40 text-zinc-500 opacity-50 dark:border-zinc-700 dark:bg-[#121212] dark:text-zinc-400'
                  )}
                  title={achievement.detail}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full',
                      achievement.unlocked ? 'bg-current/10' : 'bg-zinc-200 dark:bg-[#0e0e0e]'
                    )}
                  >
                    {achievement.unlocked ? (
                      <achievement.icon className="h-4 w-4" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
                    )}
                  </div>
                  <span className="text-[10px] font-medium leading-tight">{achievement.name}</span>
                  {achievement.statusLabel ? (
                    <span className="text-[8px] text-zinc-500 dark:text-zinc-400">
                      {achievement.statusLabel}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Perks & Rewards
              </span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unlockedPerks} active</span>
            </div>

            <div className="divide-y divide-zinc-200 border-y border-zinc-200/70 dark:divide-zinc-800 dark:border-zinc-800/70">
              {perks.map((perk) => (
                <div
                  key={perk.id}
                  className={cn(
                    'flex items-center gap-3 py-2.5 transition-colors',
                    perk.unlocked ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]' : 'opacity-65'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded',
                      perk.unlocked
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-200 text-zinc-500 dark:bg-[#141414]'
                    )}
                  >
                    {perk.unlocked ? <perk.icon className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{perk.name}</p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{perk.description}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 shrink-0 px-1.5 py-0 text-[9px]',
                      perk.unlocked
                        ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'text-zinc-500 dark:text-zinc-400'
                    )}
                  >
                    {perk.unlocked ? 'Active' : perk.requirement}
                  </Badge>
                </div>
              ))}
            </div>
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
  const tabsAnchorRef = useRef<HTMLDivElement | null>(null);
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
  const pointsToNextLevel = currentLevel.label === nextLevel.label ? 0 : Math.max(nextLevel.min - accountXp, 0);

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
            : `${3 - [wallets.length > 0, socialAccounts.length > 0, bankAccounts.length > 0].filter(Boolean).length} connections left`,
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

  const accountPulseMilestones = useMemo<AccountPulseMilestone[]>(
    () => [
      { id: 'profile', label: 'Profile Prime', shortLabel: 'PR', icon: Star, achieved: profileProgress === 100 },
      { id: 'wallets', label: 'Wallet Graph', shortLabel: 'WL', icon: Wallet, achieved: wallets.length >= 2 },
      { id: 'social', label: 'Signal Proof', shortLabel: 'SO', icon: Sparkles, achieved: socialAccounts.length >= 1 },
      { id: 'security', label: 'Trust Lock', shortLabel: 'SC', icon: ShieldCheck, achieved: securityEnabledCount >= 4 },
      { id: 'archive', label: 'Archive Ready', shortLabel: 'AR', icon: Trophy, achieved: profileSavedAt !== 'Not saved yet' },
    ],
    [profileProgress, profileSavedAt, securityEnabledCount, socialAccounts.length, wallets.length]
  );

  const accountPulseWeeks = useMemo(
    () => generateAccountPulseHeatmap(new Date(), rewardPoints + profileCompletion + securityScore + accountStreak, checkedInToday),
    [accountStreak, checkedInToday, profileCompletion, rewardPoints, securityScore]
  );

  const unlockedAchievementCount = accountAchievements.filter((achievement) => achievement.unlocked).length;

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

  const handleProfileSave = () => {
    const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
      note: walletDraft.note.trim() || 'Added to your account.',
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
    setBannerMessage(editingWalletId ? 'Wallet updated.' : 'Wallet added.');
  };

  const removeWallet = (walletId: string) => {
    if (walletId === 'wallet-primary') return;
    setWallets((current) => current.filter((wallet) => wallet.id !== walletId));
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
    setBannerMessage('Social account removed.');
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
      setBannerMessage('Connected accounts refreshed.');
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
            </motion.div>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="border-b border-zinc-200/70 pb-3 dark:border-zinc-800/70">
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

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="border-b border-zinc-200/70 pb-3 dark:border-zinc-800/70">
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

              <div className="mt-4 grid grid-cols-2 gap-3">
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

                <TabsContent value="profile" className="space-y-8 pt-3">
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

                <TabsContent value="connections" className="space-y-8 pt-3">
                  <SectionPanel
                    withTopBorder={false}
                    eyebrow="Wallets"
                    title="Associated wallets"
                    description="Manage the wallets connected to your account and review their status."
                    action={<Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={() => openWalletDialog()}><Plus className="h-4 w-4" />Add wallet</Button>}
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
                            <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => openWalletDialog(wallet)}><Edit3 className="h-4 w-4" />Edit</Button>
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

                <TabsContent value="security" className="space-y-8 pt-3">
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

                <TabsContent value="support" className="space-y-8 pt-3">
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
                          <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setBannerMessage(item.message)}>{item.cta}</Button>
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
                            <Button variant="outline" size="sm" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setBannerMessage(item.message)}>{item.cta}</Button>
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
                pointsToNextLevel={pointsToNextLevel}
                nextLevelLabel={currentLevel.label === nextLevel.label ? 'Max tier' : nextLevel.label}
                accountStreak={accountStreak}
                checkedInToday={checkedInToday}
                onCheckIn={handleAccountPulse}
                rewardPoints={rewardPoints}
                profileCompletion={profileCompletion}
                securityScore={securityScore}
                accountSurfaceCount={accountSurfaceCount}
                milestones={accountPulseMilestones}
                weeks={accountPulseWeeks}
              />
            </motion.div>

            <motion.div {...sectionMotion} transition={{ ...sectionTransition, delay: 0.12 }}>
              <AccountRewardsCard achievements={accountAchievements} perks={accountPerks} onOpen={handleTabOpen} />
            </motion.div>

            <section className="border-t border-zinc-200/70 pt-6 dark:border-zinc-800/70">
              <div className="space-y-2 rounded-sm border border-zinc-200/70 bg-gradient-to-r from-zinc-100/70 to-sky-50/60 p-4 dark:border-zinc-800/70 dark:from-[#141414] dark:to-[#10181a]">
                <p className="text-sm font-medium text-black dark:text-white">Everything tied to your account, in one place.</p>
                <p className="text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
                  Review your profile, linked accounts, security settings, and account records from one place.
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
              Add a wallet name, network, and note so you can recognize it later.
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
            <div className="space-y-2">
              <Label htmlFor="walletNote">Note</Label>
              <Textarea id="walletNote" className="min-h-[96px]" value={walletDraft.note} onChange={(event) => setWalletDraft((current) => ({ ...current, note: event.target.value }))} placeholder="What is this wallet used for?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={ACCOUNT_TAB_BUTTON_SECONDARY_CLASS} onClick={() => setWalletDialogOpen(false)}>Cancel</Button>
              <Button variant="outline" className={ACCOUNT_TAB_BUTTON_PRIMARY_CLASS} onClick={saveWallet}>Save wallet</Button>
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
