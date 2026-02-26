import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Flame,
  Gift,
  Home,
  Info,
  Landmark,
  Lock,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
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
  tier: 'common' | 'rare' | 'epic';
}

interface Perk {
  id: string;
  name: string;
  description: string;
  requirement: string;
  active: boolean;
  icon: LucideIcon;
}

interface CreditActivityEvent {
  id: string;
  title: string;
  description: string;
  amount: number;
  date: Date;
  type: 'deposit' | 'credit' | 'perk';
  status: 'posted' | 'pending' | 'locked';
}

const ACCOUNT_NUMBER = 'ESA-4923-1209';
const ROUTING_NUMBER = '110000019';

const INITIAL_GOALS: SavingsGoal[] = [
  { id: 'deposit-target', name: '2% Deposit Target', target: 12000, saved: 8450, due: 'Nov 2026' },
  { id: 'closing-costs', name: 'Closing Costs Buffer', target: 4500, saved: 2200, due: 'Jan 2027' },
];

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toShortDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const daysBetween = (from: Date, to: Date) => {
  const diff = to.getTime() - from.getTime();
  return Math.max(Math.floor(diff / 86_400_000), 0);
};

const sanitizeNumericInput = (value: string) => value.replace(/[^0-9.]/g, '');

export default function SavingsHome() {
  const { isConnected } = useAppKitAccount();
  const { cashBalance: portfolioCashBalance } = usePortfolio();
  const cashBalance = portfolioCashBalance?.totalCash ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const { setActionModalOpen } = useGlobalModals();

  const [streakDays, setStreakDays] = useState(11);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [rewardPoints, setRewardPoints] = useState(520);
  const [goals, setGoals] = useState<SavingsGoal[]>(INITIAL_GOALS);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [homePriceInput, setHomePriceInput] = useState('420000');
  const [downPctInput, setDownPctInput] = useState('2');
  const [monthlySaveInput, setMonthlySaveInput] = useState('900');
  const [copiedField, setCopiedField] = useState<'account' | 'routing' | null>(null);

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
  const currentDate = useMemo(() => new Date(), []);

  const savingsBalance = isConnected ? Math.max(cashBalance, 0) : 0;
  const daysOpen = daysBetween(accountOpenedDate, currentDate);
  const daysFromLastDeposit = daysBetween(lastDepositDate, currentDate);

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
  const monthsToDeposit =
    effectiveMonthly > 0 ? Math.ceil(remainingDeposit / effectiveMonthly) : null;
  const projectedDepositDate = useMemo(() => {
    if (!monthsToDeposit) return null;
    const estimate = new Date();
    estimate.setMonth(estimate.getMonth() + monthsToDeposit);
    return estimate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, [monthsToDeposit]);

  const completedGoals = goals.filter((goal) => goal.saved >= goal.target).length;

  const achievements = useMemo<Achievement[]>(
    () => [
      {
        id: 'first-deposit',
        name: 'First Deposit',
        description: 'Fund your Equity Savings Account once.',
        icon: Star,
        unlocked: savingsBalance > 0,
        tier: 'common',
      },
      {
        id: 'streak-7',
        name: 'Week Warrior',
        description: 'Maintain a 7-day savings streak.',
        icon: Flame,
        unlocked: streakDays >= 7,
        tier: 'common',
      },
      {
        id: 'credit-collector',
        name: 'Credit Collector',
        description: 'Reach $1,000 in semi-valid equity credits.',
        icon: Trophy,
        unlocked: semiValidCredits >= 1000,
        tier: 'rare',
      },
      {
        id: 'goal-complete',
        name: 'Goal Getter',
        description: 'Complete one savings goal.',
        icon: Target,
        unlocked: completedGoals > 0,
        tier: 'rare',
      },
      {
        id: 'streak-30',
        name: 'Month Master',
        description: 'Hit a 30-day savings streak.',
        icon: Sparkles,
        unlocked: streakDays >= 30,
        tier: 'epic',
      },
      {
        id: 'elpa-ready',
        name: 'ELPA Ready',
        description: 'Keep account open for 12 months.',
        icon: Home,
        unlocked: daysOpen >= 365,
        tier: 'epic',
      },
    ],
    [completedGoals, daysOpen, savingsBalance, semiValidCredits, streakDays]
  );

  const perks = useMemo<Perk[]>(
    () => [
      {
        id: 'bonus-credits',
        name: 'Bonus Credit Window',
        description: '+5% bonus credits on monthly deposits over $500.',
        requirement: '14-day streak',
        active: streakDays >= 14,
        icon: Gift,
      },
      {
        id: 'advisor',
        name: 'Priority Advisor',
        description: 'Direct access to a savings + ELPA specialist.',
        requirement: '180-day account age',
        active: daysOpen >= 180,
        icon: ShieldCheck,
      },
      {
        id: 'home-preview',
        name: 'Early Home Preview',
        description: 'Preview inventory before ELPA unlock.',
        requirement: '270-day account age',
        active: daysOpen >= 270,
        icon: Home,
      },
    ],
    [daysOpen, streakDays]
  );

  const creditActivity = useMemo<CreditActivityEvent[]>(
    () => [
      {
        id: 'dep-today',
        title: 'Auto-save transfer',
        description: 'Bank transfer to Equity Savings Account.',
        amount: 250,
        date: currentDate,
        type: 'deposit',
        status: 'posted',
      },
      {
        id: 'credit-pending',
        title: '1:1 equity credit',
        description:
          daysUntilPosting > 0
            ? `${daysUntilPosting} days until semi-valid posting.`
            : 'Credit is now semi-valid and posted.',
        amount: 250,
        date: lastDepositDate,
        type: 'credit',
        status: daysUntilPosting > 0 ? 'pending' : 'posted',
      },
      {
        id: 'streak-perk',
        title: 'Savings streak reward',
        description: 'Consistency perk credited to rewards balance.',
        amount: 25,
        date: new Date(currentDate.getTime() - 86_400_000 * 2),
        type: 'perk',
        status: 'posted',
      },
      {
        id: 'elpa-locked',
        title: 'ELPA usability gate',
        description:
          daysUntilElpa > 0
            ? `${daysUntilElpa} days until ELPA usage unlock.`
            : 'Credits are now usable toward ELPA deposit.',
        amount: semiValidCredits,
        date: accountOpenedDate,
        type: 'credit',
        status: daysUntilElpa > 0 ? 'locked' : 'posted',
      },
    ],
    [accountOpenedDate, currentDate, daysUntilElpa, daysUntilPosting, lastDepositDate, semiValidCredits]
  );

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

  const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked).length;
  const activePerks = perks.filter((perk) => perk.active).length;
  const nextStreakMilestone = streakDays < 14 ? 14 : streakDays < 30 ? 30 : 60;
  const daysToMilestone = Math.max(nextStreakMilestone - streakDays, 0);

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
            <Card className="overflow-hidden border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-white to-blue-50/40 dark:from-zinc-900/40 dark:to-blue-950/20">
              <CardHeader className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center">
                      <Landmark className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-medium">Equity Savings Account</CardTitle>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        Depositor-Owned Neobank account
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
                  >
                    1:1 Equity Match
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-5 space-y-5">
                <div>
                  <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <span className="text-xs uppercase tracking-wider font-medium">
                      ELPA Deposit Power
                    </span>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5" />
                      <div className="absolute left-0 top-5 hidden group-hover:block bg-zinc-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                        Savings + ELPA-usable credits
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <h1 className="text-[38px] font-light tracking-tight">
                      <LargePriceWheel value={elpaDepositPower} className="font-light" />
                    </h1>
                    <span className="text-sm text-zinc-500">USD</span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {daysUntilElpa > 0
                      ? `Projected power at 12 months: ${formatCurrency(projectedDepositPower)}`
                      : 'All posted credits are ELPA-usable now.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Savings Balance</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(savingsBalance)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Semi-Valid Credits</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(semiValidCredits)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/30 p-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Pending Credits</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(Math.max(pendingMatchCredits - semiValidCredits, 0))}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-950/30">
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
                        ? `${daysUntilPosting} day${daysUntilPosting === 1 ? '' : 's'} until next credit posts as semi-valid`
                        : 'Credits from the latest deposit are now posted as semi-valid'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-950/30">
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
                        ? `${daysUntilElpa} day${daysUntilElpa === 1 ? '' : 's'} until credits are ELPA-usable`
                        : 'Credits are fully usable toward ELPA deposit requirements'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDepositModalOpen(true)}
                    className="bg-black dark:bg-white text-white dark:text-black px-4 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    Add Savings
                  </button>
                  <button
                    type="button"
                    onClick={() => setWithdrawModalOpen(true)}
                    disabled={!isConnected || savingsBalance === 0}
                    className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-4 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    Withdraw
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-950/30">
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
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-950/30">
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
              </CardContent>
            </Card>

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
                {goals.map((goal) => {
                  const pct = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
                  return (
                    <motion.div
                      key={goal.id}
                      whileHover={{ scale: 1.01 }}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{goal.name}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Target date: {goal.due}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(pct)}%
                        </Badge>
                      </div>
                      <Progress value={pct} className="h-2 mt-3" />
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(goal.saved)} / {formatCurrency(goal.target)}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleTopUpGoal(goal.id, 100)}
                          className="text-xs px-3 py-1 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          +$100
                        </button>
                      </div>
                    </motion.div>
                  );
                })}

                <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-3">
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
                  <Badge variant="outline" className="text-[10px]">
                    1:1 Match Included
                  </Badge>
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
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Required Deposit ({downPct}%)</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(requiredDeposit)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Current Savings + Semi-Valid Credits</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(currentTowardDeposit)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Remaining to Target</p>
                    <p className="text-lg font-medium mt-1">{formatCurrency(remainingDeposit)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Estimated Timeline</p>
                    <p className="text-lg font-medium mt-1">
                      {monthsToDeposit == null ? 'Set monthly amount' : `${monthsToDeposit} months`}
                    </p>
                    {projectedDepositDate && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        Target month: {projectedDepositDate}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Monthly effective contribution is doubled by the 1:1 match once credits post as semi-valid.
                </p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <CardTitle className="text-base font-medium">Credit Activity</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                {creditActivity.map((event) => {
                  const amountPrefix = event.amount >= 0 ? '+' : '';
                  return (
                    <div
                      key={event.id}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/20 flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
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
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{event.description}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{toShortDate(event.date)}</p>
                      </div>
                      <p className="text-sm font-medium">{amountPrefix}{formatCurrency(event.amount)}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-4 space-y-4">
            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <CardTitle className="text-base font-medium">Savings Streak</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-gradient-to-br from-zinc-50 to-amber-50/60 dark:from-zinc-900/30 dark:to-amber-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-medium">{streakDays} day streak</span>
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{rewardPoints} pts</span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                    {daysToMilestone > 0
                      ? `${daysToMilestone} day${daysToMilestone === 1 ? '' : 's'} to ${nextStreakMilestone}-day milestone`
                      : 'Milestone reached'}
                  </p>
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={checkedInToday}
                    className="w-full mt-4 h-9 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkedInToday ? 'Checked in today' : 'Check in & save'}
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Achievements</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {unlockedAchievements}/{achievements.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2">
                  {achievements.map((achievement) => (
                    <div
                      key={achievement.id}
                      className={cn(
                        'rounded-lg border p-3',
                        achievement.unlocked
                          ? 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/30'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10 opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center',
                            achievement.tier === 'common' && 'bg-zinc-200 dark:bg-zinc-800',
                            achievement.tier === 'rare' && 'bg-blue-100 dark:bg-blue-900/40',
                            achievement.tier === 'epic' && 'bg-amber-100 dark:bg-amber-900/40'
                          )}
                        >
                          {achievement.unlocked ? (
                            <achievement.icon className="w-4 h-4" />
                          ) : (
                            <Lock className="w-4 h-4 text-zinc-500" />
                          )}
                        </div>
                      </div>
                      <p className="text-xs font-medium mt-2">{achievement.name}</p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">
                        {achievement.description}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Rewards & Perks</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {activePerks} active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                {perks.map((perk) => (
                  <div
                    key={perk.id}
                    className={cn(
                      'rounded-lg border p-3',
                      perk.active
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/20'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                          <perk.icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{perk.name}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                            {perk.description}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {perk.active ? 'Active' : perk.requirement}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-blue-50 to-emerald-50/60 dark:from-blue-950/20 dark:to-emerald-950/20">
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm font-medium">Stop Renting. Start Owning. Take the CLEAR path.</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  EquityShare is a 2026-first home financing solution. We buy the home you want, you move in,
                  and a portion of every monthly payment builds your real-world equity.
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

      <MobileNav
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />
    </div>
  );
}
