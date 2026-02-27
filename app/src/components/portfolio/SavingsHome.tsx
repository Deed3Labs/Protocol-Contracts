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
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { LargePriceWheel } from '@/components/PriceWheel';
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
  origin?: 'manual' | 'calculator';
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

interface GoalTemplate {
  name: string;
  target: number;
}

interface CalculatorScenario {
  id: 'conservative' | 'balanced' | 'fast-track';
  label: string;
  detail: string;
  homePrice: number;
  downPct: number;
  monthlySave: number;
}

type CalculatorView = 'projection' | 'allocation' | 'timeline';

const ACCOUNT_NUMBER = 'ESA-4923-1209';
const ROUTING_NUMBER = '110000019';
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

const GOAL_TEMPLATES: GoalTemplate[] = [
  { name: 'Move-In Cushion', target: 5000 },
  { name: 'Inspection + Fees', target: 2500 },
  { name: 'Furnishing Fund', target: 3500 },
];

const CALCULATOR_SCENARIOS: CalculatorScenario[] = [
  {
    id: 'conservative',
    label: 'Conservative',
    detail: 'Lower monthly pace',
    homePrice: 350000,
    downPct: 2,
    monthlySave: 650,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Default planning',
    homePrice: 420000,
    downPct: 2,
    monthlySave: 900,
  },
  {
    id: 'fast-track',
    label: 'Fast Track',
    detail: 'Accelerated savings',
    homePrice: 520000,
    downPct: 5,
    monthlySave: 1500,
  },
];

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

const WEEKLY_CONSISTENCY_COLORS = ['#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
const PROJECTION_PROGRESS_COLORS = ['#34d399', '#2dd4bf', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa'];
const GOAL_DISTRIBUTION_CLASSES = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500'];

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDateShort = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const formatPercent = (value: number) =>
  `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;

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

const parseDueMonth = (value: string) => {
  const parsed = new Date(`1 ${value}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getMonthDistance = (from: Date, to: Date) => {
  const total = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(total, 0);
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatSliderCurrency = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return formatCurrency(value);
};

const formatAxisCurrency = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
};

interface CalculatorSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  presets: number[];
  inputPrefix?: string;
  helperText?: string;
}

function CalculatorSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  presets,
  inputPrefix,
  helperText,
}: CalculatorSliderProps) {
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-[#0e0e0e]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
          {helperText && <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{helperText}</p>}
        </div>
        <div className="h-8 px-2 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141414] flex items-center gap-1">
          {inputPrefix && <span className="text-xs text-zinc-500 dark:text-zinc-400">{inputPrefix}</span>}
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? value : ''}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              if (Number.isNaN(nextValue)) return;
              onChange(nextValue);
            }}
            className="w-20 bg-transparent text-right text-xs font-medium outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full h-1.5 appearance-none rounded-full accent-emerald-500 dark:accent-emerald-400 cursor-pointer [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent"
        style={{
          background: `linear-gradient(to right, #10b981 0%, #10b981 ${progress}%, rgba(113,113,122,0.22) ${progress}%, rgba(113,113,122,0.22) 100%)`,
        }}
      />
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
      <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-1">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
              value === preset
                ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            )}
          >
            {formatValue(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const streakTarget = 60;
  const streakProgress = Math.min((currentStreak / streakTarget) * 100, 100);
  const recentDays = weeks.flat().slice(-14);
  const weeklyTotals = weeks.map((week) => week.reduce((sum, day) => sum + (day.saved ? day.amount : 0), 0));
  const savedRecentDays = recentDays.filter((day) => day.saved).length;
  const unlockedMilestones = milestones.filter((milestone) => milestone.achieved).length;
  const nextMilestone = milestones.find((milestone) => !milestone.achieved);
  const daysToNextMilestone = nextMilestone ? Math.max(nextMilestone.month * 30 - accountMonth * 30, 0) : 0;
  const daysToLevelUp = Math.max(streakTarget - currentStreak, 0);
  const streakRingData = [
    { name: 'Active', value: Math.min(currentStreak, streakTarget), color: '#10b981' },
    { name: 'Remaining', value: Math.max(streakTarget - Math.min(currentStreak, streakTarget), 0), color: '#3f3f46' },
  ];
  const weeklyConsistencyData = weeklyTotals.map((total, index) => ({
    label: `W${index + 1}`,
    total,
  }));

  return (
    <section className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141414] p-3">
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
            Savings Streak
          </span>
          <button
            type="button"
            onClick={onCheckIn}
            disabled={checkedInToday}
            className="h-8 px-3 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkedInToday ? 'Checked in' : 'Check in'}
          </button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <div className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative w-24 h-24 shrink-0">
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
                  <Flame className="w-3.5 h-3.5 text-orange-500 mb-0.5" />
                  <span className="text-base font-semibold leading-none">{currentStreak}</span>
                  <span className="text-[9px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mt-0.5">
                    Days
                  </span>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Consistency Level {saverLevel}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {nextMilestone
                    ? `Next: ${nextMilestone.label} in ${daysToNextMilestone} days`
                    : 'All streak milestones unlocked'}
                </p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-2 text-center">
                    <p className="text-sm font-semibold">{bestStreak}</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Best</p>
                  </div>
                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-2 text-center">
                    <p className="text-sm font-semibold">{unlockedMilestones}</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Unlocked</p>
                  </div>
                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-2 text-center">
                    <p className="text-sm font-semibold">{rewardPoints}</p>
                    <p className="text-[9px] text-zinc-500 dark:text-zinc-400">Points</p>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
                    <span>{Math.round(streakProgress)}% to {streakTarget}-day tier</span>
                    <span>{daysToLevelUp} days left</span>
                  </div>
                  <Progress value={streakProgress} className="h-1.5" />
                </div>
              </div>
            </div>
          </div>

          <div className="py-3">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-medium tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Milestone Track
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{unlockedMilestones}/{milestones.length}</p>
            </div>

            <div className="relative">
              <div className="absolute left-4 right-4 top-[14px] h-px bg-zinc-200 dark:bg-zinc-700" />
              <div className="grid grid-cols-5 gap-2">
                {milestones.map((milestone) => (
                  <div key={milestone.month} className="text-center">
                    <div
                      className={cn(
                        'w-7 h-7 mx-auto rounded-full border flex items-center justify-center relative z-10',
                        milestone.achieved
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-zinc-100 dark:bg-[#0e0e0e] border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                      )}
                    >
                      <milestone.icon className="w-3 h-3" />
                    </div>
                    <p className={cn('mt-2 text-[10px] font-medium', milestone.achieved ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400')}>
                      M{milestone.month}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Recent Consistency
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {savedRecentDays}/14 active days
              </p>
            </div>
            <div className="grid grid-cols-14 gap-1 mb-2.5">
              {recentDays.map((day, index) => (
                <div
                  key={`${day.date.toISOString()}-${index}`}
                  className={cn(
                    'h-5 rounded-sm border border-zinc-200/80 dark:border-zinc-800',
                    !day.saved && 'bg-zinc-100 dark:bg-[#141414]'
                  )}
                  style={day.saved ? { backgroundColor: `hsl(var(--equity) / ${0.22 + Math.min(day.amount / 180, 1) * 0.62})` } : undefined}
                  title={day.saved ? `${formatDateShort(day.date)} · $${day.amount}` : `${formatDateShort(day.date)} · no deposit`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Last 14 days</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Less</span>
                <div className="flex gap-0.5">
                  {[0.2, 0.45, 0.7, 0.95].map((opacity) => (
                    <div
                      key={opacity}
                      className="w-2.5 h-2.5 rounded-sm bg-emerald-500"
                      style={{ opacity }}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">More</span>
              </div>
            </div>
            <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-2">
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyConsistencyData} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#71717a', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide domain={[0, 'dataMax + 40']} />
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
                      formatter={(value: number | string | undefined) => [formatCurrency(Number(value ?? 0)), 'Saved']}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {weeklyConsistencyData.map((week, index) => (
                        <Cell
                          key={week.label}
                          fill={WEEKLY_CONSISTENCY_COLORS[index % WEEKLY_CONSISTENCY_COLORS.length]}
                          fillOpacity={0.9}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {weeklyTotals.map((weekTotal, index) => (
                  <p key={index} className="text-[10px] text-zinc-500 dark:text-zinc-400 text-center">
                    W{index + 1}: {formatSliderCurrency(weekTotal)}
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

interface RewardsPerksCardProps {
  achievements: Achievement[];
  perks: Perk[];
}

function RewardsPerksCard({ achievements, perks }: RewardsPerksCardProps) {
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
  const unlockedPerks = perks.filter((perk) => perk.unlocked).length;

  return (
    <section className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141414] p-3">
      <div className="space-y-4">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <div className="pb-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
                Achievements
              </span>
              <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                <Trophy className="w-3 h-3 mr-1" /> {unlockedCount}/{achievements.length}
              </Badge>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {achievements.map((achievement) => (
                <button
                  key={achievement.id}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded border transition-all',
                    achievement.unlocked
                      ? cn(rarityColors[achievement.rarity], rarityGlow[achievement.rarity], 'hover:scale-105')
                      : 'border-dotted border-zinc-300 dark:border-zinc-700 bg-zinc-100/40 dark:bg-[#121212] text-zinc-500 dark:text-zinc-400 opacity-50'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center',
                      achievement.unlocked ? 'bg-current/10' : 'bg-zinc-200 dark:bg-[#0e0e0e]'
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
          </div>

          <div className="pt-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
                Perks & Rewards
              </span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unlockedPerks} active</span>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200/70 dark:border-zinc-800/70">
              {perks.map((perk) => (
                <div
                  key={perk.id}
                  className={cn(
                    'flex items-center gap-3 py-2.5 px-1 rounded-sm border-l-2 transition-colors',
                    perk.unlocked
                      ? 'border-emerald-400/70 hover:bg-emerald-500/5'
                      : 'border-zinc-300/70 dark:border-zinc-700 opacity-65'
                  )}
                >
                  <div
                    className={cn(
                      'w-9 h-9 rounded flex items-center justify-center shrink-0',
                      perk.unlocked
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-200 dark:bg-[#141414] text-zinc-500'
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
          </div>
        </div>
      </div>
    </section>
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
  const [homePrice, setHomePrice] = useState(420000);
  const [downPct, setDownPct] = useState(2);
  const [monthlySave, setMonthlySave] = useState(900);
  const [calculatorScenarioId, setCalculatorScenarioId] =
    useState<CalculatorScenario['id'] | 'custom'>('balanced');
  const [calculatorView, setCalculatorView] = useState<CalculatorView>('projection');
  const [calculatorLinkedGoalId, setCalculatorLinkedGoalId] = useState<string>(
    INITIAL_GOALS[0]?.id ?? ''
  );
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
  const pendingCredits = Math.max(pendingMatchCredits - semiValidCredits, 0);
  const elpaUsableCredits = daysOpen >= 365 ? semiValidCredits : 0;
  const elpaDepositPower = savingsBalance + elpaUsableCredits;

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
  const depositProgressPct = requiredDeposit > 0 ? Math.min((currentTowardDeposit / requiredDeposit) * 100, 100) : 0;
  const monthlyMatchContribution = monthlySave;
  const monthlyTotalContribution = monthlySave + monthlyMatchContribution;
  const activeScenarioLabel =
    calculatorScenarioId === 'custom'
      ? 'Custom'
      : CALCULATOR_SCENARIOS.find((scenario) => scenario.id === calculatorScenarioId)?.label ?? 'Custom';

  const projectionHorizon = useMemo(() => {
    if (monthsToDeposit == null) return 12;
    return clampNumber(monthsToDeposit + 4, 12, 24);
  }, [monthsToDeposit]);

  const projectionSeries = useMemo(
    () =>
      Array.from({ length: projectionHorizon + 1 }, (_, month) => ({
        month,
        monthLabel: month === 0 ? 'Now' : `M${month}`,
        total: currentTowardDeposit + monthlyTotalContribution * month,
      })),
    [currentTowardDeposit, monthlyTotalContribution, projectionHorizon]
  );

  const sixMonthProjection = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const month = index + 1;
        const projectedTotal = currentTowardDeposit + monthlyTotalContribution * month;
        const progressPct = requiredDeposit > 0 ? Math.min((projectedTotal / requiredDeposit) * 100, 100) : 0;
        return { month, projectedTotal, progressPct };
      }),
    [currentTowardDeposit, monthlyTotalContribution, requiredDeposit]
  );

  const towardTarget = Math.min(currentTowardDeposit, requiredDeposit);
  const towardFromSavings = Math.min(savingsBalance, towardTarget);
  const towardFromCredits = Math.max(Math.min(semiValidCredits, towardTarget - towardFromSavings), 0);
  const remainingForTarget = Math.max(requiredDeposit - towardTarget, 0);
  const allocationCompositionData = useMemo(
    () => [
      { name: 'Savings', value: towardFromSavings, color: '#0ea5e9' },
      { name: 'Credits', value: towardFromCredits, color: '#10b981' },
      { name: 'Remaining', value: remainingForTarget, color: '#f59e0b' },
    ],
    [remainingForTarget, towardFromCredits, towardFromSavings]
  );
  const sixMonthProjectionData = useMemo(
    () =>
      sixMonthProjection.map((point) => ({
        monthLabel: `M${point.month}`,
        progressPct: Number(point.progressPct.toFixed(1)),
        projectedTotal: point.projectedTotal,
      })),
    [sixMonthProjection]
  );

  const postingPhaseDays = daysUntilPosting;
  const depositPhaseDays = monthsToDeposit ? monthsToDeposit * 30 : 0;
  const elpaPhaseDays = daysUntilElpa;
  const totalPhaseDays = Math.max(postingPhaseDays + depositPhaseDays + elpaPhaseDays, 1);
  const phaseDurationChartData = [
    {
      name: 'Phase Mix',
      posting: postingPhaseDays,
      deposit: depositPhaseDays,
      elpa: elpaPhaseDays,
    },
  ];

  const calculatorRecommendation = useMemo(() => {
    if (remainingDeposit <= 0) return 'You are deposit-ready now. Next step is selecting an ELPA home and lock date.';
    if (!monthsToDeposit) return 'Set monthly savings to view your projected readiness timeline.';
    if (monthsToDeposit <= 6) return 'Strong pace. Keep your streak active and you can reach your target this year.';
    if (monthsToDeposit <= 12) return 'Good progress. Increasing monthly savings by $200 can pull your date forward.';
    return 'Long runway detected. Consider a higher monthly deposit or a lower initial target home price.';
  }, [monthsToDeposit, remainingDeposit]);

  const totalGoalTarget = goals.reduce((sum, goal) => sum + goal.target, 0);
  const totalGoalSaved = goals.reduce((sum, goal) => sum + goal.saved, 0);
  const goalsProgressPct = totalGoalTarget > 0 ? Math.min((totalGoalSaved / totalGoalTarget) * 100, 100) : 0;
  const completedGoals = goals.filter((goal) => goal.saved >= goal.target).length;
  const totalGoalRemaining = Math.max(totalGoalTarget - totalGoalSaved, 0);

  const goalForecast = useMemo(() => {
    return goals.map((goal) => {
      const progress = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
      const remaining = Math.max(goal.target - goal.saved, 0);
      const dueDate = parseDueMonth(goal.due);
      const monthsUntilDue = dueDate ? Math.max(getMonthDistance(today, dueDate), 1) : null;
      const allocationWeight = totalGoalTarget > 0 ? goal.target / totalGoalTarget : 0;
      const effectiveForGoal = effectiveMonthly * allocationWeight;
      const projectedMonths = remaining > 0 && effectiveForGoal > 0 ? Math.ceil(remaining / effectiveForGoal) : 0;
      const monthlyNeeded = monthsUntilDue && remaining > 0 ? remaining / monthsUntilDue : 0;

      let status: 'complete' | 'on-track' | 'at-risk' = 'on-track';
      if (remaining <= 0) status = 'complete';
      else if (monthsUntilDue && projectedMonths > monthsUntilDue) status = 'at-risk';

      return {
        ...goal,
        progress,
        remaining,
        monthsUntilDue,
        projectedMonths,
        monthlyNeeded,
        status,
      };
    });
  }, [effectiveMonthly, goals, today, totalGoalTarget]);

  const onTrackGoals = goalForecast.filter((goal) => goal.status !== 'at-risk').length;
  const totalMonthlyNeeded = goalForecast.reduce((sum, goal) => sum + goal.monthlyNeeded, 0);
  const linkedGoalForecast = goalForecast.find((goal) => goal.id === calculatorLinkedGoalId) ?? null;
  const linkedGoalProjectedMonths =
    linkedGoalForecast && monthlyTotalContribution > 0
      ? Math.ceil(linkedGoalForecast.remaining / monthlyTotalContribution)
      : null;
  const calculatorToLinkedGoalDelta = linkedGoalForecast ? requiredDeposit - linkedGoalForecast.target : 0;

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
            ? `Posts as maturing credit in ${daysUntilPosting} day${daysUntilPosting === 1 ? '' : 's'}.`
            : 'Credit posted as maturing.',
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

  useEffect(() => {
    if (!calculatorLinkedGoalId && goals.length > 0) {
      setCalculatorLinkedGoalId(goals[0].id);
      return;
    }
    if (calculatorLinkedGoalId && !goals.some((goal) => goal.id === calculatorLinkedGoalId)) {
      setCalculatorLinkedGoalId(goals[0]?.id ?? '');
    }
  }, [calculatorLinkedGoalId, goals]);

  const handleCheckIn = () => {
    if (checkedInToday) return;
    setCheckedInToday(true);
    setStreakDays((prev) => prev + 1);
    setRewardPoints((prev) => prev + 25);
  };

  const applyCalculatorScenario = (scenario: CalculatorScenario) => {
    setHomePrice(scenario.homePrice);
    setDownPct(scenario.downPct);
    setMonthlySave(scenario.monthlySave);
    setCalculatorScenarioId(scenario.id);
  };

  const updateHomePrice = (value: number) => {
    setHomePrice(clampNumber(value, 150000, 1200000));
    setCalculatorScenarioId('custom');
  };

  const updateDownPct = (value: number) => {
    setDownPct(clampNumber(value, 2, 20));
    setCalculatorScenarioId('custom');
  };

  const updateMonthlySave = (value: number) => {
    setMonthlySave(clampNumber(value, 100, 5000));
    setCalculatorScenarioId('custom');
  };

  const handleLinkGoalToCalculator = (goalId: string) => {
    setCalculatorLinkedGoalId(goalId);
    setCalculatorView('projection');
  };

  const handleSyncCalculatorToLinkedGoal = () => {
    if (!calculatorLinkedGoalId) return;
    const nextTarget = Math.max(Math.round(requiredDeposit), 1);
    setGoals((prev) =>
      prev.map((goal) =>
        goal.id === calculatorLinkedGoalId
          ? {
              ...goal,
              target: nextTarget,
              saved: Math.max(goal.saved, Math.min(currentTowardDeposit, nextTarget)),
              due: projectedDepositDate ?? goal.due,
              origin: 'calculator',
            }
          : goal
      )
    );
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
        origin: 'manual',
      },
    ]);
    setNewGoalName('');
    setNewGoalTarget('');
  };

  const handleApplyGoalTemplate = (template: GoalTemplate) => {
    setNewGoalName(template.name);
    setNewGoalTarget(String(template.target));
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
          <div className="md:col-span-8 space-y-10">
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
                  className="bg-zinc-100 dark:bg-[#141414] text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 disabled:opacity-50"
                  disabled={!isConnected || savingsBalance === 0}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  Withdraw
                </button>
              </div>
            </div>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70 pt-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-sm border border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
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

              <div className="space-y-5">
                <div className="flex gap-2 overflow-x-auto pb-1 sm:block sm:overflow-visible sm:pb-0">
                  <div className="min-w-[540px] sm:min-w-0 border-y border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-3">
                    <div className="p-3">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Savings Balance</p>
                      <p className="text-lg font-medium mt-1">{formatCurrency(savingsBalance)}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Maturing Credits</p>
                      <p className="text-lg font-medium mt-1">{formatCurrency(semiValidCredits)}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Pending Credits</p>
                      <p className="text-lg font-medium mt-1">{formatCurrency(pendingCredits)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-3">
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
                        : 'Latest credit is now maturing'}
                    </p>
                  </div>

                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-3">
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

                <div className="divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200/70 dark:border-zinc-800/70 grid grid-cols-1 sm:grid-cols-2">
                  <div className="p-3">
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
                  <div className="p-3">
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
            </section>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-light tracking-tight">Savings Goals</h2>
                    {linkedGoalForecast && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Linked to calculator: {linkedGoalForecast.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {completedGoals}/{goals.length} complete
                    </Badge>
                    {linkedGoalForecast && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                      >
                        Linked
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="pt-4 space-y-4">
                <div className="divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200/70 dark:border-zinc-800/70 grid grid-cols-1 sm:grid-cols-3">
                  <div className="p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total Progress</p>
                    <p className="text-base font-medium mt-1">{Math.round(goalsProgressPct)}%</p>
                    <Progress value={goalsProgressPct} className="h-1.5 mt-2" />
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{formatCurrency(totalGoalRemaining)} remaining</p>
                  </div>
                  <div className="p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">On Track</p>
                    <p className="text-base font-medium mt-1">{onTrackGoals}/{goals.length}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Goals meeting forecast</p>
                  </div>
                  <div className="p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Needed / Month</p>
                    <p className="text-base font-medium mt-1">{formatCurrency(totalMonthlyNeeded)}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">To stay on goal timeline</p>
                  </div>
                </div>

                <div className="border-y border-zinc-200/70 dark:border-zinc-800/70 py-3">
                  <div className="flex items-center justify-between text-[11px] mb-2">
                    <span className="text-zinc-500 dark:text-zinc-400">Goal allocation by size</span>
                    <span className="font-medium">{formatCurrency(totalGoalTarget)}</span>
                  </div>
                  <div className="h-2 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800 flex">
                    {goalForecast.map((goal, index) => (
                      <div
                        key={goal.id}
                        className={GOAL_DISTRIBUTION_CLASSES[index % GOAL_DISTRIBUTION_CLASSES.length]}
                        style={{ width: `${totalGoalTarget > 0 ? (goal.target / totalGoalTarget) * 100 : 0}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {goalForecast.map((goal, index) => (
                      <div key={goal.id} className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full shrink-0',
                              GOAL_DISTRIBUTION_CLASSES[index % GOAL_DISTRIBUTION_CLASSES.length]
                            )}
                          />
                          <span className="truncate">{goal.name}</span>
                        </div>
                        <span>{Math.round(goal.progress)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {goalForecast.map((goal) => (
                  <motion.div
                    key={goal.id}
                    whileHover={{ y: -1.5 }}
                    className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141414] p-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{goal.name}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Target date: {goal.due}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleLinkGoalToCalculator(goal.id)}
                          className={cn(
                            'text-[10px] h-6 px-2.5 rounded-full border transition-colors',
                            calculatorLinkedGoalId === goal.id
                              ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                              : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          )}
                        >
                          {calculatorLinkedGoalId === goal.id ? 'Linked' : 'Link'}
                        </button>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            goal.status === 'complete' &&
                              'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
                            goal.status === 'on-track' &&
                              'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-[#141414]',
                            goal.status === 'at-risk' &&
                              'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10'
                          )}
                        >
                          {goal.status === 'complete' ? 'Complete' : goal.status === 'on-track' ? 'On Track' : 'Attention'}
                        </Badge>
                      </div>
                    </div>

                    <Progress value={goal.progress} className="h-2 mt-2.5" />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-[11px]">
                      <div className="sm:pr-2 sm:border-r sm:border-zinc-200 sm:dark:border-zinc-800">
                        <p className="text-zinc-500 dark:text-zinc-400">Saved / Target</p>
                        <p className="text-sm font-medium mt-1">{formatCurrency(goal.saved)} / {formatCurrency(goal.target)}</p>
                      </div>
                      <div className="sm:px-2 sm:border-r sm:border-zinc-200 sm:dark:border-zinc-800">
                        <p className="text-zinc-500 dark:text-zinc-400">Remaining</p>
                        <p className="text-sm font-medium mt-1">{formatCurrency(goal.remaining)}</p>
                      </div>
                      <div className="sm:pl-2">
                        <p className="text-zinc-500 dark:text-zinc-400">Needed / Month</p>
                        <p className="text-sm font-medium mt-1">{formatCurrency(goal.monthlyNeeded)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {goal.remaining <= 0
                          ? 'Goal reached. Redirect monthly savings to your next target.'
                          : `Projected completion: ${goal.projectedMonths > 0 ? `${goal.projectedMonths} month${goal.projectedMonths === 1 ? '' : 's'}` : 'pending plan'}`}
                      </p>
                      <div className="flex items-center gap-1">
                        {[100, 250, 500].map((amount) => (
                          <button
                            key={amount}
                            type="button"
                            onClick={() => handleTopUpGoal(goal.id, amount)}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            +${amount}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ))}

                <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
                    Create Goal
                  </p>
                  <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 sm:pb-0">
                    {GOAL_TEMPLATES.map((template) => (
                      <button
                        key={template.name}
                        type="button"
                        onClick={() => handleApplyGoalTemplate(template)}
                        className="shrink-0 text-[10px] px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        {template.name} · {formatSliderCurrency(template.target)}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2">
                    <input
                      value={newGoalName}
                      onChange={(event) => setNewGoalName(event.target.value)}
                      placeholder="Goal name"
                      className="h-9 px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0e0e0e] text-sm"
                    />
                    <input
                      value={newGoalTarget}
                      onChange={(event) => setNewGoalTarget(sanitizeNumericInput(event.target.value))}
                      placeholder="Target ($)"
                      className="h-9 px-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0e0e0e] text-sm"
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
              </div>
            </section>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-light tracking-tight">Home Savings Calculator</h2>
                  <Badge variant="outline" className="text-[10px]">1:1 Match Included</Badge>
                </div>
              </div>
              <div className="pt-4 space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Plan Builder</p>
                    <Badge variant="outline" className="text-[10px]">
                      {activeScenarioLabel}
                    </Badge>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:gap-2 sm:overflow-visible sm:pb-0">
                    {CALCULATOR_SCENARIOS.map((scenario) => (
                      <button
                        key={scenario.id}
                        type="button"
                        onClick={() => applyCalculatorScenario(scenario)}
                        className={cn(
                          'shrink-0 min-w-[150px] sm:min-w-0 rounded border p-2.5 text-left transition-colors',
                          calculatorScenarioId === scenario.id
                            ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141414] hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        )}
                      >
                        <p className="text-xs font-medium">{scenario.label}</p>
                        <p className={cn('text-[10px] mt-0.5', calculatorScenarioId === scenario.id ? 'text-white/80 dark:text-zinc-800' : 'text-zinc-500 dark:text-zinc-400')}>
                          {scenario.detail}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-y border-zinc-200/70 dark:border-zinc-800/70 py-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Goal Sync
                    </p>
                    <button
                      type="button"
                      onClick={handleSyncCalculatorToLinkedGoal}
                      disabled={!linkedGoalForecast}
                      className="h-7 px-2.5 rounded-full text-[10px] border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Sync Calculator to Goal
                    </button>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {goalForecast.map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        onClick={() => handleLinkGoalToCalculator(goal.id)}
                        className={cn(
                          'shrink-0 text-[10px] h-7 px-2.5 rounded-full border transition-colors',
                          calculatorLinkedGoalId === goal.id
                            ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                            : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        )}
                      >
                        {goal.name}
                      </button>
                    ))}
                  </div>
                  {linkedGoalForecast && (
                    <div className="rounded bg-zinc-100 dark:bg-[#141414] divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-1 sm:grid-cols-3 mt-2">
                      <div className="p-2">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Linked Goal Target</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(linkedGoalForecast.target)}</p>
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Calculator Deposit Target</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(requiredDeposit)}</p>
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Linked Goal ETA</p>
                        <p className="text-xs font-medium mt-1">
                          {linkedGoalForecast.remaining <= 0
                            ? 'Complete'
                            : linkedGoalProjectedMonths
                              ? `${linkedGoalProjectedMonths} mo`
                              : 'Set monthly pace'}
                        </p>
                      </div>
                    </div>
                  )}
                  {linkedGoalForecast && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
                      {Math.abs(calculatorToLinkedGoalDelta) < 1
                        ? 'Linked goal is aligned with calculator target.'
                        : calculatorToLinkedGoalDelta > 0
                          ? `Linked goal is ${formatCurrency(calculatorToLinkedGoalDelta)} below current calculator target.`
                          : `Linked goal is ${formatCurrency(Math.abs(calculatorToLinkedGoalDelta))} above current calculator target.`}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-3">
                  <div className="space-y-3">
                    <CalculatorSlider
                      label="Home Price"
                      value={homePrice}
                      min={150000}
                      max={1200000}
                      step={5000}
                      onChange={updateHomePrice}
                      formatValue={formatSliderCurrency}
                      presets={[300000, 450000, 650000]}
                      inputPrefix="$"
                      helperText="Target listing price"
                    />
                    <CalculatorSlider
                      label="Deposit %"
                      value={downPct}
                      min={2}
                      max={20}
                      step={0.5}
                      onChange={updateDownPct}
                      formatValue={formatPercent}
                      presets={[2, 5, 10]}
                      helperText="ELPA upfront target"
                    />
                    <CalculatorSlider
                      label="Monthly Savings"
                      value={monthlySave}
                      min={100}
                      max={5000}
                      step={50}
                      onChange={updateMonthlySave}
                      formatValue={formatSliderCurrency}
                      presets={[500, 1000, 1500]}
                      inputPrefix="$"
                      helperText="Recurring monthly deposit"
                    />
                  </div>

                  <div className="rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Projected Deposit Readiness
                        </p>
                        <p className="text-2xl font-light mt-1">
                          {remainingDeposit <= 0 ? 'Ready now' : projectedDepositDate ?? '--'}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {monthsToDeposit == null ? 'Plan Needed' : `${monthsToDeposit} mo`}
                      </Badge>
                    </div>

                    <div className="rounded bg-zinc-100 dark:bg-[#141414] divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-2">
                      <div className="p-2">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Required</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(requiredDeposit)}</p>
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Current</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(currentTowardDeposit)}</p>
                      </div>
                      <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 sm:border-t-0">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Remaining</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(remainingDeposit)}</p>
                      </div>
                      <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 sm:border-t-0">
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Monthly Power</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(monthlyTotalContribution)}</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1 text-zinc-500 dark:text-zinc-400">
                        <span>Progress to target</span>
                        <span>{Math.round(depositProgressPct)}%</span>
                      </div>
                      <Progress value={depositProgressPct} className="h-2" />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{calculatorRecommendation}</p>
                  </div>
                </div>

                <div className="border-y border-zinc-200/70 dark:border-zinc-800/70 py-3">
                  <div className="flex items-center gap-4 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 pb-2">
                    {[
                      { key: 'projection', label: 'Projection' },
                      { key: 'allocation', label: 'Allocation' },
                      { key: 'timeline', label: 'Timeline' },
                    ].map((view) => (
                      <button
                        key={view.key}
                        type="button"
                        onClick={() => setCalculatorView(view.key as CalculatorView)}
                        className={cn(
                          'relative pb-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                          calculatorView === view.key
                            ? 'text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                        )}
                      >
                        {view.label}
                        {calculatorView === view.key && (
                          <span className="absolute left-0 right-0 -bottom-[9px] h-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3">
                    {calculatorView === 'projection' && (
                      <div className="space-y-3">
                        <div className="rounded p-3 bg-zinc-100 dark:bg-[#141414]">
                          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
                            <span>Projected deposit power curve</span>
                            <span>{formatCurrency(monthlyTotalContribution)}/mo effective</span>
                          </div>
                          <div className="h-44">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={projectionSeries} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="savingsProjectionFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.30} />
                                    <stop offset="65%" stopColor="#14b8a6" stopOpacity={0.14} />
                                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.35} vertical={false} />
                                <XAxis
                                  dataKey="monthLabel"
                                  tick={{ fill: '#71717a', fontSize: 10 }}
                                  tickLine={false}
                                  axisLine={false}
                                  interval="preserveStartEnd"
                                />
                                <YAxis
                                  tick={{ fill: '#71717a', fontSize: 10 }}
                                  tickLine={false}
                                  axisLine={false}
                                  width={46}
                                  tickFormatter={(value) => formatAxisCurrency(Number(value))}
                                />
                                <Tooltip
                                  cursor={{ stroke: '#71717a', strokeDasharray: '4 4' }}
                                  contentStyle={{
                                    background: '#18181b',
                                    border: '1px solid #3f3f46',
                                    borderRadius: '8px',
                                    padding: '8px 10px',
                                  }}
                                  labelStyle={{ color: '#a1a1aa', fontSize: 11 }}
                                  itemStyle={{ color: '#e4e4e7', fontSize: 11 }}
                                  formatter={(value: number | string | undefined) => [formatCurrency(Number(value ?? 0)), 'Deposit power']}
                                />
                                <ReferenceLine
                                  y={requiredDeposit}
                                  stroke="#0ea5e9"
                                  strokeDasharray="5 5"
                                  strokeWidth={1.5}
                                />
                                {linkedGoalForecast && Math.abs(linkedGoalForecast.target - requiredDeposit) >= 1 && (
                                  <ReferenceLine
                                    y={linkedGoalForecast.target}
                                    stroke="#f59e0b"
                                    strokeDasharray="3 4"
                                    strokeWidth={1.5}
                                  />
                                )}
                                <Area
                                  type="monotone"
                                  dataKey="total"
                                  stroke="#14b8a6"
                                  strokeWidth={2.25}
                                  fill="url(#savingsProjectionFill)"
                                  dot={false}
                                  activeDot={{ r: 4, fill: '#10b981', stroke: '#ffffff', strokeWidth: 1.25 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                            <span>Now</span>
                            <span>+{projectionHorizon} months</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-0.5 bg-sky-500 rounded-full" />
                              Calculator target
                            </span>
                            {linkedGoalForecast && Math.abs(linkedGoalForecast.target - requiredDeposit) >= 1 && (
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-0.5 bg-amber-500 rounded-full" />
                                Linked goal target
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="rounded bg-zinc-100 dark:bg-[#141414] divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-1 sm:grid-cols-2">
                          <div className="p-2.5">
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Projected in 6 months</p>
                            <p className="text-sm font-medium mt-1">
                              {formatCurrency(sixMonthProjection[5]?.projectedTotal ?? currentTowardDeposit)}
                            </p>
                          </div>
                          <div className="p-2.5">
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">6-month target gap</p>
                            <p className="text-sm font-medium mt-1">
                              {formatCurrency(
                                Math.max(
                                  requiredDeposit -
                                    (sixMonthProjection[5]?.projectedTotal ?? currentTowardDeposit),
                                  0
                                )
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {calculatorView === 'allocation' && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded p-3 bg-zinc-100 dark:bg-[#141414]">
                          <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                            Deposit Composition
                          </p>
                          <div className="flex items-center gap-3">
                            <div className="relative w-28 h-28 shrink-0">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={allocationCompositionData}
                                    dataKey="value"
                                    innerRadius={33}
                                    outerRadius={50}
                                    stroke="none"
                                    startAngle={90}
                                    endAngle={-270}
                                    paddingAngle={1.4}
                                  >
                                    {allocationCompositionData.map((entry) => (
                                      <Cell key={entry.name} fill={entry.color} />
                                    ))}
                                  </Pie>
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-[18px] rounded-full bg-zinc-100 dark:bg-[#141414] flex flex-col items-center justify-center">
                                <span className="text-sm font-semibold">{Math.round(depositProgressPct)}%</span>
                                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Funded</span>
                              </div>
                            </div>
                            <div className="flex-1 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                                  Savings
                                </span>
                                <span className="font-medium">{formatCurrency(towardFromSavings)}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                  Credits
                                </span>
                                <span className="font-medium">{formatCurrency(towardFromCredits)}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                  Remaining
                                </span>
                                <span className="font-medium">{formatCurrency(remainingForTarget)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded p-3 bg-zinc-100 dark:bg-[#141414]">
                          <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                            6-Month Progress Bars
                          </p>
                          <div className="h-32 mt-2">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={sixMonthProjectionData} margin={{ top: 8, right: 4, left: 2, bottom: 0 }} barCategoryGap={9}>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#3f3f46" opacity={0.2} />
                                <XAxis
                                  dataKey="monthLabel"
                                  tick={{ fill: '#71717a', fontSize: 10 }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <YAxis hide domain={[0, 100]} />
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
                                  labelFormatter={(label: string) => {
                                    const point = sixMonthProjectionData.find((entry) => entry.monthLabel === label);
                                    return point ? `${label} · ${formatCurrency(point.projectedTotal)}` : label;
                                  }}
                                  formatter={(value: number | string | undefined) => [`${Math.round(Number(value ?? 0))}%`, 'Target progress']}
                                />
                                <Bar dataKey="progressPct" radius={[4, 4, 0, 0]}>
                                  {sixMonthProjectionData.map((point, index) => (
                                    <Cell
                                      key={point.monthLabel}
                                      fill={PROJECTION_PROGRESS_COLORS[index % PROJECTION_PROGRESS_COLORS.length]}
                                      fillOpacity={0.95}
                                    />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
                            Target {formatCurrency(requiredDeposit)} · current plan reaches
                            {' '}
                            {formatCurrency(sixMonthProjection[5]?.projectedTotal ?? currentTowardDeposit)}
                            {' '}
                            in 6 months.
                          </p>
                        </div>
                      </div>
                    )}

                    {calculatorView === 'timeline' && (
                      <div className="space-y-2.5">
                        {[
                          {
                            key: 'posting',
                            title: '30-day credit posting',
                            progress: postingProgress,
                            detail:
                              daysUntilPosting > 0
                                ? `${daysUntilPosting} day${daysUntilPosting === 1 ? '' : 's'} until latest credit starts maturing`
                                : 'Latest credit is now maturing.',
                          },
                          {
                            key: 'deposit',
                            title: 'Deposit target readiness',
                            progress: depositProgressPct,
                            detail:
                              remainingDeposit <= 0
                                ? 'Deposit target reached.'
                                : monthsToDeposit == null
                                  ? 'Set monthly savings to project readiness.'
                                  : `${monthsToDeposit} month${monthsToDeposit === 1 ? '' : 's'} projected to target.`,
                          },
                          {
                            key: 'elpa',
                            title: '12-month ELPA unlock',
                            progress: elpaProgress,
                            detail:
                              daysUntilElpa > 0
                                ? `${daysUntilElpa} day${daysUntilElpa === 1 ? '' : 's'} until credits are ELPA-usable`
                                : 'ELPA credits available now.',
                          },
                        ].map((item) => (
                          <div
                            key={item.key}
                            className="rounded p-2.5 bg-zinc-100 dark:bg-[#141414]"
                          >
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span>{item.title}</span>
                              <span className="text-zinc-500 dark:text-zinc-400">{Math.round(item.progress)}%</span>
                            </div>
                            <Progress value={item.progress} className="h-1.5" />
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5">{item.detail}</p>
                          </div>
                        ))}

                        <div className="rounded p-2.5 bg-zinc-100 dark:bg-[#141414]">
                          <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                            Phase Duration Mix
                          </p>
                          <div className="h-10 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#0e0e0e] px-1">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={phaseDurationChartData} layout="vertical" margin={{ top: 7, right: 4, left: 4, bottom: 7 }}>
                                <XAxis type="number" hide domain={[0, totalPhaseDays]} />
                                <YAxis type="category" dataKey="name" hide />
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
                                  formatter={(value: number | string | undefined, name: string | undefined) => [
                                    `${Math.round(Number(value ?? 0))} days`,
                                    name ?? 'Phase',
                                  ]}
                                />
                                <Bar dataKey="posting" stackId="phase" fill="#0ea5e9" radius={[4, 0, 0, 4]} />
                                <Bar dataKey="deposit" stackId="phase" fill="#10b981" />
                                <Bar dataKey="elpa" stackId="phase" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                            <div>
                              <p className="font-medium text-zinc-900 dark:text-zinc-100">{postingPhaseDays}d</p>
                              <p>Posting</p>
                            </div>
                            <div>
                              <p className="font-medium text-zinc-900 dark:text-zinc-100">{depositPhaseDays}d</p>
                              <p>Deposit</p>
                            </div>
                            <div>
                              <p className="font-medium text-zinc-900 dark:text-zinc-100">{elpaPhaseDays}d</p>
                              <p>ELPA</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-light tracking-tight">History & Activity</h2>
                  <Badge variant="outline" className="text-[10px]">
                    {filteredActivity.length} items
                  </Badge>
                </div>
              </div>
              <div className="pt-4 space-y-4">
                <div className="flex gap-2 overflow-x-auto pb-1 sm:block sm:overflow-visible sm:pb-0">
                  <div className="min-w-[540px] sm:min-w-0 divide-x divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200/70 dark:border-zinc-800/70 grid grid-cols-3">
                    <div className="p-3">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Deposits</p>
                      <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.deposits)}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Posted Credits</p>
                      <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.postedCredits)}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Locked/Pending</p>
                      <p className="text-sm font-medium mt-1">{formatCurrency(activityTotals.lockedCredits)}</p>
                    </div>
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

                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200/70 dark:border-zinc-800/70">
                  {filteredActivity.map((event) => {
                    const icon =
                      event.type === 'deposit' ? ArrowUpRight : event.type === 'credit' ? Sparkles : Gift;
                    const Icon = icon;
                    return (
                      <div
                        key={event.id}
                        className="p-3 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-zinc-100 dark:bg-[#141414] flex items-center justify-center">
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <p className="text-sm font-medium">{event.title}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                event.status === 'posted' &&
                                  'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:bg-[#0e0e0e]',
                                event.status === 'pending' &&
                                  'border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:bg-[#0e0e0e]',
                                event.status === 'locked' &&
                                  'border-zinc-300 text-zinc-600 bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:bg-[#0e0e0e]'
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
              </div>
            </section>
          </div>

          <div className="md:col-span-4 space-y-8">
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

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70 pt-6">
              <div className="space-y-2 rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 bg-gradient-to-r from-zinc-100/70 to-emerald-50/50 dark:from-[#141414] dark:to-[#0e0e0e] p-4">
                <p className="text-sm font-medium">Stop Renting. Start Owning. Take the CLEAR path.</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  EquityShare is a 2026-first home financing solution. We buy the home you want, you move in, and a
                  portion of every monthly payment builds your real-world equity.
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  EquityShare is facilitated via an Equity-Lease Participation Agreement (ELPA), an asset-backed
                  residency contract. 2% down. No credit trap. 100% Assurance.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
