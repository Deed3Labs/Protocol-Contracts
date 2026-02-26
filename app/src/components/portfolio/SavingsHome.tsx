import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Crown,
  Flame,
  Gift,
  Home,
  Info,
  Landmark,
  Lock,
  Percent,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { LargePriceWheel } from '@/components/PriceWheel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  due: string;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  unlocked: boolean;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  date?: string;
}

interface Perk {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  unlocked: boolean;
  requirement: string;
}

interface Milestone {
  month: number;
  label: string;
  icon: LucideIcon;
  reward: string;
  achieved: boolean;
}

interface HeatmapDay {
  date: Date;
  saved: boolean;
  amount: number;
  isPast: boolean;
}

interface ActivityEvent {
  id: string;
  title: string;
  description: string;
  amount: number;
  date: Date;
  type: 'deposit' | 'credit' | 'reward';
  status: 'posted' | 'pending' | 'locked';
}

const ACCOUNT_NUMBER = 'ESA-4923-1209';
const ROUTING_NUMBER = '110000019';
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const INITIAL_GOALS: SavingsGoal[] = [
  { id: 'deposit-target', name: '2% Deposit Target', target: 12000, saved: 8450, due: 'Nov 2026' },
  { id: 'closing-costs', name: 'Closing Costs Buffer', target: 4500, saved: 2200, due: 'Jan 2027' },
];

const BASE_MILESTONES: Omit<Milestone, 'achieved'>[] = [
  { month: 1, label: 'First Month', icon: Star, reward: '$10 bonus' },
  { month: 3, label: 'Committed', icon: Zap, reward: '$50 bonus' },
  { month: 6, label: 'Half Year', icon: Flame, reward: '$100 bonus' },
  { month: 9, label: 'Strong Saver', icon: Gift, reward: '$150 bonus' },
  { month: 12, label: 'ELPA Ready', icon: Lock, reward: 'ELPA Eligible' },
];

const rarityColors = {
  common: 'text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-800/40',
  rare: 'text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
  epic: 'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20',
  legendary:
    'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20',
};

const rarityGlow = {
  common: '',
  rare: '',
  epic: 'shadow-[0_0_12px_hsl(var(--equity)/0.10)]',
  legendary: 'shadow-[0_0_14px_rgba(245,158,11,0.18)]',
};

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDateShort = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const sanitizeNumericInput = (value: string) => value.replace(/[^0-9.]/g, '');

const daysBetween = (from: Date, to: Date) => {
  const diff = to.getTime() - from.getTime();
  return Math.max(Math.floor(diff / 86_400_000), 0);
};

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

function generateHeatmap(today: Date, seed: number): HeatmapDay[][] {
  const todayStart = startOfDay(today);
  const weeks: HeatmapDay[][] = [];

  for (let w = 3; w >= 0; w -= 1) {
    const week: HeatmapDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(todayStart);
      date.setDate(date.getDate() - (w * 7 + (6 - d)));
      const isPast = date <= todayStart;
      const score = ((w + 1) * 97 + (d + 1) * 31 + seed * 17) % 100;
      const saved = isPast && score > 22;
      const amount = saved ? 20 + ((score * 9) % 180) : 0;
      week.push({ date, saved, amount, isPast });
    }
    weeks.push(week);
  }

  return weeks;
}

interface SavingsStreakCardProps {
  currentStreak: number;
  bestStreak: number;
  accountMonth: number;
  rewardPoints: number;
  weeks: HeatmapDay[][];
  milestones: Milestone[];
  checkedInToday: boolean;
  onCheckIn: () => void;
}

function SavingsStreakCard({
  currentStreak,
  bestStreak,
  accountMonth,
  rewardPoints,
  weeks,
  milestones,
  checkedInToday,
  onCheckIn,
}: SavingsStreakCardProps) {
  const saverLevel = currentStreak >= 60 ? 'Lv.4' : currentStreak >= 30 ? 'Lv.3' : currentStreak >= 14 ? 'Lv.2' : 'Lv.1';

  return (
    <Card className="border-zinc-200 dark:border-zinc-800 bg-card/50 backdrop-blur">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
            Savings Streak
          </span>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/10">
            <Flame className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-xs font-semibold text-orange-500">{currentStreak} days</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-2.5 rounded bg-zinc-100 dark:bg-zinc-900/50 text-center">
            <p className="text-lg font-semibold">{currentStreak}</p>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Current</span>
          </div>
          <div className="p-2.5 rounded bg-zinc-100 dark:bg-zinc-900/50 text-center">
            <p className="text-lg font-semibold">{bestStreak}</p>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Best</span>
          </div>
          <div className="p-2.5 rounded bg-zinc-100 dark:bg-zinc-900/50 text-center">
            <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{saverLevel}</p>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Saver Level</span>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex gap-0.5">
            <div className="flex flex-col gap-0.5 mr-1">
              {DAY_LABELS.map((label, index) => (
                <div key={`${label}-${index}`} className="w-4 h-4 flex items-center justify-center">
                  <span className="text-[8px] text-zinc-500 dark:text-zinc-400">{label}</span>
                </div>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex-1 flex flex-col gap-0.5">
                {week.map((day, dayIndex) => (
                  <div
                    key={dayIndex}
                    className={cn('aspect-square rounded-sm transition-all', !day.isPast && 'bg-zinc-100 dark:bg-zinc-900/50')}
                    style={{
                      backgroundColor: day.saved
                        ? `hsl(var(--equity) / ${0.2 + Math.min(day.amount / 180, 1) * 0.6})`
                        : day.isPast
                        ? 'hsl(var(--secondary))'
                        : undefined,
                    }}
                    title={day.saved ? `${formatDateShort(day.date)} · $${day.amount}` : `${formatDateShort(day.date)} · no deposit`}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">4 weeks ago</span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Less</span>
              <div className="flex gap-px">
                {[0.15, 0.3, 0.5, 0.7, 0.9].map((alpha) => (
                  <div
                    key={alpha}
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: `hsl(var(--equity) / ${alpha})` }}
                  />
                ))}
              </div>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">More</span>
            </div>
          </div>
        </div>

        <div className="relative mb-4">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-800" />
          <div className="space-y-2.5">
            {milestones.map((milestone) => (
              <div key={milestone.month} className="flex items-center gap-3 relative">
                <div
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center z-10 shrink-0',
                    milestone.achieved
                      ? 'bg-emerald-600 text-white'
                      : accountMonth >= milestone.month - 1
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                      : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500'
                  )}
                >
                  <milestone.icon className="w-3 h-3" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <p className={cn('text-xs font-medium', !milestone.achieved && 'text-zinc-500 dark:text-zinc-400')}>
                      {milestone.label}
                    </p>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Month {milestone.month}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px]',
                      milestone.achieved
                        ? 'text-emerald-600 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                        : 'text-zinc-500 dark:text-zinc-400'
                    )}
                  >
                    {milestone.reward}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/30">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Reward points</p>
            <p className="text-sm font-semibold">{rewardPoints} pts</p>
          </div>
          <button
            type="button"
            onClick={onCheckIn}
            disabled={checkedInToday}
            className="w-full mt-3 h-9 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkedInToday ? 'Checked in today' : 'Check in & save'}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

interface RewardsPerksCardProps {
  achievements: Achievement[];
  perks: Perk[];
}

function RewardsPerksCard({ achievements, perks }: RewardsPerksCardProps) {
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
  const unlockedPerks = perks.filter((perk) => perk.unlocked).length;

  return (
    <div className="space-y-4">
      <Card className="border-zinc-200 dark:border-zinc-800 bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
              Achievements
            </span>
            <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
              <Trophy className="w-3 h-3 mr-1" /> {unlockedCount}/{achievements.length}
            </Badge>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {achievements.map((achievement) => (
              <button
                key={achievement.id}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded border transition-all',
                  achievement.unlocked
                    ? cn(rarityColors[achievement.rarity], rarityGlow[achievement.rarity], 'hover:scale-105')
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/30 opacity-45'
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    achievement.unlocked ? 'bg-current/10' : 'bg-zinc-200 dark:bg-zinc-800'
                  )}
                >
                  {achievement.unlocked ? (
                    <achievement.icon className="w-4 h-4" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-center leading-tight">{achievement.name}</span>
                {achievement.date && <span className="text-[8px] text-zinc-500 dark:text-zinc-400">{achievement.date}</span>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 dark:border-zinc-800 bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
              Perks & Rewards
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unlockedPerks} active</span>
          </div>

          <div className="space-y-2">
            {perks.map((perk) => (
              <div
                key={perk.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded transition-all',
                  perk.unlocked
                    ? 'bg-emerald-500/5 border border-emerald-500/20 hover:bg-emerald-500/10'
                    : 'bg-zinc-100/60 dark:bg-zinc-900/30 opacity-65'
                )}
              >
                <div
                  className={cn(
                    'w-9 h-9 rounded flex items-center justify-center shrink-0',
                    perk.unlocked
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                  )}
                >
                  {perk.unlocked ? <perk.icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{perk.name}</p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{perk.description}</p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] shrink-0',
                    perk.unlocked
                      ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      : 'text-zinc-500 dark:text-zinc-400'
                  )}
                >
                  {perk.unlocked ? 'Active' : perk.requirement}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SavingsHome() {
  const { isConnected } = useAppKitAccount();
  const { cashBalance: portfolioCashBalance, previousTotalBalanceUSD } = usePortfolio();
  const cashBalance = portfolioCashBalance?.totalCash ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const { setActionModalOpen } = useGlobalModals();

  const [streakDays, setStreakDays] = useState(45);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [rewardPoints, setRewardPoints] = useState(860);
  const [goals, setGoals] = useState<SavingsGoal[]>(INITIAL_GOALS);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [homePriceInput, setHomePriceInput] = useState('420000');
  const [downPctInput, setDownPctInput] = useState('2');
  const [monthlySaveInput, setMonthlySaveInput] = useState('900');
  const [copiedField, setCopiedField] = useState<'account' | 'routing' | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'deposit' | 'credit' | 'reward'>('all');

  const today = useMemo(() => new Date(), []);
  const accountOpenedDate = useMemo(() => {
    const opened = new Date();
    opened.setDate(opened.getDate() - 248);
    return opened;
  }, []);
  const lastDepositDate = useMemo(() => {
    const lastDeposit = new Date();
    lastDeposit.setDate(lastDeposit.getDate() - 18);
    return lastDeposit;
  }, []);

  const savingsBalance = isConnected ? Math.max(cashBalance, 0) : 0;
  const daysOpen = daysBetween(accountOpenedDate, today);
  const accountMonth = Math.max(Math.floor(daysOpen / 30), 1);
  const daysFromLastDeposit = daysBetween(lastDepositDate, today);
  const postingProgress = Math.min((daysFromLastDeposit / 30) * 100, 100);
  const elpaProgress = Math.min((daysOpen / 365) * 100, 100);
  const daysUntilPosting = Math.max(30 - daysFromLastDeposit, 0);
  const daysUntilElpa = Math.max(365 - daysOpen, 0);

  const pendingMatchCredits = savingsBalance;
  const semiValidCredits = pendingMatchCredits * (postingProgress / 100);
  const elpaUsableCredits = daysOpen >= 365 ? semiValidCredits : 0;
  const elpaDepositPower = savingsBalance + elpaUsableCredits;
  const projectedDepositPower = savingsBalance + semiValidCredits;

  const homePrice = Number(homePriceInput) || 0;
  const downPct = Number(downPctInput) || 0;
  const monthlySave = Number(monthlySaveInput) || 0;
  const requiredDeposit = homePrice * (downPct / 100);
  const effectiveMonthly = monthlySave * 2;
  const currentTowardDeposit = savingsBalance + semiValidCredits;
  const remainingDeposit = Math.max(requiredDeposit - currentTowardDeposit, 0);
  const monthsToDeposit = effectiveMonthly > 0 ? Math.ceil(remainingDeposit / effectiveMonthly) : null;
  const projectedDepositDate = useMemo(() => {
    if (!monthsToDeposit) return null;
    const estimate = new Date();
    estimate.setMonth(estimate.getMonth() + monthsToDeposit);
    return estimate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, [monthsToDeposit]);

  const totalGoalTarget = goals.reduce((sum, goal) => sum + goal.target, 0);
  const totalGoalSaved = goals.reduce((sum, goal) => sum + goal.saved, 0);
  const goalsProgressPct = totalGoalTarget > 0 ? Math.min((totalGoalSaved / totalGoalTarget) * 100, 100) : 0;
  const completedGoals = goals.filter((goal) => goal.saved >= goal.target).length;

  const milestones = useMemo<Milestone[]>(
    () =>
      BASE_MILESTONES.map((milestone) => ({
        ...milestone,
        achieved: accountMonth >= milestone.month,
      })),
    [accountMonth]
  );

  const heatmapWeeks = useMemo(() => generateHeatmap(today, accountMonth + streakDays), [today, accountMonth, streakDays]);
  const totalSavedInHeatmap = useMemo(
    () => heatmapWeeks.flat().reduce((sum, day) => sum + (day.saved ? day.amount : 0), 0),
    [heatmapWeeks]
  );

  const achievements = useMemo<Achievement[]>(
    () => [
      {
        id: '1',
        name: 'First Deposit',
        description: 'Made your first deposit',
        icon: Star,
        unlocked: savingsBalance > 0,
        rarity: 'common',
        date: 'Jun 2025',
      },
      {
        id: '2',
        name: 'Week Warrior',
        description: 'Saved 7 days in a row',
        icon: Zap,
        unlocked: streakDays >= 7,
        rarity: 'common',
        date: 'Jul 2025',
      },
      {
        id: '3',
        name: 'Month Master',
        description: 'Saved every month for 3 months',
        icon: Flame,
        unlocked: streakDays >= 30,
        rarity: 'rare',
        date: 'Sep 2025',
      },
      {
        id: '4',
        name: 'Credit Collector',
        description: 'Earned $1,000 in equity credits',
        icon: Trophy,
        unlocked: semiValidCredits >= 1000,
        rarity: 'rare',
        date: 'Oct 2025',
      },
      {
        id: '5',
        name: 'Goal Getter',
        description: 'Completed a savings goal',
        icon: Target,
        unlocked: completedGoals > 0,
        rarity: 'rare',
        date: 'Nov 2025',
      },
      {
        id: '6',
        name: 'Halfway There',
        description: 'Reached 50% of ELPA eligibility',
        icon: TrendingUp,
        unlocked: elpaProgress >= 50,
        rarity: 'epic',
        date: 'Dec 2025',
      },
      {
        id: '7',
        name: 'Power Saver',
        description: 'Deposit $5,000+ in a single month',
        icon: Crown,
        unlocked: totalSavedInHeatmap >= 5000,
        rarity: 'epic',
      },
      {
        id: '8',
        name: 'ELPA Pioneer',
        description: 'Reach full ELPA eligibility',
        icon: Home,
        unlocked: daysOpen >= 365,
        rarity: 'legendary',
      },
    ],
    [completedGoals, daysOpen, elpaProgress, semiValidCredits, savingsBalance, streakDays, totalSavedInHeatmap]
  );

  const perks = useMemo<Perk[]>(
    () => [
      {
        id: '1',
        name: 'Bonus Credits',
        description: '+5% bonus on deposits over $500',
        icon: Percent,
        unlocked: streakDays >= 90,
        requirement: '3-month streak',
      },
      {
        id: '2',
        name: 'Priority Support',
        description: 'Dedicated savings advisor access',
        icon: ShieldCheck,
        unlocked: daysOpen >= 180,
        requirement: '6-month account',
      },
      {
        id: '3',
        name: 'Early ELPA Preview',
        description: 'Preview homes before eligibility',
        icon: Home,
        unlocked: daysOpen >= 270,
        requirement: '9-month account',
      },
      {
        id: '4',
        name: 'Referral Bonus 2x',
        description: 'Double referral credits',
        icon: Gift,
        unlocked: savingsBalance >= 10000,
        requirement: '$10K total saved',
      },
    ],
    [daysOpen, savingsBalance, streakDays]
  );

  const activityEvents = useMemo<ActivityEvent[]>(
    () => [
      {
        id: 'evt-1',
        title: 'Auto-save deposit',
        description: 'Weekly bank transfer posted to ESA.',
        amount: 250,
        date: today,
        type: 'deposit',
        status: 'posted',
      },
      {
        id: 'evt-2',
        title: '1:1 equity credit',
        description:
          daysUntilPosting > 0
            ? `Posts as semi-valid in ${daysUntilPosting} day${daysUntilPosting === 1 ? '' : 's'}.`
            : 'Credit posted as semi-valid.',
        amount: 250,
        date: lastDepositDate,
        type: 'credit',
        status: daysUntilPosting > 0 ? 'pending' : 'posted',
      },
      {
        id: 'evt-3',
        title: 'Streak reward',
        description: 'Consistency reward credited to your perk balance.',
        amount: 25,
        date: new Date(today.getTime() - 86_400_000 * 2),
        type: 'reward',
        status: 'posted',
      },
      {
        id: 'evt-4',
        title: 'ELPA unlock gate',
        description:
          daysUntilElpa > 0
            ? `Credits unlock for ELPA usage in ${daysUntilElpa} day${daysUntilElpa === 1 ? '' : 's'}.`
            : 'Credits are now ELPA-eligible.',
        amount: semiValidCredits,
        date: accountOpenedDate,
        type: 'credit',
        status: daysUntilElpa > 0 ? 'locked' : 'posted',
      },
    ],
    [accountOpenedDate, daysUntilElpa, daysUntilPosting, lastDepositDate, semiValidCredits, today]
  );

  const filteredActivity = useMemo(
    () =>
      activityFilter === 'all'
        ? activityEvents
        : activityEvents.filter((event) => event.type === activityFilter),
    [activityEvents, activityFilter]
  );

  const activityTotals = useMemo(() => {
    const deposits = activityEvents
      .filter((event) => event.type === 'deposit')
      .reduce((sum, event) => sum + event.amount, 0);
    const postedCredits = activityEvents
      .filter((event) => event.type === 'credit' && event.status === 'posted')
      .reduce((sum, event) => sum + event.amount, 0);
    const lockedCredits = activityEvents
      .filter((event) => event.type === 'credit' && event.status !== 'posted')
      .reduce((sum, event) => sum + event.amount, 0);
    return { deposits, postedCredits, lockedCredits };
  }, [activityEvents]);

  useEffect(() => {
    const handleScroll = () => setIsScrolledPast(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleCheckIn = () => {
    if (checkedInToday) return;
    setCheckedInToday(true);
    setStreakDays((prev) => prev + 1);
    setRewardPoints((prev) => prev + 25);
  };

  const handleAddGoal = () => {
    const target = Number(newGoalTarget);
    if (!newGoalName.trim() || !target || target <= 0) return;

    setGoals((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: newGoalName.trim(),
        target,
        saved: 0,
        due: 'TBD',
      },
    ]);
    setNewGoalName('');
    setNewGoalTarget('');
  };

  const handleTopUpGoal = (goalId: string, amount: number) => {
    setGoals((prev) =>
      prev.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              saved: Math.min(goal.saved + amount, goal.target),
            }
          : goal
      )
    );
  };

  const handleCopy = async (field: 'account' | 'routing', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
    } catch {
      setCopiedField(null);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans pb-20 md:pb-0 transition-colors duration-200">
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
      <DepositModal isOpen={depositModalOpen} onClose={() => setDepositModalOpen(false)} />
      <WithdrawModal isOpen={withdrawModalOpen} onClose={() => setWithdrawModalOpen(false)} />

      <HeaderNav
        isScrolledPast={isScrolledPast}
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />

      <main className="pt-24 pb-28 container mx-auto md:pt-32">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
          <div className="md:col-span-8 space-y-6">
            <div>
              <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-400">
                <span className="text-sm font-medium">ELPA Deposit Power</span>
                <div className="group relative">
                  <Info className="h-4 w-4 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-[240px]">
                    Savings balance + ELPA-eligible equity credits.
                  </div>
                </div>
              </div>

              <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                <LargePriceWheel value={elpaDepositPower} previousValue={previousTotalBalanceUSD} className="font-light" />
                <span className="text-lg text-zinc-500 font-normal">USD</span>
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                  1:1 Equity Match
                </Badge>
                <Badge variant="outline" className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  Credits post semi-valid after 30 days
                </Badge>
                <Badge variant="outline" className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  ELPA usable after 12 months
                </Badge>
              </div>

              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
                {daysUntilElpa > 0
                  ? `Projected deposit power at full ELPA unlock: ${formatCurrency(projectedDepositPower)}`
                  : 'All posted credits are ELPA-usable now.'}
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => setDepositModalOpen(true)}
                  className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Add Savings
                </button>
                <button
                  onClick={() => setWithdrawModalOpen(true)}
                  className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 disabled:opacity-50"
                  disabled={!isConnected || savingsBalance === 0}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  Withdraw
                </button>
              </div>
            </div>

            <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                    <Landmark className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-medium text-black dark:text-white">Equity Savings Account</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Account {ACCOUNT_NUMBER}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                  Active
                </Badge>
              </div>

              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Savings Balance</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(savingsBalance)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Semi-Valid Credits</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(semiValidCredits)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Pending Credits</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(Math.max(pendingMatchCredits - semiValidCredits, 0))}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950/30">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                        <Clock3 className="w-3.5 h-3.5" />
                        Credit posting (30 days)
                      </span>
                      <span className="font-medium">{Math.round(postingProgress)}%</span>
                    </div>
                    <Progress value={postingProgress} className="h-2" />
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
                      {daysUntilPosting > 0
                        ? `${daysUntilPosting} day${daysUntilPosting === 1 ? '' : 's'} until latest credit posts`
                        : 'Latest credit has posted as semi-valid'}
                    </p>
                  </div>

                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950/30">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                        <Home className="w-3.5 h-3.5" />
                        ELPA eligibility (12 months)
                      </span>
                      <span className="font-medium">{Math.round(elpaProgress)}%</span>
                    </div>
                    <Progress value={elpaProgress} className="h-2" />
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
                      {daysUntilElpa > 0
                        ? `${daysUntilElpa} day${daysUntilElpa === 1 ? '' : 's'} until ELPA usage unlock`
                        : 'Credits are ELPA-eligible now'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950/30">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Account Number
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-sm">{ACCOUNT_NUMBER}</span>
                      <button
                        type="button"
                        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors flex items-center gap-1"
                        onClick={() => handleCopy('account', ACCOUNT_NUMBER)}
                      >
                        {copiedField === 'account' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedField === 'account' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950/30">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Routing Number
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-sm">{ROUTING_NUMBER}</span>
                      <button
                        type="button"
                        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors flex items-center gap-1"
                        onClick={() => handleCopy('routing', ROUTING_NUMBER)}
                      >
                        {copiedField === 'routing' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedField === 'routing' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base font-medium">Savings Goals</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {completedGoals}/{goals.length} complete
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-zinc-500 dark:text-zinc-400">Total goal progress</span>
                    <span className="font-medium">{Math.round(goalsProgressPct)}%</span>
                  </div>
                  <Progress value={goalsProgressPct} className="h-2" />
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {formatCurrency(totalGoalSaved)} / {formatCurrency(totalGoalTarget)}
                  </div>
                </div>

                {goals.map((goal) => {
                  const progress = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
                  const remaining = Math.max(goal.target - goal.saved, 0);
                  return (
                    <motion.div
                      key={goal.id}
                      whileHover={{ scale: 1.01 }}
                      className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{goal.name}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Target date: {goal.due}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{Math.round(progress)}%</Badge>
                      </div>
                      <Progress value={progress} className="h-2 mt-3" />
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(goal.saved)} saved · {formatCurrency(remaining)} remaining
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleTopUpGoal(goal.id, 100)}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            +$100
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTopUpGoal(goal.id, 250)}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            +$250
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}

                <div className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
                    Add Goal
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2">
                    <input
                      value={newGoalName}
                      onChange={(event) => setNewGoalName(event.target.value)}
                      placeholder="Goal name"
                      className="h-9 px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
                    />
                    <input
                      value={newGoalTarget}
                      onChange={(event) => setNewGoalTarget(sanitizeNumericInput(event.target.value))}
                      placeholder="Target ($)"
                      className="h-9 px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddGoal}
                      className="h-9 px-4 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base font-medium">Home Savings Calculator</CardTitle>
                  <Badge variant="outline" className="text-[10px]">1:1 Match Included</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Home Price</p>
                    <input
                      value={homePriceInput}
                      onChange={(event) => setHomePriceInput(sanitizeNumericInput(event.target.value))}
                      className="h-9 w-full px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Deposit %</p>
                    <input
                      value={downPctInput}
                      onChange={(event) => setDownPctInput(sanitizeNumericInput(event.target.value))}
                      className="h-9 w-full px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Monthly Savings</p>
                    <input
                      value={monthlySaveInput}
                      onChange={(event) => setMonthlySaveInput(sanitizeNumericInput(event.target.value))}
                      className="h-9 w-full px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Required Deposit ({downPct}%)</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(requiredDeposit)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Current toward Deposit</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(currentTowardDeposit)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Remaining</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(remainingDeposit)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Estimated Timeline</p>
                    <p className="text-lg font-medium mt-1">
                      {monthsToDeposit == null ? 'Set monthly amount' : `${monthsToDeposit} months`}
                    </p>
                    {projectedDepositDate && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Target month: {projectedDepositDate}</p>
                    )}
                  </div>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Effective monthly contribution is doubled after credits post semi-valid.
                </p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base font-medium">History & Activity</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {filteredActivity.length} items
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Deposits</p>
                    <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.deposits)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Posted Credits</p>
                    <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.postedCredits)}</p>
                  </div>
                  <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Locked/Pending</p>
                    <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.lockedCredits)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'deposit', label: 'Deposits' },
                    { key: 'credit', label: 'Credits' },
                    { key: 'reward', label: 'Rewards' },
                  ].map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setActivityFilter(filter.key as 'all' | 'deposit' | 'credit' | 'reward')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        activityFilter === filter.key
                          ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                          : 'bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {filteredActivity.map((event) => {
                    const icon =
                      event.type === 'deposit' ? ArrowUpRight : event.type === 'credit' ? Sparkles : Gift;
                    const Icon = icon;
                    return (
                      <div
                        key={event.id}
                        className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <p className="text-sm font-medium">{event.title}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                event.status === 'posted' &&
                                  'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:bg-emerald-900/20',
                                event.status === 'pending' &&
                                  'border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-900/20',
                                event.status === 'locked' &&
                                  'border-zinc-300 text-zinc-600 bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:bg-zinc-800/40'
                              )}
                            >
                              {event.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">{event.description}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{formatDateShort(event.date)}</p>
                        </div>
                        <p className="text-sm font-medium shrink-0">{event.amount >= 0 ? '+' : ''}{formatCurrency(event.amount)}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-4 space-y-4">
            <SavingsStreakCard
              currentStreak={streakDays}
              bestStreak={52}
              accountMonth={accountMonth}
              rewardPoints={rewardPoints}
              weeks={heatmapWeeks}
              milestones={milestones}
              checkedInToday={checkedInToday}
              onCheckIn={handleCheckIn}
            />

            <RewardsPerksCard achievements={achievements} perks={perks} />

            <Card className="border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-blue-50 to-emerald-50/60 dark:from-blue-950/20 dark:to-emerald-950/20">
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm font-medium">Stop Renting. Start Owning. Take the CLEAR path.</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  EquityShare is a 2026-first home financing solution. We buy the home you want, you move in, and a
                  portion of every monthly payment builds your real-world equity.
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  EquityShare is facilitated via an Equity-Lease Participation Agreement (ELPA), an asset-backed
                  residency contract. 2% down. No credit trap. 100% Assurance.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
