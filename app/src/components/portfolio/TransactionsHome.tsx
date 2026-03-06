import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  Landmark,
  RefreshCw,
  Repeat,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { usePlaidHistoricalTransactions } from '@/hooks/usePlaidHistoricalTransactions';
import { usePlaidRecentTransactions } from '@/hooks/usePlaidRecentTransactions';
import { useRecurringTransactions } from '@/hooks/useRecurringTransactions';
import { useSpendTransactions } from '@/hooks/useSpendTransactions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { WalletTransaction } from '@/types/transactions';
import type { PlaidRecentTransaction } from '@/utils/apiClient';

const MONTHS_PER_YEAR = 12;
const HISTORY_MONTHS = 8;

type ConsolidatedSource = 'On-chain' | 'Bank recurring' | 'Bank spend';
type ConsolidatedDirection = 'inflow' | 'outflow';
type ConsolidatedCategory =
  | 'deposit'
  | 'withdrawal'
  | 'buy'
  | 'sell'
  | 'mint'
  | 'trade'
  | 'transfer'
  | 'subscription'
  | 'spend'
  | 'income'
  | 'other';
type ConsolidatedStatus = 'completed' | 'pending' | 'failed';

type SourceFilter = 'All' | ConsolidatedSource;
type DirectionFilter = 'All' | 'inflow' | 'outflow';
type DateFilter = '30D' | '90D' | '1Y' | '2Y' | '5Y' | 'All';
type SortFilter = 'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow';
type StatusFilter = 'All' | 'completed' | 'pending' | 'failed';
type ForecastScenario = 'Conservative' | 'Base' | 'Aggressive';
type ForecastHorizon = 10 | 20 | 30;
type InsightTab = 'Cash Flow' | 'Spend Mix' | 'Forecast';

interface ConsolidatedTransaction {
  id: string;
  source: ConsolidatedSource;
  direction: ConsolidatedDirection;
  category: ConsolidatedCategory;
  amount: number;
  signedAmount: number;
  title: string;
  subtitle: string;
  status: ConsolidatedStatus;
  account: string;
  date: Date;
  network?: string;
  searchIndex: string;
}

interface ForecastPoint {
  monthOffset: number;
  value: number;
  historicalValue: number | null;
  projectedValue: number | null;
}

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatCurrencyCompact = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return formatCurrency(value);
};

const USD_DENOMINATED_SYMBOLS = new Set([
  'USD',
  'USDC',
  'USDT',
  'DAI',
  'USDS',
  'FDUSD',
  'TUSD',
  'PYUSD',
  'GUSD',
  'BUSD',
  'LUSD',
  'CLRUSD',
]);

const normalizeTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  return null;
};

const getDateFromTransaction = (tx: WalletTransaction) => {
  const fromTimestamp = normalizeTimestampMs(tx.timestamp);
  if (fromTimestamp != null) return new Date(fromTimestamp);

  const fromDate = normalizeTimestampMs(tx.date);
  if (fromDate != null) return new Date(fromDate);

  // Keep invalid/unknown dates out of recent range filters.
  return new Date(0);
};

const getDateFromPlaidTransaction = (tx: PlaidRecentTransaction) => {
  const fromDate = normalizeTimestampMs(tx.date);
  if (fromDate != null) return new Date(fromDate);

  const fromAuthorizedDate = normalizeTimestampMs(tx.authorized_date);
  if (fromAuthorizedDate != null) return new Date(fromAuthorizedDate);

  return new Date(0);
};

const getWalletAmountUsd = (tx: WalletTransaction) => {
  const txAny = tx as WalletTransaction & { amountUsd?: number | null };
  const amountUsd = Number(txAny.amountUsd);
  if (Number.isFinite(amountUsd) && amountUsd > 0) {
    return Math.abs(amountUsd);
  }

  const amountRaw = Math.abs(Number(tx.amount) || 0);
  const symbol = (tx.assetSymbol || tx.currency || '').toUpperCase();
  if (USD_DENOMINATED_SYMBOLS.has(symbol) || String(tx.currency || '').toUpperCase() === 'USD') {
    return amountRaw;
  }

  return amountRaw;
};

const getPlaidCategory = (tx: PlaidRecentTransaction): ConsolidatedCategory => {
  const categoryText = `${tx.category_primary || ''} ${tx.category_detailed || ''}`.toLowerCase();
  if (tx.direction === 'inflow') {
    if (categoryText.includes('transfer')) return 'transfer';
    if (categoryText.includes('deposit')) return 'deposit';
    return 'income';
  }

  if (categoryText.includes('transfer')) return 'transfer';
  if (
    categoryText.includes('subscription') ||
    categoryText.includes('rent') ||
    categoryText.includes('insurance') ||
    categoryText.includes('utilities')
  ) {
    return 'subscription';
  }
  return 'spend';
};

const getWalletFlowMeta = (type: WalletTransaction['type']) => {
  switch (type) {
    case 'deposit':
      return { direction: 'inflow' as const, category: 'deposit' as const, titlePrefix: 'Deposit' };
    case 'withdraw':
      return { direction: 'outflow' as const, category: 'withdrawal' as const, titlePrefix: 'Withdrawal' };
    case 'buy':
      return { direction: 'outflow' as const, category: 'buy' as const, titlePrefix: 'Buy' };
    case 'sell':
      return { direction: 'inflow' as const, category: 'sell' as const, titlePrefix: 'Sell' };
    case 'mint':
      return { direction: 'inflow' as const, category: 'mint' as const, titlePrefix: 'Mint' };
    case 'trade':
      return { direction: 'outflow' as const, category: 'trade' as const, titlePrefix: 'Trade' };
    case 'transfer':
      return { direction: 'outflow' as const, category: 'transfer' as const, titlePrefix: 'Transfer' };
    default:
      return { direction: 'outflow' as const, category: 'other' as const, titlePrefix: 'Contract' };
  }
};

const toAnnualizedRate = (monthlyRate: number) => Math.pow(1 + monthlyRate, 12) - 1;

const projectFutureValue = (
  startValue: number,
  monthlyGrowthRate: number,
  monthlyNetFlow: number,
  months: number
) => {
  let value = Math.max(startValue, 0);
  for (let month = 1; month <= months; month += 1) {
    value = Math.max(value * (1 + monthlyGrowthRate) + monthlyNetFlow, 0);
  }
  return value;
};

const getSuccessScore = (futureValue: number, targetValue: number) => {
  if (targetValue <= 0) return 0;
  const ratio = futureValue / targetValue;
  return Math.max(5, Math.min(95, ratio * 75));
};

const ForecastTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ForecastPoint | undefined;
  if (!point) return null;

  const yearOffset = point.monthOffset / MONTHS_PER_YEAR;
  const horizonLabel =
    point.monthOffset < 0
      ? `${Math.abs(yearOffset).toFixed(1)}y history`
      : point.monthOffset === 0
        ? 'Today'
        : `${yearOffset.toFixed(1)}y forecast`;

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 backdrop-blur-sm">
      <p className="text-zinc-300 text-xs">{horizonLabel}</p>
      <p className="text-white text-sm font-medium">{formatCurrency(point.value)}</p>
    </div>
  );
};

const InsightTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 backdrop-blur-sm">
      {label != null && <p className="text-zinc-300 text-xs mb-1">{label}</p>}
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="text-xs" style={{ color: entry.color || '#e4e4e7' }}>
          {entry.name || entry.dataKey}: {formatCurrency(Number(entry.value || 0))}
        </p>
      ))}
    </div>
  );
};

const INSIGHT_TAB_LIST: InsightTab[] = ['Cash Flow', 'Spend Mix', 'Forecast'];
const SOURCE_COLORS = ['#3b82f6', '#06b6d4', '#a855f7', '#22c55e'];
const CATEGORY_COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#0ea5e9'];
const DATE_FILTER_OPTIONS: DateFilter[] = ['30D', '90D', '1Y', '2Y', '5Y', 'All'];
const SOURCE_FILTER_OPTIONS: SourceFilter[] = ['All', 'On-chain', 'Bank recurring', 'Bank spend'];
const DIRECTION_FILTER_OPTIONS: DirectionFilter[] = ['All', 'inflow', 'outflow'];
const STATUS_FILTER_OPTIONS: StatusFilter[] = ['All', 'completed', 'pending', 'failed'];
const CATEGORY_FILTER_OPTIONS: Array<ConsolidatedCategory | 'All'> = [
  'All',
  'spend',
  'subscription',
  'transfer',
  'income',
  'deposit',
  'withdrawal',
  'buy',
  'sell',
  'trade',
  'mint',
  'other',
];
const SORT_FILTER_OPTIONS: SortFilter[] = ['Newest', 'Oldest', 'AmountHigh', 'AmountLow'];

const SORT_FILTER_LABELS: Record<SortFilter, string> = {
  Newest: 'Newest',
  Oldest: 'Oldest',
  AmountHigh: 'Highest amount',
  AmountLow: 'Lowest amount',
};

const getYOffsetLabel = (monthOffset: number) => {
  if (monthOffset === 0) return 'Today';
  if (monthOffset < 0) return '';
  if (monthOffset % (MONTHS_PER_YEAR * 5) === 0) return `Y${monthOffset / MONTHS_PER_YEAR}`;
  return '';
};

const getDateFilterLabel = (value: DateFilter) => {
  if (value === '30D') return 'Last 30 days';
  if (value === '90D') return 'Last 90 days';
  if (value === '1Y') return 'Last 1 year';
  if (value === '2Y') return 'Last 2 years';
  if (value === '5Y') return 'Last 5 years';
  return 'All time';
};

const getDateFilterCompactLabel = (value: DateFilter) => {
  if (value === '30D') return '30D';
  if (value === '90D') return '90D';
  if (value === '1Y') return '1Y';
  if (value === '2Y') return '2Y';
  if (value === '5Y') return '5Y';
  return 'All';
};

const getDirectionFilterLabel = (value: DirectionFilter) => {
  if (value === 'All') return 'All';
  return value === 'inflow' ? 'Inflow' : 'Outflow';
};

const getStatusFilterLabel = (value: StatusFilter) => {
  if (value === 'All') return 'All';
  if (value === 'completed') return 'Completed';
  if (value === 'pending') return 'Pending';
  return 'Failed';
};

const getCategoryFilterLabel = (value: ConsolidatedCategory | 'All') => {
  if (value === 'All') return 'All categories';
  if (value === 'buy') return 'Buy';
  if (value === 'sell') return 'Sell';
  if (value === 'mint') return 'Mint';
  if (value === 'trade') return 'Trade';
  if (value === 'spend') return 'Spend';
  if (value === 'income') return 'Income';
  if (value === 'deposit') return 'Deposit';
  if (value === 'withdrawal') return 'Withdrawal';
  if (value === 'subscription') return 'Subscription';
  if (value === 'transfer') return 'Transfer';
  return 'Other';
};

const cycleFilterOption = <T extends string>(options: readonly T[], current: T, direction: 1 | -1): T => {
  if (options.length === 0) return current;
  const currentIndex = options.indexOf(current);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (safeIndex + direction + options.length) % options.length;
  return options[nextIndex];
};

interface FilterCycleControlProps {
  label: string;
  value: string;
  onPrev: () => void;
  onNext: () => void;
}

const FilterCycleControl = ({ label, value, onPrev, onNext }: FilterCycleControlProps) => (
  <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/70 dark:bg-zinc-900/45 p-2">
    <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
    <div className="mt-1.5 grid grid-cols-[30px_minmax(0,1fr)_30px] gap-1.5 items-center">
      <button
        type="button"
        onClick={onPrev}
        className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center justify-center"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white/80 dark:bg-zinc-950/40 px-2 text-[11px] text-zinc-700 dark:text-zinc-200 inline-flex items-center justify-center truncate">
        {value}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center justify-center"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  </div>
);

interface FilterPillProps {
  active: boolean;
  label: string;
  onClick: () => void;
  activeClassName?: string;
}

const FilterPill = ({ active, label, onClick, activeClassName }: FilterPillProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'h-8 rounded-md border px-2 text-[11px] transition-colors inline-flex items-center justify-center whitespace-nowrap',
      active
        ? activeClassName || 'border-blue-300 bg-blue-50/70 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
        : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
    )}
  >
    <span className="truncate">{label}</span>
  </button>
);

export default function TransactionsHome() {
  const { address, isConnected } = useAppKitAccount();
  const {
    transactions: walletTransactions,
    holdings,
    totalBalanceUSD,
    cashBalance,
    bankAccounts,
    refreshAll,
    isLoading: portfolioLoading,
  } = usePortfolio();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('All');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('All');
  const [categoryFilter, setCategoryFilter] = useState<ConsolidatedCategory | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [dateFilter, setDateFilter] = useState<DateFilter>('90D');
  const [sortFilter, setSortFilter] = useState<SortFilter>('Newest');
  const [accountFilter, setAccountFilter] = useState('All');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedFilterTab, setAdvancedFilterTab] = useState<'quick' | 'flow' | 'time' | 'amount'>('quick');
  const [visibleCount, setVisibleCount] = useState(20);

  const [forecastScenario, setForecastScenario] = useState<ForecastScenario>('Base');
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>(20);
  const [insightTab, setInsightTab] = useState<InsightTab>('Cash Flow');

  const needsHistoricalBankData = dateFilter === '1Y' || dateFilter === '2Y' || dateFilter === '5Y' || dateFilter === 'All';

  const hasLinkedBankConnection = Boolean(cashBalance.bankLinked || bankAccounts.length > 0);
  const { inflowStreams, outflowStreams, refresh: refreshRecurring } = useRecurringTransactions(address ?? undefined, {
    enabled: hasLinkedBankConnection,
  });
  const { totalSpent, refresh: refreshSpend } = useSpendTransactions(address ?? undefined, {
    enabled: hasLinkedBankConnection,
  });
  const { transactions: plaidRecentTransactions, refresh: refreshPlaidRecentTransactions } = usePlaidRecentTransactions(
    address ?? undefined,
    {
      enabled: hasLinkedBankConnection,
      limit: 500,
    }
  );
  const {
    transactions: plaidHistoricalTransactions,
    refresh: refreshPlaidHistoricalTransactions,
  } = usePlaidHistoricalTransactions(address ?? undefined, {
    enabled: hasLinkedBankConnection && needsHistoricalBankData,
    limit: 2500,
  });

  const bankTransactions = useMemo(() => {
    if (plaidHistoricalTransactions.length === 0) return plaidRecentTransactions;
    const merged = new Map<string, PlaidRecentTransaction>();
    for (const tx of [...plaidRecentTransactions, ...plaidHistoricalTransactions]) {
      merged.set(`${tx.item_id}:${tx.transaction_id}`, tx);
    }
    return Array.from(merged.values()).sort((a, b) => {
      const timeA = Date.parse(a.date || a.authorized_date || '');
      const timeB = Date.parse(b.date || b.authorized_date || '');
      if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
        return timeB - timeA;
      }
      return b.amount - a.amount;
    });
  }, [plaidHistoricalTransactions, plaidRecentTransactions]);

  const { setActionModalOpen } = useGlobalModals();

  useEffect(() => {
    const onScroll = () => setIsScrolledPast(window.scrollY > 80);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const holdingsTotal = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.balanceUSD || 0), 0),
    [holdings]
  );

  const totalAccountValue = useMemo(() => {
    if (!isConnected) return 0;
    return totalBalanceUSD + holdingsTotal;
  }, [holdingsTotal, isConnected, totalBalanceUSD]);

  const recurringInflowMonthly = useMemo(
    () => inflowStreams.reduce((sum, stream) => sum + Math.abs(stream.amount || 0), 0),
    [inflowStreams]
  );

  const recurringOutflowMonthly = useMemo(
    () => outflowStreams.reduce((sum, stream) => sum + Math.abs(stream.amount || 0), 0),
    [outflowStreams]
  );

  const projectedMonthlySpend = useMemo(() => {
    const now = new Date();
    const daysElapsed = Math.max(now.getDate(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (totalSpent <= 0) return 0;
    return (totalSpent / daysElapsed) * daysInMonth;
  }, [totalSpent]);

  const totalInflowFromBanks = recurringInflowMonthly;
  const totalOutflowFromBanks = recurringOutflowMonthly + projectedMonthlySpend;
  const monthlyNetFlow = totalInflowFromBanks - totalOutflowFromBanks;

  const baseMonthlyGrowthRate = useMemo(() => {
    const positiveHoldings = holdings.filter((holding) => holding.balanceUSD > 0);
    const total = positiveHoldings.reduce((sum, holding) => sum + holding.balanceUSD, 0);

    if (total <= 0) return 0.004;

    const weightedMonthlyRate = positiveHoldings.reduce((sum, holding) => {
      const weight = holding.balanceUSD / total;
      const annualRate =
        holding.type === 'equity'
          ? 0.08
          : holding.type === 'token'
            ? 0.12
            : holding.type === 'rwa'
              ? 0.055
              : 0.035;
      const monthlyRate = Math.pow(1 + annualRate, 1 / MONTHS_PER_YEAR) - 1;
      return sum + weight * monthlyRate;
    }, 0);

    return weightedMonthlyRate;
  }, [holdings]);

  const adjustedForecastInputs = useMemo(() => {
    const scenarioGrowthMultiplier =
      forecastScenario === 'Conservative' ? 0.7 : forecastScenario === 'Aggressive' ? 1.25 : 1;
    const scenarioFlowMultiplier =
      forecastScenario === 'Conservative' ? 0.9 : forecastScenario === 'Aggressive' ? 1.15 : 1;

    return {
      monthlyGrowthRate: baseMonthlyGrowthRate * scenarioGrowthMultiplier,
      netFlow: monthlyNetFlow * scenarioFlowMultiplier,
    };
  }, [baseMonthlyGrowthRate, forecastScenario, monthlyNetFlow]);

  const forecastData = useMemo<ForecastPoint[]>(() => {
    const horizonMonths = forecastHorizon * MONTHS_PER_YEAR;
    const points: ForecastPoint[] = [];

    let reverseValue = Math.max(totalAccountValue, 0);
    const factor = Math.max(1 + adjustedForecastInputs.monthlyGrowthRate, 0.0001);

    for (let i = HISTORY_MONTHS; i >= 1; i -= 1) {
      reverseValue = Math.max((reverseValue - adjustedForecastInputs.netFlow) / factor, 0);
      points.push({
        monthOffset: -i,
        value: reverseValue,
        historicalValue: reverseValue,
        projectedValue: null,
      });
    }

    let projected = Math.max(totalAccountValue, 0);
    points.push({
      monthOffset: 0,
      value: projected,
      historicalValue: projected,
      projectedValue: projected,
    });

    for (let month = 1; month <= horizonMonths; month += 1) {
      projected = Math.max(
        projected * (1 + adjustedForecastInputs.monthlyGrowthRate) + adjustedForecastInputs.netFlow,
        0
      );
      points.push({
        monthOffset: month,
        value: projected,
        historicalValue: null,
        projectedValue: projected,
      });
    }

    return points;
  }, [adjustedForecastInputs.monthlyGrowthRate, adjustedForecastInputs.netFlow, forecastHorizon, totalAccountValue]);

  const forecastEndValue = useMemo(() => {
    const finalPoint = forecastData[forecastData.length - 1];
    return finalPoint?.value ?? totalAccountValue;
  }, [forecastData, totalAccountValue]);

  const forecastDelta = forecastEndValue - totalAccountValue;
  const forecastDeltaPercent = totalAccountValue > 0 ? (forecastDelta / totalAccountValue) * 100 : 0;
  const baselineForecastEndValue = useMemo(
    () =>
      projectFutureValue(
        totalAccountValue,
        baseMonthlyGrowthRate,
        monthlyNetFlow,
        forecastHorizon * MONTHS_PER_YEAR
      ),
    [baseMonthlyGrowthRate, forecastHorizon, monthlyNetFlow, totalAccountValue]
  );
  const forecastTargetValue = useMemo(
    () => Math.max(Math.max(totalAccountValue, forecastEndValue, baselineForecastEndValue, 1) * 1.1, 100),
    [baselineForecastEndValue, forecastEndValue, totalAccountValue]
  );
  const baselineSuccessScore = useMemo(
    () => getSuccessScore(baselineForecastEndValue, forecastTargetValue),
    [baselineForecastEndValue, forecastTargetValue]
  );
  const changedSuccessScore = useMemo(
    () => getSuccessScore(forecastEndValue, forecastTargetValue),
    [forecastEndValue, forecastTargetValue]
  );
  const baselineYearlyCashFlow = monthlyNetFlow * MONTHS_PER_YEAR;
  const changedYearlyCashFlow = adjustedForecastInputs.netFlow * MONTHS_PER_YEAR;

  const xAxisTicks = useMemo(() => {
    const ticks = [-HISTORY_MONTHS, 0];
    for (let year = 5; year <= forecastHorizon; year += 5) {
      ticks.push(year * MONTHS_PER_YEAR);
    }
    return ticks;
  }, [forecastHorizon]);

  const milestoneOffsets = useMemo(() => {
    const offsets = [5 * MONTHS_PER_YEAR, 12 * MONTHS_PER_YEAR, forecastHorizon * MONTHS_PER_YEAR];
    return Array.from(new Set(offsets.filter((offset) => offset > 0 && offset <= forecastHorizon * MONTHS_PER_YEAR))).sort(
      (a, b) => a - b
    );
  }, [forecastHorizon]);

  const milestoneLabels = useMemo(() => {
    const map = new Map<number, string>();
    map.set(5 * MONTHS_PER_YEAR, 'Home target');
    map.set(12 * MONTHS_PER_YEAR, 'Long-term wealth');
    map.set(forecastHorizon * MONTHS_PER_YEAR, `Year ${forecastHorizon}`);
    return map;
  }, [forecastHorizon]);

  const consolidatedTransactions = useMemo<ConsolidatedTransaction[]>(() => {
    const walletEntries: ConsolidatedTransaction[] = walletTransactions.map((tx) => {
      const flowMeta = getWalletFlowMeta(tx.type);
      const rawAmount = Math.abs(Number(tx.amount) || 0);
      const amountAbs = getWalletAmountUsd(tx);
      const signedAmount = flowMeta.direction === 'inflow' ? amountAbs : -amountAbs;
      const date = getDateFromTransaction(tx);
      const network = tx.chainName;
      const title = `${flowMeta.titlePrefix} ${tx.assetSymbol || tx.currency}`;
      const subtitle = [
        tx.assetName || tx.currency || 'On-chain transaction',
        amountAbs !== rawAmount && rawAmount > 0
          ? `${rawAmount.toLocaleString('en-US', {
              maximumFractionDigits: 6,
            })} ${tx.assetSymbol || tx.currency}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const account = network || 'Wallet activity';

      const searchIndex = [
        title,
        subtitle,
        account,
        tx.currency,
        tx.assetSymbol,
        network,
        tx.hash,
        flowMeta.category,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return {
        id: `wallet-${tx.id}`,
        source: 'On-chain' as const,
        direction: flowMeta.direction,
        category: flowMeta.category,
        amount: amountAbs,
        signedAmount,
        title,
        subtitle,
        status: tx.status,
        account,
        date,
        network,
        searchIndex,
      };
    });

    const plaidEntries: ConsolidatedTransaction[] = [];
    for (const tx of bankTransactions) {
      const amount = Math.abs(Number(tx.amount) || 0);
      if (!(amount > 0)) continue;

      const direction = tx.direction;
      const date = getDateFromPlaidTransaction(tx);
      const category = getPlaidCategory(tx);
      const title = tx.merchant_name || tx.name || 'Bank transaction';
      const subtitle = [tx.category_detailed || tx.category_primary || 'Plaid transaction', tx.payment_channel]
        .filter(Boolean)
        .join(' · ');
      const account = tx.account_name || 'Connected bank account';
      const status: ConsolidatedStatus = tx.pending ? 'pending' : 'completed';
      const searchIndex = [
        title,
        subtitle,
        account,
        tx.merchant_name,
        tx.category_primary,
        tx.category_detailed,
        tx.iso_currency_code,
        tx.unofficial_currency_code,
        'bank',
        'plaid',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      plaidEntries.push({
        id: `plaid-${tx.item_id}-${tx.transaction_id}`,
        source: 'Bank spend',
        direction,
        category,
        amount,
        signedAmount: direction === 'inflow' ? amount : -amount,
        title,
        subtitle,
        status,
        account,
        date,
        searchIndex,
      });
    }

    return [...walletEntries, ...plaidEntries];
  }, [bankTransactions, walletTransactions]);

  const accountOptions = useMemo(() => {
    const uniqueAccounts = new Set(consolidatedTransactions.map((tx) => tx.account));
    return ['All', ...Array.from(uniqueAccounts).sort((a, b) => a.localeCompare(b))];
  }, [consolidatedTransactions]);

  const amountRangeUpperBound = useMemo(() => {
    const largestAmount = consolidatedTransactions.reduce(
      (max, transaction) => Math.max(max, transaction.amount),
      0
    );
    if (largestAmount <= 0) return 1000;
    return Math.max(1000, Math.ceil(largestAmount / 250) * 250);
  }, [consolidatedTransactions]);

  const amountMinSliderValue = useMemo(() => {
    const parsed = Number(amountMin);
    if (amountMin.trim() === '' || !Number.isFinite(parsed)) return 0;
    return Math.min(Math.max(parsed, 0), amountRangeUpperBound);
  }, [amountMin, amountRangeUpperBound]);

  const amountMaxSliderValue = useMemo(() => {
    const parsed = Number(amountMax);
    const fallback = amountRangeUpperBound;
    const normalized = amountMax.trim() === '' || !Number.isFinite(parsed) ? fallback : parsed;
    return Math.min(Math.max(normalized, amountMinSliderValue), amountRangeUpperBound);
  }, [amountMax, amountMinSliderValue, amountRangeUpperBound]);

  const dateFilterIndex = useMemo(
    () => Math.max(DATE_FILTER_OPTIONS.indexOf(dateFilter), 0),
    [dateFilter]
  );

  const applyAmountPreset = (preset: 'any' | 'under1k' | '1kTo5k' | '5kPlus') => {
    if (preset === 'any') {
      setAmountMin('');
      setAmountMax('');
      return;
    }

    if (preset === 'under1k') {
      setAmountMin('');
      setAmountMax(String(Math.min(1000, amountRangeUpperBound)));
      return;
    }

    if (preset === '1kTo5k') {
      const min = Math.min(1000, amountRangeUpperBound);
      const max = Math.min(Math.max(5000, min), amountRangeUpperBound);
      setAmountMin(String(min));
      setAmountMax(max >= amountRangeUpperBound ? '' : String(max));
      return;
    }

    const min = Math.min(5000, amountRangeUpperBound);
    setAmountMin(String(min));
    setAmountMax('');
  };

  const filteredTransactions = useMemo(() => {
    let list = [...consolidatedTransactions];

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((tx) => tx.searchIndex.includes(query));
    }

    if (sourceFilter !== 'All') {
      list = list.filter((tx) => tx.source === sourceFilter);
    }

    if (directionFilter !== 'All') {
      list = list.filter((tx) => tx.direction === directionFilter);
    }

    if (categoryFilter !== 'All') {
      list = list.filter((tx) => tx.category === categoryFilter);
    }

    if (statusFilter !== 'All') {
      list = list.filter((tx) => tx.status === statusFilter);
    }

    if (accountFilter !== 'All') {
      list = list.filter((tx) => tx.account === accountFilter);
    }

    if (dateFilter !== 'All') {
      const now = Date.now();
      const ageMs =
        dateFilter === '30D'
          ? 30 * 24 * 60 * 60 * 1000
          : dateFilter === '90D'
            ? 90 * 24 * 60 * 60 * 1000
            : dateFilter === '1Y'
              ? 365 * 24 * 60 * 60 * 1000
              : dateFilter === '2Y'
                ? 730 * 24 * 60 * 60 * 1000
                : 1825 * 24 * 60 * 60 * 1000;
      list = list.filter((tx) => now - tx.date.getTime() <= ageMs);
    }

    const minAmount = Number(amountMin);
    if (amountMin.trim() !== '' && Number.isFinite(minAmount)) {
      list = list.filter((tx) => tx.amount >= minAmount);
    }

    const maxAmount = Number(amountMax);
    if (amountMax.trim() !== '' && Number.isFinite(maxAmount)) {
      list = list.filter((tx) => tx.amount <= maxAmount);
    }

    list.sort((a, b) => {
      if (sortFilter === 'Oldest') return a.date.getTime() - b.date.getTime();
      if (sortFilter === 'AmountHigh') return b.amount - a.amount;
      if (sortFilter === 'AmountLow') return a.amount - b.amount;
      return b.date.getTime() - a.date.getTime();
    });

    return list;
  }, [
    accountFilter,
    amountMax,
    amountMin,
    categoryFilter,
    consolidatedTransactions,
    dateFilter,
    directionFilter,
    searchQuery,
    sortFilter,
    sourceFilter,
    statusFilter,
  ]);

  const displayedTransactions = useMemo(
    () => filteredTransactions.slice(0, visibleCount),
    [filteredTransactions, visibleCount]
  );

  useEffect(() => {
    setVisibleCount(20);
  }, [
    accountFilter,
    amountMax,
    amountMin,
    categoryFilter,
    dateFilter,
    directionFilter,
    searchQuery,
    sortFilter,
    sourceFilter,
    statusFilter,
  ]);

  const filteredInflowTotal = useMemo(
    () => filteredTransactions.filter((tx) => tx.direction === 'inflow').reduce((sum, tx) => sum + tx.amount, 0),
    [filteredTransactions]
  );

  const filteredOutflowTotal = useMemo(
    () => filteredTransactions.filter((tx) => tx.direction === 'outflow').reduce((sum, tx) => sum + tx.amount, 0),
    [filteredTransactions]
  );
  const outflowPressurePercent = useMemo(() => {
    const totalFlow = filteredInflowTotal + filteredOutflowTotal;
    if (totalFlow <= 0) return 0;
    return (filteredOutflowTotal / totalFlow) * 100;
  }, [filteredInflowTotal, filteredOutflowTotal]);

  const handleRefreshData = async () => {
    const refreshTasks: Array<Promise<unknown>> = [refreshAll()];
    if (hasLinkedBankConnection) {
      refreshTasks.push(refreshRecurring(), refreshSpend(), refreshPlaidRecentTransactions());
      if (needsHistoricalBankData) {
        refreshTasks.push(refreshPlaidHistoricalTransactions());
      }
    }
    await Promise.all(refreshTasks);
  };

  const applyQuickFocus = (focus: 'all' | 'inflow' | 'outflow' | 'pending' | 'failed') => {
    if (focus === 'all') {
      setDirectionFilter('All');
      setStatusFilter('All');
      return;
    }

    if (focus === 'inflow') {
      setDirectionFilter('inflow');
      setStatusFilter('All');
      return;
    }

    if (focus === 'outflow') {
      setDirectionFilter('outflow');
      setStatusFilter('All');
      return;
    }

    if (focus === 'pending') {
      setDirectionFilter('All');
      setStatusFilter('pending');
      return;
    }

    setDirectionFilter('All');
    setStatusFilter('failed');
  };

  const resetFilters = () => {
    setSourceFilter('All');
    setDirectionFilter('All');
    setCategoryFilter('All');
    setStatusFilter('All');
    setDateFilter('90D');
    setSortFilter('Newest');
    setAccountFilter('All');
    setAmountMin('');
    setAmountMax('');
  };

  const activeFilterLabels = useMemo(() => {
    const labels: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (sourceFilter !== 'All') labels.push({ key: 'source', label: `Source: ${sourceFilter}`, onClear: () => setSourceFilter('All') });
    if (directionFilter !== 'All') labels.push({ key: 'direction', label: `Direction: ${directionFilter}`, onClear: () => setDirectionFilter('All') });
    if (categoryFilter !== 'All') labels.push({ key: 'category', label: `Category: ${categoryFilter}`, onClear: () => setCategoryFilter('All') });
    if (statusFilter !== 'All') labels.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => setStatusFilter('All') });
    if (dateFilter !== '90D') labels.push({ key: 'date', label: `Date: ${getDateFilterLabel(dateFilter)}`, onClear: () => setDateFilter('90D') });
    if (sortFilter !== 'Newest') labels.push({ key: 'sort', label: `Sort: ${sortFilter}`, onClear: () => setSortFilter('Newest') });
    if (accountFilter !== 'All') labels.push({ key: 'account', label: `Account: ${accountFilter}`, onClear: () => setAccountFilter('All') });
    if (amountMin.trim() !== '') labels.push({ key: 'amountMin', label: `Min: $${amountMin}`, onClear: () => setAmountMin('') });
    if (amountMax.trim() !== '') labels.push({ key: 'amountMax', label: `Max: $${amountMax}`, onClear: () => setAmountMax('') });
    return labels;
  }, [accountFilter, amountMax, amountMin, categoryFilter, dateFilter, directionFilter, sortFilter, sourceFilter, statusFilter]);

  const monthlyFlowData = useMemo(() => {
    const now = new Date();
    const monthsBack = 8;
    const points = Array.from({ length: monthsBack }, (_, index) => {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1 - index), 1);
      return {
        key: `${monthDate.getFullYear()}-${monthDate.getMonth()}`,
        label: monthDate.toLocaleDateString('en-US', { month: 'short' }),
        inflow: 0,
        outflow: 0,
        net: 0,
      };
    });

    const map = new Map(points.map((point) => [point.key, point]));
    const nowMs = now.getTime();

    consolidatedTransactions.forEach((transaction) => {
      const txDate = transaction.date;
      if (txDate.getTime() > nowMs) return;
      const key = `${txDate.getFullYear()}-${txDate.getMonth()}`;
      const point = map.get(key);
      if (!point) return;
      if (transaction.direction === 'inflow') point.inflow += transaction.amount;
      if (transaction.direction === 'outflow') point.outflow += transaction.amount;
    });

    return points.map((point) => ({
      ...point,
      net: point.inflow - point.outflow,
    }));
  }, [consolidatedTransactions]);

  const currentMonthFlow = useMemo(() => {
    const current = monthlyFlowData[monthlyFlowData.length - 1];
    return current ?? { inflow: 0, outflow: 0, net: 0 };
  }, [monthlyFlowData]);

  const sourceBreakdownData = useMemo(() => {
    const buckets = new Map<ConsolidatedSource, number>();
    filteredTransactions.forEach((transaction) => {
      const current = buckets.get(transaction.source) || 0;
      buckets.set(transaction.source, current + transaction.amount);
    });

    return Array.from(buckets.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTransactions]);
  const sourceBreakdownTotal = useMemo(
    () => sourceBreakdownData.reduce((sum, item) => sum + item.value, 0),
    [sourceBreakdownData]
  );

  const outflowCategoryData = useMemo(() => {
    const buckets = new Map<ConsolidatedCategory, number>();
    filteredTransactions.forEach((transaction) => {
      if (transaction.direction !== 'outflow') return;
      const current = buckets.get(transaction.category) || 0;
      buckets.set(transaction.category, current + transaction.amount);
    });

    return Array.from(buckets.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredTransactions]);
  const outflowCategoryTotal = useMemo(
    () => outflowCategoryData.reduce((sum, item) => sum + item.value, 0),
    [outflowCategoryData]
  );

  const weekdayOutflowData = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const values = labels.map((label) => ({ label, value: 0 }));
    filteredTransactions.forEach((transaction) => {
      if (transaction.direction !== 'outflow') return;
      const day = transaction.date.getDay();
      values[day].value += transaction.amount;
    });
    return values;
  }, [filteredTransactions]);

  const pendingTransactionCount = useMemo(
    () => consolidatedTransactions.filter((transaction) => transaction.status === 'pending').length,
    [consolidatedTransactions]
  );

  const filteredCompletedCount = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.status === 'completed').length,
    [filteredTransactions]
  );

  const filteredPendingCount = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.status === 'pending').length,
    [filteredTransactions]
  );

  const filteredFailedCount = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.status === 'failed').length,
    [filteredTransactions]
  );

  const averageOutflowTicket = useMemo(() => {
    const outflows = filteredTransactions.filter((transaction) => transaction.direction === 'outflow');
    if (outflows.length === 0) return 0;
    const total = outflows.reduce((sum, transaction) => sum + transaction.amount, 0);
    return total / outflows.length;
  }, [filteredTransactions]);

  const largestOutflowTransaction = useMemo(() => {
    const outflows = filteredTransactions.filter((transaction) => transaction.direction === 'outflow');
    if (outflows.length === 0) return null;
    return [...outflows].sort((a, b) => b.amount - a.amount)[0];
  }, [filteredTransactions]);

  const dailyFlowPulseData = useMemo(() => {
    const now = new Date();
    const days = 14;
    const points = Array.from({ length: days }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index));
      return {
        key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        inflow: 0,
        outflow: 0,
        net: 0,
      };
    });

    const map = new Map(points.map((point) => [point.key, point]));

    filteredTransactions.forEach((transaction) => {
      const txDate = transaction.date;
      const key = `${txDate.getFullYear()}-${txDate.getMonth()}-${txDate.getDate()}`;
      const point = map.get(key);
      if (!point) return;
      if (transaction.direction === 'inflow') point.inflow += transaction.amount;
      if (transaction.direction === 'outflow') point.outflow += transaction.amount;
    });

    return points.map((point) => ({
      ...point,
      net: point.inflow - point.outflow,
    }));
  }, [filteredTransactions]);

  const upcomingPendingTransactions = useMemo(() => {
    const now = Date.now();
    return [...consolidatedTransactions]
      .filter((transaction) => transaction.status === 'pending')
      .sort((a, b) => {
        const aDistance = Math.abs(a.date.getTime() - now);
        const bDistance = Math.abs(b.date.getTime() - now);
        return aDistance - bDistance;
      })
      .slice(0, 5);
  }, [consolidatedTransactions]);

  const sourceVolumeData = useMemo(() => {
    const buckets = new Map<ConsolidatedSource, { count: number; amount: number }>();
    filteredTransactions.forEach((transaction) => {
      const current = buckets.get(transaction.source) ?? { count: 0, amount: 0 };
      buckets.set(transaction.source, {
        count: current.count + 1,
        amount: current.amount + transaction.amount,
      });
    });

    return Array.from(buckets.entries())
      .map(([source, value]) => ({ source, ...value }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  const accountFlowFocus = useMemo(() => {
    const buckets = new Map<string, { inflow: number; outflow: number; count: number }>();
    filteredTransactions.forEach((transaction) => {
      const current = buckets.get(transaction.account) ?? { inflow: 0, outflow: 0, count: 0 };
      if (transaction.direction === 'inflow') current.inflow += transaction.amount;
      if (transaction.direction === 'outflow') current.outflow += transaction.amount;
      current.count += 1;
      buckets.set(transaction.account, current);
    });
    return buckets;
  }, [filteredTransactions]);

  const totalLinkedAccountBalance = useMemo(
    () =>
      bankAccounts.reduce((sum, account) => {
        const balance =
          typeof account.available === 'number' && !Number.isNaN(account.available)
            ? account.available
            : account.current ?? 0;
        return sum + balance;
      }, 0),
    [bankAccounts]
  );

  const linkedAccountFocusData = useMemo(
    () =>
      bankAccounts.slice(0, 4).map((account) => {
        const balance =
          typeof account.available === 'number' && !Number.isNaN(account.available)
            ? account.available
            : account.current ?? 0;
        const name = account.name || 'Account';
        const flow = accountFlowFocus.get(name) ?? { inflow: 0, outflow: 0, count: 0 };

        return {
          id: account.account_id,
          name,
          subtype: account.subtype || account.type || 'Bank account',
          balance,
          inflow: flow.inflow,
          outflow: flow.outflow,
          count: flow.count,
          net: flow.inflow - flow.outflow,
        };
      }),
    [accountFlowFocus, bankAccounts]
  );

  const categoryFocusData = useMemo(
    () =>
      outflowCategoryData.slice(0, 4).map((category, index) => ({
        ...category,
        pct: outflowCategoryTotal > 0 ? (category.value / outflowCategoryTotal) * 100 : 0,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      })),
    [outflowCategoryData, outflowCategoryTotal]
  );

  const quickFocusCounts = useMemo(
    () => ({
      all: consolidatedTransactions.length,
      inflow: consolidatedTransactions.filter((transaction) => transaction.direction === 'inflow').length,
      outflow: consolidatedTransactions.filter((transaction) => transaction.direction === 'outflow').length,
      pending: consolidatedTransactions.filter((transaction) => transaction.status === 'pending').length,
      failed: consolidatedTransactions.filter((transaction) => transaction.status === 'failed').length,
    }),
    [consolidatedTransactions]
  );

  const recurringSchedule = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDate();
    const items = [
      ...inflowStreams.map((stream) => ({
        id: `in-${stream.stream_id}`,
        name: stream.name,
        day: stream.day,
        amount: Math.abs(stream.amount || 0),
        direction: 'inflow' as const,
      })),
      ...outflowStreams.map((stream) => ({
        id: `out-${stream.stream_id}`,
        name: stream.name,
        day: stream.day,
        amount: Math.abs(stream.amount || 0),
        direction: 'outflow' as const,
      })),
    ];

    return items
      .sort((a, b) => {
        const aOffset = a.day >= currentDay ? a.day - currentDay : 31 - currentDay + a.day;
        const bOffset = b.day >= currentDay ? b.day - currentDay : 31 - currentDay + b.day;
        return aOffset - bOffset;
      })
      .slice(0, 6);
  }, [inflowStreams, outflowStreams]);

  const recurringNetMonthly = recurringInflowMonthly - recurringOutflowMonthly;

  const netFlow14d = useMemo(
    () => dailyFlowPulseData.reduce((sum, point) => sum + point.net, 0),
    [dailyFlowPulseData]
  );

  const annualizedGrowthRate = toAnnualizedRate(adjustedForecastInputs.monthlyGrowthRate);
  const forecastCagr = useMemo(() => {
    if (totalAccountValue <= 0 || forecastEndValue <= 0 || forecastHorizon <= 0) return 0;
    return (Math.pow(forecastEndValue / totalAccountValue, 1 / forecastHorizon) - 1) * 100;
  }, [forecastEndValue, forecastHorizon, totalAccountValue]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans pb-20 md:pb-0 transition-colors duration-200">
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <HeaderNav
        isScrolledPast={isScrolledPast}
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />

      <main className="pt-24 pb-28 container mx-auto md:pt-32">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
          <div className="md:col-span-8 space-y-8">
            <section className="space-y-3 pt-3">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                <span className="text-sm font-medium">Consolidated cash flow</span>
                <div className="group relative">
                  <Info className="w-4 h-4 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    Monthly inflow and outflow across linked accounts.
                  </div>
                </div>
                <span
                  className={cn(
                    'ml-auto text-[10px] px-2 py-0.5 rounded-full border',
                    monthlyNetFlow >= 0
                      ? 'text-emerald-700 border-emerald-300 dark:text-emerald-300 dark:border-emerald-800'
                      : 'text-rose-700 border-rose-300 dark:text-rose-300 dark:border-rose-800'
                  )}
                >
                  {monthlyNetFlow >= 0 ? 'Surplus' : 'Deficit'}
                </span>
              </div>

              <div className="relative overflow-hidden rounded border border-zinc-200/70 dark:border-zinc-800/70">

                <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-800">
                  <div className="p-3 sm:p-5 min-w-0 bg-gradient-to-r from-emerald-500/14 via-emerald-500/6 to-transparent dark:from-emerald-500/16 dark:via-emerald-500/7 dark:to-transparent">
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Inflow (monthly)
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 min-w-0">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <p className="min-w-0 truncate text-[20px] sm:text-[24px] font-light leading-none text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(totalInflowFromBanks)}
                      </p>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      Bank inflow across {bankAccounts.length} accounts
                    </p>
                  </div>

                  <div className="p-3 sm:p-5 min-w-0 bg-gradient-to-l from-rose-500/14 via-rose-500/6 to-transparent dark:from-rose-500/16 dark:via-rose-500/7 dark:to-transparent">
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Outflow (monthly)
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 min-w-0">
                      <TrendingDown className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <p className="min-w-0 truncate text-[20px] sm:text-[24px] font-light leading-none text-rose-600 dark:text-rose-400">
                        {formatCurrency(totalOutflowFromBanks)}
                      </p>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      Recurring + projected spend
                    </p>
                  </div>
                </div>

                <div className="px-3 sm:px-5 py-2.5 border-t border-zinc-200/70 dark:border-zinc-800/70">
                  <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>Flow coverage</span>
                    <span className="font-medium">
                      {totalOutflowFromBanks > 0
                        ? `${Math.round((totalInflowFromBanks / totalOutflowFromBanks) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        monthlyNetFlow >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                      )}
                      style={{
                        width: `${Math.max(
                          8,
                          Math.min(
                            totalOutflowFromBanks > 0
                              ? (totalInflowFromBanks / totalOutflowFromBanks) * 100
                              : 0,
                            100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>Net monthly</span>
                    <span className={cn('font-medium', monthlyNetFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      {monthlyNetFlow >= 0 ? '+' : '-'}{formatCurrency(Math.abs(monthlyNetFlow))}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-light tracking-tight">Visual Insights</h2>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Interactive views inspired by modern budgeting tools with transaction-first context
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex gap-6 overflow-x-auto no-scrollbar">
                  {INSIGHT_TAB_LIST.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setInsightTab(tab)}
                      className={cn(
                        'text-sm font-medium transition-colors relative pb-2 whitespace-nowrap',
                        insightTab === tab
                          ? 'text-black dark:text-white'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      )}
                    >
                      {tab}
                      {insightTab === tab && (
                        <motion.div
                          layoutId="budget-insight-tab"
                          className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 space-y-4">
                {insightTab === 'Cash Flow' && (
                  <>
                    <div className="overflow-x-auto">
                      <div className="min-w-[620px] border-y border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-4">
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">This month inflow</p>
                          <p className="text-[15px] sm:text-[19px] font-light mt-1 leading-none text-emerald-600 dark:text-emerald-400">{formatCurrency(currentMonthFlow.inflow)}</p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">This month outflow</p>
                          <p className="text-[15px] sm:text-[19px] font-light mt-1 leading-none text-rose-600 dark:text-rose-400">{formatCurrency(currentMonthFlow.outflow)}</p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Net flow</p>
                          <p className={cn('text-[15px] sm:text-[19px] font-light mt-1 leading-none', currentMonthFlow.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {currentMonthFlow.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(currentMonthFlow.net))}
                          </p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Pending</p>
                          <p className="text-[15px] sm:text-[19px] font-light mt-1 leading-none">{pendingTransactionCount}</p>
                        </div>
                      </div>
                    </div>

                    <div className="h-[290px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyFlowData} margin={{ top: 6, right: 8, left: -22, bottom: 4 }} barGap={8}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" opacity={0.25} />
                          <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tickFormatter={formatCurrencyCompact} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={58} tickMargin={2} />
                          <Tooltip content={<InsightTooltip />} />
                          <ReferenceLine y={0} stroke="#a1a1aa" />
                          <Bar dataKey="inflow" name="Inflow" fill="#10b981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="outflow" name="Outflow" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}

                {insightTab === 'Spend Mix' && (
                  <div className="space-y-4">
                    <div className="overflow-x-auto no-scrollbar">
                      <div className="min-w-[620px] rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-4">
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Filtered inflow</p>
                          <p className="text-[13px] sm:text-[15px] font-light mt-1 leading-none text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(filteredInflowTotal)}
                          </p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Filtered outflow</p>
                          <p className="text-[13px] sm:text-[15px] font-light mt-1 leading-none text-rose-600 dark:text-rose-400">
                            {formatCurrency(filteredOutflowTotal)}
                          </p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Outflow pressure</p>
                          <p className="text-[13px] sm:text-[15px] font-light mt-1 leading-none">
                            {outflowPressurePercent.toFixed(1)}%
                          </p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top source</p>
                          <p className="text-[13px] sm:text-[15px] font-light mt-1 leading-none truncate">
                            {sourceVolumeData[0]?.source || 'N/A'}
                          </p>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                            {sourceVolumeData[0]
                              ? `${formatCurrencyCompact(sourceVolumeData[0].amount)} · ${sourceVolumeData[0].count} tx`
                              : 'No source data'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 xl:items-start">
                      <div className="xl:col-span-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-900/40 overflow-hidden">
                        <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Source mix</p>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {sourceBreakdownData.length} sources
                          </p>
                        </div>

                        <div className="px-3 pb-3">
                          <div className="relative mx-auto h-[208px] w-[208px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={sourceBreakdownData.length > 0 ? sourceBreakdownData : [{ name: 'No data', value: 1 }]}
                                  dataKey="value"
                                  nameKey="name"
                                  innerRadius={58}
                                  outerRadius={84}
                                  startAngle={90}
                                  endAngle={-270}
                                  stroke="none"
                                  paddingAngle={sourceBreakdownData.length > 1 ? 2 : 0}
                                >
                                  {(sourceBreakdownData.length > 0 ? sourceBreakdownData : [{ name: 'No data', value: 1 }]).map((entry, index) => (
                                    <Cell
                                      key={entry.name}
                                      fill={sourceBreakdownData.length > 0 ? SOURCE_COLORS[index % SOURCE_COLORS.length] : '#d4d4d8'}
                                    />
                                  ))}
                                </Pie>
                                {sourceBreakdownData.length > 0 && (
                                  <Tooltip
                                    content={<InsightTooltip />}
                                    cursor={false}
                                    position={{ x: 12, y: 8 }}
                                    wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                                  />
                                )}
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-[36px] rounded-full border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/95 dark:bg-[#111318]/95 flex flex-col items-center justify-center">
                              <Wallet className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 mb-1" />
                              <p className="text-[15px] sm:text-[16px] font-light leading-none">
                                {formatCurrencyCompact(sourceBreakdownTotal)}
                              </p>
                              <p className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mt-1">
                                Source total
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 px-3 py-2">
                          {sourceBreakdownData.length === 0 && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">No source data in current filter set.</p>
                          )}
                          {sourceBreakdownData.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 sm:grid sm:grid-cols-2 sm:gap-2">
                              {sourceBreakdownData.map((item, index) => {
                                const pct = sourceBreakdownTotal > 0 ? (item.value / sourceBreakdownTotal) * 100 : 0;
                                return (
                                  <div
                                    key={item.name}
                                    className="inline-flex sm:flex sm:w-full items-center gap-2 rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/70 dark:bg-zinc-900/60 px-2 py-1.5 text-[10px]"
                                  >
                                    <span className="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 min-w-0">
                                      <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{ backgroundColor: SOURCE_COLORS[index % SOURCE_COLORS.length] }}
                                      />
                                      <span className="truncate">{item.name}</span>
                                    </span>
                                    <span className="text-zinc-500 dark:text-zinc-400 ml-auto whitespace-nowrap">
                                      {formatCurrencyCompact(item.value)} · {pct.toFixed(0)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="xl:col-span-3 space-y-3">
                        <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Top outflow categories</p>
                          <div className="space-y-2">
                            {outflowCategoryData.length === 0 && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">No outflow categories in current filter set.</p>
                            )}
                            {outflowCategoryData.slice(0, 5).map((category, index) => {
                              const pct = outflowCategoryTotal > 0 ? (category.value / outflowCategoryTotal) * 100 : 0;
                              return (
                                <div key={category.name}>
                                  <div className="flex items-center justify-between text-[11px] mb-1">
                                    <span className="capitalize text-zinc-700 dark:text-zinc-300">{category.name}</span>
                                    <span className="text-zinc-500 dark:text-zinc-400">
                                      {formatCurrencyCompact(category.value)} · {pct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded overflow-hidden">
                                    <div
                                      className="h-full rounded"
                                      style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Outflow by weekday</p>
                            <div className="h-[120px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={weekdayOutflowData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                                  <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                                  <YAxis hide />
                                  <Tooltip content={<InsightTooltip />} />
                                  <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>

                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Source velocity</p>
                            <div className="space-y-2">
                              {sourceVolumeData.length === 0 && (
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">No source velocity data.</p>
                              )}
                              {sourceVolumeData.slice(0, 4).map((source) => (
                                <div key={source.source} className="flex items-center justify-between text-[11px]">
                                  <span className="text-zinc-700 dark:text-zinc-200 truncate pr-2">{source.source}</span>
                                  <span className="text-zinc-500 dark:text-zinc-400 shrink-0">
                                    {formatCurrencyCompact(source.amount)} · {source.count} tx
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {insightTab === 'Forecast' && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={forecastScenario} onValueChange={(value: ForecastScenario) => setForecastScenario(value)}>
                        <SelectTrigger size="xs" className="w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Conservative">Conservative</SelectItem>
                          <SelectItem value="Base">Base case</SelectItem>
                          <SelectItem value="Aggressive">Aggressive</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={String(forecastHorizon)} onValueChange={(value: string) => setForecastHorizon(Number(value) as ForecastHorizon)}>
                        <SelectTrigger size="xs" className="w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10 years</SelectItem>
                          <SelectItem value="20">20 years</SelectItem>
                          <SelectItem value="30">30 years</SelectItem>
                        </SelectContent>
                      </Select>

                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 ml-auto">
                        Assumptions: {annualizedGrowthRate.toFixed(1)}% annual growth and {formatCurrency(adjustedForecastInputs.netFlow)} net monthly flow
                      </p>
                    </div>

                    <div className="overflow-x-auto">
                      <div className="min-w-[620px] border-y border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-3">
                        <div className="p-3">
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Current net worth</p>
                          <p className="text-[15px] sm:text-[19px] font-light mt-1 leading-none">{formatCurrency(totalAccountValue)}</p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Future net worth</p>
                          <p className="text-[15px] sm:text-[19px] font-light mt-1 leading-none">{formatCurrency(forecastEndValue)}</p>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Forecast change</p>
                          <p className={cn('text-[15px] sm:text-[19px] font-light mt-1 leading-none', forecastDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {forecastDelta >= 0 ? '+' : '-'}{formatCurrency(Math.abs(forecastDelta))}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{forecastDeltaPercent.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>

                    <div className="h-[300px] sm:h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={forecastData} margin={{ top: 6, right: 14, left: 0, bottom: 8 }}>
                          <defs>
                            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.55} />
                              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.08} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="4 4" stroke="#a1a1aa" opacity={0.35} />
                          <XAxis
                            dataKey="monthOffset"
                            type="number"
                            domain={[-HISTORY_MONTHS, forecastHorizon * MONTHS_PER_YEAR]}
                            ticks={xAxisTicks}
                            tickFormatter={getYOffsetLabel}
                            tick={{ fill: '#71717a', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            orientation="right"
                            tickFormatter={formatCurrencyCompact}
                            tick={{ fill: '#71717a', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            width={72}
                          />
                          <Tooltip content={<ForecastTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                          <ReferenceLine x={0} stroke="#94a3b8" strokeOpacity={0.7} />
                          <ReferenceLine
                            y={forecastTargetValue}
                            stroke="#93c5fd"
                            strokeOpacity={0.85}
                            strokeDasharray="5 5"
                            label={{
                              value: `Target: ${formatCurrencyCompact(forecastTargetValue)}`,
                              position: 'insideTopRight',
                              fill: '#64748b',
                              fontSize: 10,
                            }}
                          />
                          <Area dataKey="historicalValue" type="monotone" stroke="#3b82f6" strokeWidth={2} fill="url(#forecastFill)" connectNulls dot={false} />
                          <Line dataKey="projectedValue" type="monotone" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 4" connectNulls dot={false} />
                          {milestoneOffsets.map((offset) => {
                            const milestonePoint = forecastData.find((point) => point.monthOffset === offset);
                            if (!milestonePoint) return null;
                            return (
                              <ReferenceDot
                                key={offset}
                                x={offset}
                                y={milestonePoint.value}
                                r={5.5}
                                fill="#dbeafe"
                                stroke="#3b82f6"
                                strokeWidth={1.5}
                                label={{
                                  value: milestoneLabels.get(offset) ?? `Y${offset / MONTHS_PER_YEAR}`,
                                  position: 'top',
                                  fill: '#64748b',
                                  fontSize: 10,
                                }}
                              />
                            );
                          })}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Baseline net worth</p>
                        <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{formatCurrencyCompact(baselineForecastEndValue)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Scenario net worth</p>
                        <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{formatCurrencyCompact(forecastEndValue)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Forecast change</p>
                        <p className={cn('text-[12px] sm:text-[14px] font-light mt-1 leading-none', forecastDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {forecastDelta >= 0 ? '+' : '-'}{formatCurrencyCompact(Math.abs(forecastDelta))}
                        </p>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">{forecastDeltaPercent.toFixed(1)}%</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">% success</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Base {baselineSuccessScore.toFixed(0)}%</p>
                        <p className={cn('text-[12px] sm:text-[14px] font-light leading-none mt-1', changedSuccessScore >= baselineSuccessScore ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          Scenario {changedSuccessScore.toFixed(0)}%
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Cash flow /yr</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                          Base {baselineYearlyCashFlow >= 0 ? '+' : '-'}
                          {formatCurrencyCompact(Math.abs(baselineYearlyCashFlow))}
                        </p>
                        <p className={cn('text-[12px] sm:text-[14px] font-light leading-none mt-1', changedYearlyCashFlow >= baselineYearlyCashFlow ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          Scenario {changedYearlyCashFlow >= 0 ? '+' : '-'}
                          {formatCurrencyCompact(Math.abs(changedYearlyCashFlow))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Projected CAGR</p>
                        <p className={cn('text-[12px] sm:text-[14px] font-light mt-1 leading-none', forecastCagr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {forecastCagr >= 0 ? '+' : '-'}{Math.abs(forecastCagr).toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">{forecastHorizon}Y horizon</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="py-3 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-light tracking-tight">Consolidated Transactions</h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    On-chain activity + connected bank recurring flows + spend data
                  </p>
                </div>
                <button
                  onClick={handleRefreshData}
                  className="text-zinc-500 text-sm hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
                  disabled={portfolioLoading}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', portfolioLoading && 'animate-spin')} />
                  Refresh
                </button>
              </div>

              <div className="pt-4 space-y-4">
                <div className="overflow-x-auto no-scrollbar">
                  <div className="min-w-[620px] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => applyQuickFocus('all')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        directionFilter === 'All' && statusFilter === 'All'
                          ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                          : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      All ({quickFocusCounts.all})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickFocus('inflow')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        directionFilter === 'inflow' && statusFilter === 'All'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      Inflow ({quickFocusCounts.inflow})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickFocus('outflow')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        directionFilter === 'outflow' && statusFilter === 'All'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      Outflow ({quickFocusCounts.outflow})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickFocus('pending')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        statusFilter === 'pending'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      Pending ({quickFocusCounts.pending})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickFocus('failed')}
                      className={cn(
                        'h-8 px-3 rounded-full text-xs border transition-colors',
                        statusFilter === 'failed'
                          ? 'bg-rose-700 text-white border-rose-700'
                          : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      )}
                    >
                      Failed ({quickFocusCounts.failed})
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                  <div className="relative min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search merchant, asset, network, hash..."
                      className="pl-9 h-9 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAdvancedFilterTab('time');
                      setFiltersOpen(true);
                    }}
                    className={cn(
                      'h-9 px-2.5 sm:px-3 rounded-md border text-[11px] sm:text-sm transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0',
                      dateFilter === '90D'
                        ? 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        : 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                    )}
                  >
                    <Calendar className="w-4 h-4" />
                    <span className="sm:hidden">{getDateFilterCompactLabel(dateFilter)}</span>
                    <span className="hidden sm:inline">{getDateFilterLabel(dateFilter)}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAdvancedFilterTab('quick');
                      setFiltersOpen(true);
                    }}
                    className="h-9 px-2.5 sm:px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-[11px] sm:text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Filters</span>
                    {activeFilterLabels.length > 0 && (
                      <span className="inline-flex items-center justify-center min-w-4 h-4 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[10px] px-1">
                        {activeFilterLabels.length}
                      </span>
                    )}
                  </button>
                </div>

                {activeFilterLabels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeFilterLabels.map((filter) => (
                      <button
                        key={filter.key}
                        onClick={filter.onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        {filter.label}
                        <X className="w-3 h-3" />
                      </button>
                    ))}
                    <button
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <div className="min-w-[620px] border-y border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-3">
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Filtered inflow</p>
                      <p className="text-[15px] sm:text-[19px] font-light leading-none text-emerald-600 dark:text-emerald-400 mt-1">
                        {formatCurrency(filteredInflowTotal)}
                      </p>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Filtered outflow</p>
                      <p className="text-[15px] sm:text-[19px] font-light leading-none text-rose-600 dark:text-rose-400 mt-1">
                        {formatCurrency(filteredOutflowTotal)}
                      </p>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Result count</p>
                      <p className="text-[15px] sm:text-[19px] font-light leading-none mt-1">{filteredTransactions.length}</p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">transactions</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto no-scrollbar">
                  <div className="min-w-[620px] border-y border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-4">
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Completed</p>
                      <p className="text-[13px] sm:text-[16px] font-light mt-1 leading-none text-emerald-600 dark:text-emerald-400">{filteredCompletedCount}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Pending</p>
                      <p className="text-[13px] sm:text-[16px] font-light mt-1 leading-none text-amber-600 dark:text-amber-400">{filteredPendingCount}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Failed</p>
                      <p className="text-[13px] sm:text-[16px] font-light mt-1 leading-none text-rose-600 dark:text-rose-400">{filteredFailedCount}</p>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Avg outflow ticket</p>
                      <p className="text-[13px] sm:text-[16px] font-light mt-1 leading-none">{formatCurrency(averageOutflowTicket)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {displayedTransactions.length === 0 && (
                    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-6 text-sm text-zinc-500 dark:text-zinc-400 text-center">
                      No transactions match your current filters. Try clearing filters or reducing search terms.
                    </div>
                  )}

                  {displayedTransactions.map((transaction) => {
                    const isInflow = transaction.direction === 'inflow';
                    const Icon =
                      transaction.source === 'On-chain'
                        ? Wallet
                        : transaction.source === 'Bank recurring'
                          ? Repeat
                          : Calendar;

                    const statusLabel = transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1);

                    return (
                      <div
                        key={transaction.id}
                        className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden hover:bg-zinc-50/60 dark:hover:bg-zinc-900/60 transition-colors"
                      >
                        <div className="p-3 sm:p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div
                                className={cn(
                                  'w-9 h-9 rounded-full shrink-0 flex items-center justify-center',
                                  isInflow
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                )}
                              >
                                <Icon className="w-4 h-4" />
                              </div>

                              <div className="min-w-0">
                                <p className="text-sm font-medium text-black dark:text-white truncate">{transaction.title}</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                                  {transaction.subtitle}
                                </p>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <p
                                className={cn(
                                  'font-light text-[12px] leading-none',
                                  isInflow ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                )}
                              >
                                {isInflow ? '+' : '-'}{formatCurrency(transaction.amount)}
                              </p>
                              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wide">
                                {isInflow ? 'Inflow' : 'Outflow'}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 mt-3">
                            <Badge variant="outline" className="text-[10px]">
                              {transaction.source}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {transaction.category}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] capitalize',
                                transaction.status === 'completed' &&
                                  'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
                                transaction.status === 'pending' &&
                                  'border-amber-500/40 text-amber-700 dark:text-amber-300',
                                transaction.status === 'failed' &&
                                  'border-rose-500/40 text-rose-700 dark:text-rose-300'
                              )}
                            >
                              {statusLabel}
                            </Badge>
                          </div>
                        </div>

                        <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 px-3 sm:px-4 py-2.5">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="min-w-0">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Account</p>
                              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate mt-0.5">{transaction.account}</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Date</p>
                              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5">
                                {transaction.date.toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Settlement</p>
                              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate mt-0.5">
                                {transaction.network || 'Connected accounts'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Reference</p>
                              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5">
                                {transaction.id.slice(0, 10)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {displayedTransactions.length < filteredTransactions.length && (
                  <button
                    onClick={() => setVisibleCount((count) => count + 20)}
                    className="w-full h-9 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Load more ({filteredTransactions.length - displayedTransactions.length} remaining)
                  </button>
                )}
              </div>

              <Dialog
                open={filtersOpen}
                onOpenChange={(open) => {
                  setFiltersOpen(open);
                  if (!open) setAdvancedFilterTab('quick');
                }}
              >
                <DialogContent className="w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] sm:max-w-2xl h-[min(590px,calc(100dvh-0.75rem))] p-0 gap-0 overflow-hidden rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/95 dark:bg-[#0b0f14]/95">
                  <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-blue-500/14 via-emerald-500/10 to-transparent dark:from-blue-500/22 dark:via-emerald-500/14 dark:to-transparent">
                    <DialogHeader className="space-y-1">
                      <DialogTitle className="text-base sm:text-lg font-medium tracking-tight">Transaction Filters</DialogTitle>
                      <DialogDescription className="text-[11px] sm:text-xs">
                        Compact control board with chip toggles, sliders, and quick cycling.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <Badge variant="outline" className="text-[10px] border-blue-300/60 dark:border-blue-700/60">
                        {getDateFilterLabel(dateFilter)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-emerald-300/60 dark:border-emerald-700/60">
                        {filteredTransactions.length} results
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-zinc-300/70 dark:border-zinc-700/70">
                        {activeFilterLabels.length} active
                      </Badge>
                    </div>
                  </div>

                  <Tabs
                    value={advancedFilterTab}
                    onValueChange={(value) => setAdvancedFilterTab(value as 'quick' | 'flow' | 'time' | 'amount')}
                    className="flex-1 min-h-0 grid grid-rows-[auto_1fr_auto]"
                  >
                    <div className="px-3 sm:px-4 pt-3">
                      <TabsList className="grid grid-cols-4 w-full h-9 p-0.5 rounded-lg bg-zinc-100/90 dark:bg-zinc-900/70 border border-zinc-200/70 dark:border-zinc-800/70">
                        <TabsTrigger value="quick" className="h-8 px-1 text-[10px] sm:text-xs">Quick</TabsTrigger>
                        <TabsTrigger value="flow" className="h-8 px-1 text-[10px] sm:text-xs">Flow</TabsTrigger>
                        <TabsTrigger value="time" className="h-8 px-1 text-[10px] sm:text-xs">Time</TabsTrigger>
                        <TabsTrigger value="amount" className="h-8 px-1 text-[10px] sm:text-xs">Amount</TabsTrigger>
                      </TabsList>
                    </div>

                    <div className="px-3 sm:px-4 pt-2 pb-3 min-h-0">
                      <TabsContent value="quick" className="mt-0 h-full">
                        <div className="h-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/75 dark:bg-zinc-900/45 p-2.5 space-y-2">
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Quick presets</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              <FilterPill
                                active={dateFilter === '30D' && directionFilter === 'outflow' && statusFilter === 'All'}
                                label="Recent outflows"
                                onClick={() => {
                                  setDateFilter('30D');
                                  setDirectionFilter('outflow');
                                  setStatusFilter('All');
                                  setSortFilter('Newest');
                                }}
                                activeClassName="border-rose-300 bg-rose-50/80 text-rose-700 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-300"
                              />
                              <FilterPill
                                active={dateFilter === '90D' && statusFilter === 'pending'}
                                label="Pending queue"
                                onClick={() => {
                                  setDateFilter('90D');
                                  setStatusFilter('pending');
                                  setDirectionFilter('All');
                                }}
                                activeClassName="border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-300"
                              />
                              <FilterPill
                                active={dateFilter === '1Y' && directionFilter === 'inflow' && sortFilter === 'AmountHigh'}
                                label="Largest inflows"
                                onClick={() => {
                                  setDateFilter('1Y');
                                  setDirectionFilter('inflow');
                                  setStatusFilter('completed');
                                  setSortFilter('AmountHigh');
                                }}
                                activeClassName="border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300"
                              />
                              <button
                                type="button"
                                onClick={resetFilters}
                                className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              >
                                Reset all
                              </button>
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Direction</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {DIRECTION_FILTER_OPTIONS.map((option) => (
                                <FilterPill
                                  key={option}
                                  active={directionFilter === option}
                                  label={getDirectionFilterLabel(option)}
                                  onClick={() => setDirectionFilter(option)}
                                  activeClassName={
                                    option === 'inflow'
                                      ? 'border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300'
                                      : option === 'outflow'
                                        ? 'border-rose-300 bg-rose-50/80 text-rose-700 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-300'
                                        : 'border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-300'
                                  }
                                />
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Status</p>
                            <div className="grid grid-cols-4 gap-1.5">
                              {STATUS_FILTER_OPTIONS.map((option) => (
                                <FilterPill
                                  key={option}
                                  active={statusFilter === option}
                                  label={getStatusFilterLabel(option)}
                                  onClick={() => setStatusFilter(option)}
                                  activeClassName={
                                    option === 'completed'
                                      ? 'border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300'
                                      : option === 'pending'
                                        ? 'border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-300'
                                        : option === 'failed'
                                          ? 'border-rose-300 bg-rose-50/80 text-rose-700 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-300'
                                          : 'border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-300'
                                  }
                                />
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Source</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {SOURCE_FILTER_OPTIONS.map((option) => (
                                <FilterPill
                                  key={option}
                                  active={sourceFilter === option}
                                  label={option}
                                  onClick={() => setSourceFilter(option)}
                                  activeClassName="border-indigo-300 bg-indigo-50/80 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/35 dark:text-indigo-300"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="flow" className="mt-0 h-full">
                        <div className="h-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/75 dark:bg-zinc-900/45 p-2.5 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            <FilterCycleControl
                              label="Source"
                              value={sourceFilter}
                              onPrev={() => setSourceFilter(cycleFilterOption(SOURCE_FILTER_OPTIONS, sourceFilter, -1))}
                              onNext={() => setSourceFilter(cycleFilterOption(SOURCE_FILTER_OPTIONS, sourceFilter, 1))}
                            />
                            <FilterCycleControl
                              label="Category"
                              value={getCategoryFilterLabel(categoryFilter)}
                              onPrev={() => setCategoryFilter(cycleFilterOption(CATEGORY_FILTER_OPTIONS, categoryFilter, -1))}
                              onNext={() => setCategoryFilter(cycleFilterOption(CATEGORY_FILTER_OPTIONS, categoryFilter, 1))}
                            />
                            <FilterCycleControl
                              label="Account"
                              value={accountFilter}
                              onPrev={() => setAccountFilter(cycleFilterOption(accountOptions, accountFilter, -1))}
                              onNext={() => setAccountFilter(cycleFilterOption(accountOptions, accountFilter, 1))}
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-1.5">
                            {DIRECTION_FILTER_OPTIONS.map((option) => (
                              <FilterPill
                                key={`flow-direction-${option}`}
                                active={directionFilter === option}
                                label={getDirectionFilterLabel(option)}
                                onClick={() => setDirectionFilter(option)}
                              />
                            ))}
                          </div>

                          <div className="grid grid-cols-4 gap-1.5">
                            {STATUS_FILTER_OPTIONS.map((option) => (
                              <FilterPill
                                key={`flow-status-${option}`}
                                active={statusFilter === option}
                                label={getStatusFilterLabel(option)}
                                onClick={() => setStatusFilter(option)}
                              />
                            ))}
                          </div>

                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/30 p-2">
                            <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Category chips</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {CATEGORY_FILTER_OPTIONS.slice(0, 9).map((option) => (
                                <FilterPill
                                  key={option}
                                  active={categoryFilter === option}
                                  label={getCategoryFilterLabel(option)}
                                  onClick={() => setCategoryFilter(option)}
                                  activeClassName="border-violet-300 bg-violet-50/80 text-violet-700 dark:border-violet-700 dark:bg-violet-950/35 dark:text-violet-300"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="time" className="mt-0 h-full">
                        <div className="h-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/75 dark:bg-zinc-900/45 p-2.5 space-y-2">
                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/30 p-2">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Date horizon</p>
                              <p className="text-[10px] text-zinc-600 dark:text-zinc-300">{getDateFilterCompactLabel(dateFilter)}</p>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={DATE_FILTER_OPTIONS.length - 1}
                              step={1}
                              value={dateFilterIndex}
                              onChange={(event) => {
                                const nextValue = DATE_FILTER_OPTIONS[Number(event.target.value)] || '90D';
                                setDateFilter(nextValue);
                              }}
                              className="w-full accent-blue-600"
                            />
                            <div className="grid grid-cols-6 gap-1 mt-1">
                              {DATE_FILTER_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => setDateFilter(option)}
                                  className={cn(
                                    'h-7 rounded-md border text-[10px] transition-colors',
                                    dateFilter === option
                                      ? 'border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-300'
                                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  )}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDateFilter(dateFilter === 'All' ? '90D' : 'All')}
                              className={cn(
                                'h-8 rounded-md border px-2 text-[11px] transition-colors inline-flex items-center justify-between',
                                dateFilter === 'All'
                                  ? 'border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300'
                                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                              )}
                            >
                              <span>Full history</span>
                              <span className={cn('relative inline-flex h-4 w-8 rounded-full transition-colors', dateFilter === 'All' ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700')}>
                                <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform', dateFilter === 'All' ? 'translate-x-4' : 'translate-x-0.5')} />
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSortFilter(sortFilter === 'Oldest' ? 'Newest' : 'Oldest')}
                              className={cn(
                                'h-8 rounded-md border px-2 text-[11px] transition-colors inline-flex items-center justify-between',
                                sortFilter === 'Oldest'
                                  ? 'border-indigo-300 bg-indigo-50/80 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/35 dark:text-indigo-300'
                                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                              )}
                            >
                              <span>Oldest first</span>
                              <span className={cn('relative inline-flex h-4 w-8 rounded-full transition-colors', sortFilter === 'Oldest' ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700')}>
                                <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform', sortFilter === 'Oldest' ? 'translate-x-4' : 'translate-x-0.5')} />
                              </span>
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            {SORT_FILTER_OPTIONS.map((option) => (
                              <FilterPill
                                key={option}
                                active={sortFilter === option}
                                label={SORT_FILTER_LABELS[option]}
                                onClick={() => setSortFilter(option)}
                                activeClassName="border-sky-300 bg-sky-50/80 text-sky-700 dark:border-sky-700 dark:bg-sky-950/35 dark:text-sky-300"
                              />
                            ))}
                          </div>

                          <FilterCycleControl
                            label="Account focus"
                            value={accountFilter}
                            onPrev={() => setAccountFilter(cycleFilterOption(accountOptions, accountFilter, -1))}
                            onNext={() => setAccountFilter(cycleFilterOption(accountOptions, accountFilter, 1))}
                          />
                        </div>
                      </TabsContent>

                      <TabsContent value="amount" className="mt-0 h-full">
                        <div className="h-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/75 dark:bg-zinc-900/45 p-2.5 space-y-2">
                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/30 p-2">
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="text-zinc-500 dark:text-zinc-400">Range</span>
                              <span className="text-zinc-700 dark:text-zinc-200">
                                {formatCurrency(amountMinSliderValue)} - {formatCurrency(amountMaxSliderValue)}
                              </span>
                            </div>
                            <div className="relative h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 mt-2 mb-1">
                              <span
                                className="absolute h-1.5 rounded-full bg-blue-500"
                                style={{
                                  left: `${(amountMinSliderValue / amountRangeUpperBound) * 100}%`,
                                  width: `${Math.max(((amountMaxSliderValue - amountMinSliderValue) / amountRangeUpperBound) * 100, 2)}%`,
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Min amount</p>
                                <input
                                  type="range"
                                  min={0}
                                  max={amountRangeUpperBound}
                                  value={amountMinSliderValue}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value);
                                    const clamped = Math.min(nextValue, amountMaxSliderValue);
                                    setAmountMin(clamped <= 0 ? '' : String(Math.round(clamped)));
                                  }}
                                  className="w-full accent-emerald-600"
                                />
                              </div>
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Max amount</p>
                                <input
                                  type="range"
                                  min={0}
                                  max={amountRangeUpperBound}
                                  value={amountMaxSliderValue}
                                  onChange={(event) => {
                                    const nextValue = Number(event.target.value);
                                    const clamped = Math.max(nextValue, amountMinSliderValue);
                                    setAmountMax(clamped >= amountRangeUpperBound ? '' : String(Math.round(clamped)));
                                  }}
                                  className="w-full accent-blue-600"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <FilterPill
                              active={amountMin.trim() === '' && amountMax.trim() === ''}
                              label="Any amount"
                              onClick={() => applyAmountPreset('any')}
                            />
                            <FilterPill
                              active={amountMin.trim() === '' && Number(amountMax) === Math.min(1000, amountRangeUpperBound)}
                              label="Under $1k"
                              onClick={() => applyAmountPreset('under1k')}
                              activeClassName="border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300"
                            />
                            <FilterPill
                              active={Number(amountMin) === Math.min(1000, amountRangeUpperBound) && Number(amountMax || amountRangeUpperBound) >= Math.min(Math.max(5000, Math.min(1000, amountRangeUpperBound)), amountRangeUpperBound)}
                              label="$1k to $5k"
                              onClick={() => applyAmountPreset('1kTo5k')}
                              activeClassName="border-indigo-300 bg-indigo-50/80 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/35 dark:text-indigo-300"
                            />
                            <FilterPill
                              active={Number(amountMin) === Math.min(5000, amountRangeUpperBound) && amountMax.trim() === ''}
                              label="$5k+"
                              onClick={() => applyAmountPreset('5kPlus')}
                              activeClassName="border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-300"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <FilterPill
                              active={sortFilter === 'AmountHigh'}
                              label="Highest first"
                              onClick={() => setSortFilter('AmountHigh')}
                              activeClassName="border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-300"
                            />
                            <FilterPill
                              active={sortFilter === 'AmountLow'}
                              label="Lowest first"
                              onClick={() => setSortFilter('AmountLow')}
                              activeClassName="border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-300"
                            />
                          </div>
                        </div>
                      </TabsContent>
                    </div>

                    <div className="px-3 sm:px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setFiltersOpen(false)}
                        className="h-8 px-3 rounded-md bg-black dark:bg-white text-white dark:text-black text-xs hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Apply filters
                      </button>
                    </div>
                  </Tabs>
                </DialogContent>
              </Dialog>
            </section>
          </div>

          <div className="md:col-span-4">
            <div className="md:sticky md:top-28 space-y-4">
              <section className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-[#111111]/80 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Transaction Pulse</h3>
                  <Badge variant="outline" className="text-[10px]">
                    Last 14 days
                  </Badge>
                </div>

                <div className="overflow-x-auto no-scrollbar">
                  <div className="min-w-[480px] rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-4">
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Net flow</p>
                      <p className={cn('text-[12px] sm:text-[14px] font-light mt-1 leading-none', netFlow14d >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                        {netFlow14d >= 0 ? '+' : '-'}{formatCurrency(Math.abs(netFlow14d))}
                      </p>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Avg outflow</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{formatCurrency(averageOutflowTicket)}</p>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Largest debit</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{formatCurrency(largestOutflowTransaction?.amount ?? 0)}</p>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Pending</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{pendingTransactionCount}</p>
                    </div>
                  </div>
                </div>

                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyFlowPulseData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" opacity={0.2} />
                      <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={30} />
                      <YAxis hide />
                      <Tooltip content={<InsightTooltip />} />
                      <Line type="monotone" dataKey="inflow" stroke="#10b981" strokeWidth={1.8} dot={false} />
                      <Line type="monotone" dataKey="outflow" stroke="#f43f5e" strokeWidth={1.8} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Volume by source</p>
                  {sourceVolumeData.length === 0 && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No transaction volume for current filter set.</p>
                  )}
                  {sourceVolumeData.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {sourceVolumeData.slice(0, 3).map((source) => (
                        <div key={source.source} className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2">
                          <p className="text-[11px] text-zinc-700 dark:text-zinc-200 truncate">{source.source}</p>
                          <p className="text-[11px] mt-1 text-zinc-500 dark:text-zinc-400">
                            <span className="font-light text-[12px] leading-none text-zinc-800 dark:text-zinc-100">
                              {formatCurrencyCompact(source.amount)}
                            </span>
                            <span className="px-1">·</span>
                            {source.count} tx
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-[#111111]/80 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Queue + Recurring</h3>
                  <Badge variant="outline" className="text-[10px]">
                    Upcoming
                  </Badge>
                </div>

                <div className="overflow-x-auto no-scrollbar">
                  <div className="min-w-[340px] rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden">
                    <div className="divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-2">
                      <div className="p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Recurring inbound</p>
                        <p className="text-[12px] sm:text-[14px] font-light leading-none text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(recurringInflowMonthly)}</p>
                      </div>
                      <div className="p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Recurring outbound</p>
                        <p className="text-[12px] sm:text-[14px] font-light leading-none text-rose-600 dark:text-rose-400 mt-1">{formatCurrency(recurringOutflowMonthly)}</p>
                      </div>
                    </div>
                    <div className="px-2.5 py-2 border-t border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                      <span>Net recurring</span>
                      <span className={cn('font-medium', recurringNetMonthly >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                        {recurringNetMonthly >= 0 ? '+' : '-'}{formatCurrency(Math.abs(recurringNetMonthly))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Pending transactions</p>
                  {upcomingPendingTransactions.length === 0 && (
                    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      No pending transactions right now.
                    </div>
                  )}
                  {upcomingPendingTransactions.map((transaction) => (
                    <div key={transaction.id} className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden">
                      <div className="p-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{transaction.title}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                            {transaction.subtitle}
                          </p>
                        </div>
                        <p className={cn('font-light text-[12px] leading-none', transaction.direction === 'inflow' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {transaction.direction === 'inflow' ? '+' : '-'}{formatCurrency(transaction.amount)}
                        </p>
                      </div>
                      <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 px-2.5 py-1.5 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 gap-2">
                        <span>
                          {transaction.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="truncate text-right">{transaction.account}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Recurring schedule</p>
                  {recurringSchedule.length === 0 && (
                    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      No recurring streams detected yet.
                    </div>
                  )}
                  {recurringSchedule.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden">
                      <div className="p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{item.name}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Day {item.day}</p>
                        </div>
                        <p className={cn('font-light text-[12px] leading-none', item.direction === 'inflow' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {item.direction === 'inflow' ? '+' : '-'}{formatCurrency(item.amount)}
                        </p>
                      </div>
                      <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 px-2.5 py-1.5 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span>{item.direction === 'inflow' ? 'Inbound stream' : 'Outbound stream'}</span>
                        <span>Runs monthly</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-[#111111]/80 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    <h3 className="text-sm font-medium">Accounts + Category Focus</h3>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {bankAccounts.length} linked
                  </Badge>
                </div>

                <div className="overflow-x-auto no-scrollbar">
                  <div className="min-w-[360px] rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 divide-x divide-zinc-200 dark:divide-zinc-800 grid grid-cols-3">
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Accounts</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{bankAccounts.length}</p>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Bank balance</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none">{formatCurrency(totalLinkedAccountBalance)}</p>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top category</p>
                      <p className="text-[12px] sm:text-[14px] font-light mt-1 leading-none truncate capitalize">
                        {categoryFocusData[0]?.name || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Account balances</p>
                  {linkedAccountFocusData.length === 0 && (
                    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      No connected accounts yet. Link a bank account to power budgeting insights.
                    </div>
                  )}
                  {linkedAccountFocusData.map((account) => (
                    <div key={account.id} className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden">
                      <div className="p-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{account.name}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{account.subtype}</p>
                        </div>
                        <p className="text-[11px] sm:text-[12px] font-light leading-none mt-0.5">{formatCurrency(account.balance)}</p>
                      </div>
                      <div className="grid grid-cols-3 divide-x divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200/70 dark:border-zinc-800/70">
                        <div className="px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Inflow</p>
                          <p className="text-[11px] font-light leading-none mt-1 text-emerald-600 dark:text-emerald-400">{formatCurrencyCompact(account.inflow)}</p>
                        </div>
                        <div className="px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Outflow</p>
                          <p className="text-[11px] font-light leading-none mt-1 text-rose-600 dark:text-rose-400">{formatCurrencyCompact(account.outflow)}</p>
                        </div>
                        <div className="px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Net</p>
                          <p className={cn('text-[11px] font-light leading-none mt-1', account.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {account.net >= 0 ? '+' : '-'}{formatCurrencyCompact(Math.abs(account.net))}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 px-2.5 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Cash on hand: <span className="font-light text-zinc-900 dark:text-zinc-100">{formatCurrency(cashBalance.totalCash || 0)}</span>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Category pressure</p>
                  {categoryFocusData.length === 0 && (
                    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      No category spend yet for selected filters.
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {categoryFocusData.map((category) => (
                      <div key={category.name} className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 p-2.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="capitalize text-zinc-700 dark:text-zinc-300">{category.name}</span>
                          <span className="text-zinc-500 dark:text-zinc-400">{category.pct.toFixed(1)}%</span>
                        </div>
                        <p className="text-[11px] font-light leading-none mt-1">{formatCurrencyCompact(category.value)}</p>
                        <div className="mt-2 h-1.5 rounded bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${category.pct}%`, backgroundColor: category.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
