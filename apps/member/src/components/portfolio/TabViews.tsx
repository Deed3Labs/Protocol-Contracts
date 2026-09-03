import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Info, ChevronRight, Settings, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import InteractiveChart from './InteractiveChart';
import IncomeChart from './IncomeChart';
import { isStablecoin } from '@/utils/tokenUtils';
import type { RecurringStream, PlaidRecentTransaction } from '@/utils/apiClient';
import type { WalletTransaction } from '@/types/transactions';

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}


interface Holding {
  id: string | number;
  asset_symbol: string;
  asset_name: string;
  quantity: number;
  average_cost: number;
  current_price: number;
  valueUSD?: number;
  type: 'equity' | 'nft' | 'rwa' | 'token' | 'crypto';
}

interface ReturnViewProps {
  chartData: ChartPoint[];
  selectedRange: string;
  onRangeChange: (range: string) => void;
  dailyChange: number;
  dailyChangePercent: number;
  isNegative: boolean;
  holdings?: Holding[];
  balanceUSD?: number;
  borrowingPower?: number;
}

// Return Tab View
export function ReturnView({ chartData, selectedRange, onRangeChange, dailyChange, dailyChangePercent, isNegative, holdings, balanceUSD, borrowingPower }: ReturnViewProps) {
  const timeRanges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'];
  const periodLabels: Record<string, string> = { '1D': 'today', '1W': 'past week', '1M': 'past month', '3M': 'past quarter', '6M': 'past 6 months', 'YTD': 'year to date', '1Y': 'past year', 'All': 'all time' };
  
  // Memoize buying power – cash + available credit + spendable assets
  // (exclude equity/RWA; those aren’t directly spendable in-app)
  const buyingPower = useMemo(() => {
    if (!holdings || holdings.length === 0) return (balanceUSD || 0) + (borrowingPower || 0);
    const cryptoAndNFTValue = holdings.reduce((sum, h) => {
      if (h.type === 'equity' || h.type === 'rwa') return sum;
      if (h.type === 'token' && isStablecoin(h.asset_symbol)) return sum;
      return sum + (h.valueUSD || 0);
    }, 0);
    return (balanceUSD || 0) + (borrowingPower || 0) + cryptoAndNFTValue;
  }, [holdings, balanceUSD, borrowingPower]);
  
  // Store previous values to detect changes
  const prevChartDataRef = useRef<ChartPoint[]>(chartData);
  const prevDailyChangeRef = useRef<number>(dailyChange);
  const prevDailyChangePercentRef = useRef<number>(dailyChangePercent);
  
  // Only update if data actually changed
  useEffect(() => {
    const chartChanged = JSON.stringify(chartData) !== JSON.stringify(prevChartDataRef.current);
    const changeChanged = dailyChange !== prevDailyChangeRef.current;
    const percentChanged = dailyChangePercent !== prevDailyChangePercentRef.current;
    
    if (chartChanged || changeChanged || percentChanged) {
      prevChartDataRef.current = chartData;
      prevDailyChangeRef.current = dailyChange;
      prevDailyChangePercentRef.current = dailyChangePercent;
    }
  }, [chartData, dailyChange, dailyChangePercent]);
  
  return (
    <div>
      {/* Daily Change */}
      <div className="flex items-center gap-2 mb-2">
        {isNegative ? (
          <TrendingDown className="w-4 h-4 text-[#FF3B30]" />
        ) : (
          <TrendingUp className="w-4 h-4 text-[#30D158]" />
        )}
        <span className={`font-medium ${isNegative ? 'text-[#FF3B30]' : 'text-[#30D158]'}`}>
          ${Math.abs(dailyChange).toFixed(2)} ({Math.abs(dailyChangePercent).toFixed(2)}%)
        </span>
        <span className="text-zinc-500 text-sm">{periodLabels[selectedRange]}</span>
        <Info className="w-4 h-4 text-zinc-600" />
      </div>
      
      {/* Chart */}
      <InteractiveChart data={chartData} isNegative={isNegative} />
      
      {/* Time Range Selector */}
      <div className="flex items-center gap-1 mt-4 overflow-x-auto no-scrollbar">
        {timeRanges.map((range) => (
          <button
            key={range}
            onClick={() => onRangeChange(range)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all whitespace-nowrap ${
              selectedRange === range
                ? 'bg-zinc-900 dark:bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {range}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <button className="p-2"><Settings className="w-5 h-5 text-zinc-500 dark:text-zinc-500" /></button>
          <button className="p-2"><Share2 className="w-5 h-5 text-zinc-500 dark:text-zinc-500" /></button>
        </div>
      </div>

      {/* Buying Power Link */}
      <button className="w-full flex items-center justify-between py-4 border-t border-b border-zinc-200 dark:border-zinc-800 mt-4">
        <span className="text-black dark:text-white">Buying Power</span>
        <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <span>${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <ChevronRight className="w-5 h-5 text-zinc-500" />
        </div>
      </button>
    </div>
  );
}

// Income Tab View – combines on-chain transactions + Plaid recurring streams (no extra fetch; reuse existing data)
interface IncomeViewProps {
  totalValue: number;
  transactions?: WalletTransaction[];
  bankTransactions?: PlaidRecentTransaction[];
  /** Plaid recurring inflow/outflow streams – merged into monthly income chart (same data as Upcoming Transactions) */
  recurringStreams?: { inflowStreams: RecurringStream[]; outflowStreams: RecurringStream[] };
}

type CashFlowDirection = 'inflow' | 'outflow';
type CashFlowCategory =
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

interface CashFlowEntry {
  id: string;
  direction: CashFlowDirection;
  category: CashFlowCategory;
  amount: number;
  date: Date;
  accountKey: string;
}

interface TransferMatchEntry {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dateMs: number;
  isTransfer: boolean;
  accountKey: string;
}

interface MonthlyFlowPoint {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  isProjected: boolean;
}

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

const getDateFromWalletTransaction = (tx: WalletTransaction) => {
  const fromTimestamp = normalizeTimestampMs(tx.timestamp);
  if (fromTimestamp != null) return new Date(fromTimestamp);

  const fromDate = normalizeTimestampMs(tx.date);
  if (fromDate != null) return new Date(fromDate);

  return new Date(0);
};

const getDateFromPlaidTransaction = (tx: PlaidRecentTransaction) => {
  const fromDate = normalizeTimestampMs(tx.date);
  if (fromDate != null) return new Date(fromDate);

  const fromAuthorizedDate = normalizeTimestampMs(tx.authorized_date);
  if (fromAuthorizedDate != null) return new Date(fromAuthorizedDate);

  return new Date(0);
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
const PLAID_TRANSFER_NAME_HINTS = ['zelle', 'cash app', 'cashapp', 'venmo'];
const INTERNAL_TRANSFER_MATCH_WINDOW_MS = 72 * 60 * 60 * 1000;
const toAmountCents = (amount: number) => Math.round(Math.abs(amount) * 100);

const getWalletAmountUsd = (tx: WalletTransaction) => {
  const amountUsd = Number(tx.amountUsd);
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

const getWalletFlowMeta = (type: WalletTransaction['type']) => {
  switch (type) {
    case 'deposit':
      return { direction: 'inflow' as const, category: 'deposit' as const };
    case 'withdraw':
      return { direction: 'outflow' as const, category: 'withdrawal' as const };
    case 'buy':
      return { direction: 'outflow' as const, category: 'buy' as const };
    case 'sell':
      return { direction: 'inflow' as const, category: 'sell' as const };
    case 'mint':
      return { direction: 'inflow' as const, category: 'mint' as const };
    case 'trade':
      return { direction: 'outflow' as const, category: 'trade' as const };
    case 'transfer':
      return { direction: 'outflow' as const, category: 'transfer' as const };
    case 'contract':
    default:
      return { direction: 'outflow' as const, category: 'other' as const };
  }
};

const hasTransferNameHint = (tx: PlaidRecentTransaction) => {
  const descriptor = `${tx.name || ''} ${tx.merchant_name || ''}`.toLowerCase();
  return PLAID_TRANSFER_NAME_HINTS.some((hint) => descriptor.includes(hint));
};

const getPlaidCategory = (tx: PlaidRecentTransaction): CashFlowCategory => {
  const categoryText = `${tx.category_primary || ''} ${tx.category_detailed || ''}`.toLowerCase();
  const hasTransferHint = categoryText.includes('transfer') || hasTransferNameHint(tx);

  if (tx.direction === 'inflow') {
    if (hasTransferHint) return 'transfer';
    if (categoryText.includes('deposit')) return 'deposit';
    return 'income';
  }

  if (hasTransferHint) return 'transfer';
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

const detectInternalTransferIds = (entries: TransferMatchEntry[]) => {
  const internalIds = new Set<string>();
  const unmatchedInflows = new Map<number, TransferMatchEntry[]>();
  const unmatchedOutflows = new Map<number, TransferMatchEntry[]>();

  const transferEntries = entries
    .filter((entry) => entry.isTransfer && entry.amount > 0 && Number.isFinite(entry.dateMs))
    .sort((a, b) => a.dateMs - b.dateMs);

  for (const entry of transferEntries) {
    const amountKey = toAmountCents(entry.amount);
    const oppositeMap = entry.direction === 'inflow' ? unmatchedOutflows : unmatchedInflows;
    const ownMap = entry.direction === 'inflow' ? unmatchedInflows : unmatchedOutflows;
    const candidates = oppositeMap.get(amountKey) ?? [];

    let matchIndex = -1;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate.accountKey === entry.accountKey) continue;
      if (Math.abs(candidate.dateMs - entry.dateMs) > INTERNAL_TRANSFER_MATCH_WINDOW_MS) continue;
      matchIndex = i;
      break;
    }

    if (matchIndex >= 0) {
      const [matched] = candidates.splice(matchIndex, 1);
      internalIds.add(entry.id);
      internalIds.add(matched.id);
      if (candidates.length === 0) {
        oppositeMap.delete(amountKey);
      } else {
        oppositeMap.set(amountKey, candidates);
      }
      continue;
    }

    const ownCandidates = ownMap.get(amountKey) ?? [];
    ownCandidates.push(entry);
    ownMap.set(amountKey, ownCandidates);
  }

  return internalIds;
};

export function IncomeView({ totalValue: _totalValue, transactions, bankTransactions, recurringStreams }: IncomeViewProps) {
  const navigate = useNavigate();
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return ['Next 12M', ...Array.from({ length: 5 }, (_, index) => String(currentYear - index))];
  }, []);
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  
  const prevTransactionsRef = useRef<WalletTransaction[] | undefined>(transactions);
  const prevRecurringRef = useRef<IncomeViewProps['recurringStreams']>(recurringStreams);
  
  useEffect(() => {
    if (JSON.stringify(transactions) !== JSON.stringify(prevTransactionsRef.current)) {
      prevTransactionsRef.current = transactions;
    }
    if (JSON.stringify(recurringStreams) !== JSON.stringify(prevRecurringRef.current)) {
      prevRecurringRef.current = recurringStreams;
    }
  }, [transactions, recurringStreams]);

  const cashFlowEntries = useMemo<CashFlowEntry[]>(() => {
    const walletEntries = (transactions ?? []).map((tx) => {
      const flowMeta = getWalletFlowMeta(tx.type);
      return {
        id: `wallet-${tx.id}`,
        direction: flowMeta.direction,
        category: flowMeta.category,
        amount: getWalletAmountUsd(tx),
        date: getDateFromWalletTransaction(tx),
        accountKey: `wallet:${tx.chainName || 'activity'}`,
      };
    });

    const plaidEntries = (bankTransactions ?? [])
      .map((tx) => ({
        id: `plaid-${tx.item_id}-${tx.transaction_id}`,
        direction: tx.direction,
        category: getPlaidCategory(tx),
        amount: Math.abs(Number(tx.amount) || 0),
        date: getDateFromPlaidTransaction(tx),
        accountKey: `bank:${tx.item_id}:${tx.account_id || tx.account_name || 'unknown'}`,
      }))
      .filter((tx) => tx.amount > 0);

    return [...walletEntries, ...plaidEntries].filter(
      (entry) => entry.amount > 0 && Number.isFinite(entry.date.getTime())
    );
  }, [bankTransactions, transactions]);

  const internalTransferIds = useMemo(() => {
    return detectInternalTransferIds(
      cashFlowEntries.map((entry) => ({
        id: entry.id,
        direction: entry.direction,
        amount: entry.amount,
        dateMs: entry.date.getTime(),
        isTransfer: entry.category === 'transfer',
        accountKey: entry.accountKey,
      }))
    );
  }, [cashFlowEntries]);

  const historicalFlowEntries = useMemo(() => {
    const nowMs = Date.now();
    return cashFlowEntries.filter((entry) => {
      if (entry.date.getTime() > nowMs) return false;
      if (internalTransferIds.has(entry.id)) return false;
      return entry.category !== 'transfer';
    });
  }, [cashFlowEntries, internalTransferIds]);

  const recurringMonthlyBaseline = useMemo(() => {
    return {
      inflow: recurringStreams?.inflowStreams?.reduce((sum, stream) => sum + Math.abs(stream.amount ?? 0), 0) ?? 0,
      outflow: recurringStreams?.outflowStreams?.reduce((sum, stream) => sum + Math.abs(stream.amount ?? 0), 0) ?? 0,
    };
  }, [recurringStreams]);

  const historicalMonthlyBaseline = useMemo(() => {
    const now = new Date();
    const completeMonths: Array<{ inflow: number; outflow: number }> = [];

    for (let offset = 6; offset >= 1; offset -= 1) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
      let inflow = 0;
      let outflow = 0;

      historicalFlowEntries.forEach((entry) => {
        const time = entry.date.getTime();
        if (time < monthStart.getTime() || time >= nextMonthStart.getTime()) return;
        if (entry.direction === 'inflow') inflow += entry.amount;
        if (entry.direction === 'outflow') outflow += entry.amount;
      });

      completeMonths.push({ inflow, outflow });
    }

    const divisor = completeMonths.length || 1;
    return {
      inflow: completeMonths.reduce((sum, month) => sum + month.inflow, 0) / divisor,
      outflow: completeMonths.reduce((sum, month) => sum + month.outflow, 0) / divisor,
    };
  }, [historicalFlowEntries]);

  const projectedMonthlyBaseline = useMemo(() => {
    const blend = (historical: number, recurring: number) => {
      if (historical > 0 && recurring > 0) return historical * 0.75 + recurring * 0.25;
      if (historical > 0) return historical;
      return recurring;
    };

    return {
      inflow: blend(historicalMonthlyBaseline.inflow, recurringMonthlyBaseline.inflow),
      outflow: blend(historicalMonthlyBaseline.outflow, recurringMonthlyBaseline.outflow),
    };
  }, [historicalMonthlyBaseline, recurringMonthlyBaseline]);
  
  const getIncomeData = useCallback((year: string) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();
    const buildPoint = (monthDate: Date, isProjected = false): MonthlyFlowPoint => ({
      key: `${monthDate.getFullYear()}-${monthDate.getMonth()}`,
      label: monthDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      inflow: 0,
      outflow: 0,
      net: 0,
      isProjected,
    });

    const points =
      year === 'Next 12M'
        ? Array.from({ length: 12 }, (_, index) => {
            const monthDate = new Date(currentYear, currentMonthIndex + index, 1);
            return buildPoint(monthDate, index > 0);
          })
        : Array.from({ length: 12 }, (_, monthIndex) => {
            const monthDate = new Date(Number(year), monthIndex, 1);
            return buildPoint(monthDate, Number(year) === currentYear && monthIndex > currentMonthIndex);
          });

    const pointMap = new Map(points.map((point) => [point.key, point]));

    historicalFlowEntries.forEach((entry) => {
      const key = `${entry.date.getFullYear()}-${entry.date.getMonth()}`;
      const point = pointMap.get(key);
      if (!point || point.isProjected) return;
      if (entry.direction === 'inflow') point.inflow += entry.amount;
      if (entry.direction === 'outflow') point.outflow += entry.amount;
    });

    points.forEach((point) => {
      if (!point.isProjected) {
        point.net = point.inflow - point.outflow;
        return;
      }

      point.inflow = projectedMonthlyBaseline.inflow;
      point.outflow = projectedMonthlyBaseline.outflow;
      point.net = point.inflow - point.outflow;
    });

    const actualIncomeToDate = points
      .filter((point) => !point.isProjected)
      .reduce((sum, point) => sum + point.inflow, 0);

    return {
      monthlyFlowData: points,
      actualIncomeToDate,
    };
  }, [historicalFlowEntries, projectedMonthlyBaseline]);
  
  const { monthlyFlowData, actualIncomeToDate } = useMemo(
    () => getIncomeData(selectedYear),
    [getIncomeData, selectedYear]
  );
  const estIncome = useMemo(
    () => monthlyFlowData.reduce((acc, point) => acc + point.inflow, 0),
    [monthlyFlowData]
  );
  const incomeData = useMemo(
    () => monthlyFlowData.map((point) => ({ month: point.label, inflow: point.inflow, outflow: point.outflow })),
    [monthlyFlowData]
  );
  
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[#30D158] font-medium">${estIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-zinc-500">est. {selectedYear} income</span>
          <Info className="w-4 h-4 text-zinc-600" />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#30D158] font-medium">${actualIncomeToDate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-zinc-500">received income to date</span>
          <Info className="w-4 h-4 text-zinc-600" />
        </div>
      </div>
      
      {/* Income Chart */}
      <IncomeChart data={incomeData} />
      
      {/* Year Selector */}
      <div className="flex items-center gap-2 mt-6 mb-6 overflow-x-auto no-scrollbar">
        {years.map((year) => (
          <button
            key={year}
            onClick={() => setSelectedYear(year)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all whitespace-nowrap ${
              selectedYear === year
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {year}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <button className="p-2"><Settings className="w-5 h-5 text-zinc-500" /></button>
          <button className="p-2"><Share2 className="w-5 h-5 text-zinc-500" /></button>
        </div>
      </div>
      
      {/* Transactions Hub Link */}
      <button
        onClick={() => navigate('/transactions')}
        className="w-full flex items-center justify-between py-4 border-t border-b border-zinc-200 dark:border-zinc-800"
      >
        <span className="text-black dark:text-white">Transaction hub</span>
        <ChevronRight className="w-5 h-5 text-zinc-500" />
      </button>
    </div>
  );
}

interface AccountValueViewProps {
  chartData: ChartPoint[];
  selectedRange: string;
  onRangeChange: (range: string) => void;
  totalValue: number;
  balanceUSD?: number;
  holdings?: Holding[];
}

// Account Value Tab View
export function AccountValueView({ chartData, selectedRange, onRangeChange, totalValue, balanceUSD, holdings }: AccountValueViewProps) {
  const timeRanges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'];
  
  // Store previous values to detect changes
  const prevChartDataRef = useRef<ChartPoint[]>(chartData);
  const prevTotalValueRef = useRef<number>(totalValue);
  const prevHoldingsRef = useRef<Holding[] | undefined>(holdings);
  const prevBalanceUSDRef = useRef<number | undefined>(balanceUSD);
  
  // Only update if data actually changed
  useEffect(() => {
    const chartChanged = JSON.stringify(chartData) !== JSON.stringify(prevChartDataRef.current);
    const valueChanged = totalValue !== prevTotalValueRef.current;
    const holdingsChanged = JSON.stringify(holdings) !== JSON.stringify(prevHoldingsRef.current);
    const balanceChanged = balanceUSD !== prevBalanceUSDRef.current;
    
    if (chartChanged || valueChanged || holdingsChanged || balanceChanged) {
      prevChartDataRef.current = chartData;
      prevTotalValueRef.current = totalValue;
      prevHoldingsRef.current = holdings;
      prevBalanceUSDRef.current = balanceUSD;
    }
  }, [chartData, totalValue, holdings, balanceUSD]);
  
  // Memoize net deposits calculation - only recalculate when holdings or balance changes
  const netDeposits = useMemo(() => {
    if (!holdings || holdings.length === 0) return 0;
    const totalHoldingsValue = holdings.reduce((sum, h) => sum + (h.valueUSD || 0), 0);
    return totalHoldingsValue + (balanceUSD || 0);
  }, [holdings, balanceUSD]);
  
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#30D158]" />
          <span className="text-[#30D158] font-medium">${totalValue.toFixed(2)}</span>
          <span className="text-zinc-500">all time</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#30D158] font-medium">
            ${netDeposits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-zinc-500">net deposits</span>
          <Info className="w-4 h-4 text-zinc-600" />
        </div>
      </div>
      
      {/* Chart */}
      <InteractiveChart data={chartData} color="#2563EB" showReferenceLine={false} />
      
      {/* Time Range Selector */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto no-scrollbar">
        {timeRanges.map((range) => (
          <button
            key={range}
            onClick={() => onRangeChange(range)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all whitespace-nowrap ${
              selectedRange === range
                ? 'bg-blue-600 text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {range}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <button className="p-2"><Settings className="w-5 h-5 text-zinc-500" /></button>
          <button className="p-2"><Share2 className="w-5 h-5 text-zinc-500" /></button>
        </div>
      </div>
      
      {/* Cost Basis Hub Link */}
      <button className="w-full flex items-center justify-between py-4 border-t border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-black dark:text-white">Cost basis hub</span>
        <ChevronRight className="w-5 h-5 text-zinc-500" />
      </button>
    </div>
  );
}

// Allocation Tab View
interface AllocationViewProps {
  totalValue: number;
  holdings?: Holding[];
  balanceUSD?: number;
  borrowingPower?: number;
}

export function AllocationView({ totalValue, holdings, balanceUSD, borrowingPower }: AllocationViewProps) {
  // Store previous values to detect changes
  const prevTotalValueRef = useRef<number>(totalValue);
  const prevHoldingsRef = useRef<Holding[] | undefined>(holdings);
  const prevBalanceUSDRef = useRef<number | undefined>(balanceUSD);
  const prevBorrowingPowerRef = useRef<number | undefined>(borrowingPower);
  
  // Only update if data actually changed
  useEffect(() => {
    const valueChanged = totalValue !== prevTotalValueRef.current;
    const holdingsChanged = JSON.stringify(holdings) !== JSON.stringify(prevHoldingsRef.current);
    const balanceChanged = balanceUSD !== prevBalanceUSDRef.current;
    const borrowingPowerChanged = borrowingPower !== prevBorrowingPowerRef.current;
    
    if (valueChanged || holdingsChanged || balanceChanged || borrowingPowerChanged) {
      prevTotalValueRef.current = totalValue;
      prevHoldingsRef.current = holdings;
      prevBalanceUSDRef.current = balanceUSD;
      prevBorrowingPowerRef.current = borrowingPower;
    }
  }, [totalValue, holdings, balanceUSD, borrowingPower]);
  
  // Memoize allocations – crypto, NFTs, cash, equities (Plaid brokerage), RWAs (T-Deeds)
  const cryptoValue = useMemo(() => {
    if (!holdings || holdings.length === 0) return 0;
    const tokenHoldings = holdings.filter(h =>
      h.type === 'token' && !isStablecoin(h.asset_symbol)
    );
    return tokenHoldings.reduce((sum, h) => sum + ((h as any).balanceUSD || (h as any).valueUSD || 0), 0);
  }, [holdings]);
  const nftValue = useMemo(() =>
    holdings?.filter(h => h.type === 'nft').reduce((sum, h) => sum + (h.valueUSD || 0), 0) || 0,
    [holdings]
  );
  const equityValue = useMemo(() =>
    holdings?.filter(h => h.type === 'equity').reduce((sum, h) => sum + (h.valueUSD || 0), 0) || 0,
    [holdings]
  );
  const rwaValue = useMemo(() =>
    holdings?.filter(h => h.type === 'rwa').reduce((sum, h) => sum + (h.valueUSD || 0), 0) || 0,
    [holdings]
  );
  const cashValue = useMemo(() => balanceUSD || 0, [balanceUSD]);
  const borrowingPowerValue = useMemo(() => Math.max(0, borrowingPower || 0), [borrowingPower]);

  const rawAllocations = useMemo(() => [
    { name: 'Equities', value: equityValue, color: 'bg-indigo-500', hasInfo: false },
    { name: 'Options', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Bonds', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Crypto', value: cryptoValue, color: 'bg-blue-500', hasInfo: false },
    { name: 'RWAs', value: rwaValue, color: 'bg-amber-500', hasInfo: false },
    { name: 'NFTs', value: nftValue, color: 'bg-purple-500', hasInfo: false },
    { name: 'High-Yield Cash', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Cash', value: cashValue, color: 'bg-green-500', hasInfo: true },
    { name: 'Borrowing Power', value: borrowingPowerValue, color: 'bg-orange-500', hasInfo: true },
    { name: 'Margin Usage', value: 0, color: 'bg-zinc-600', hasInfo: false },
  ], [equityValue, cryptoValue, rwaValue, nftValue, cashValue, borrowingPowerValue]);

  // Calculate the actual total from allocations to ensure percentages total 100%
  const actualTotal = useMemo(() => {
    return rawAllocations.reduce((sum, item) => sum + item.value, 0);
  }, [rawAllocations]);

  // Use the actual total (sum of all allocations) instead of the passed totalValue
  // This ensures percentages always total 100%
  const allocations = useMemo(() => rawAllocations.map(item => ({
    ...item,
    percent: actualTotal > 0 ? (item.value / actualTotal) * 100 : 0
  })), [rawAllocations, actualTotal]);
  
  return (
    <div>
      {/* Allocation Bar */}
      <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded mb-6 overflow-hidden flex w-full border border-zinc-200 dark:border-zinc-700">
        {allocations.map((item, index) => (
          item.percent > 0 && (
            <div 
              key={index}
              className={`h-full ${item.color}`} 
              style={{ width: `${item.percent}%` }} 
            />
          )
        ))}
      </div>
      
      {/* Allocation List */}
      <div className="space-y-0 divide-y divide-zinc-200 dark:divide-zinc-800">
        {allocations.map((item, index) => (
          <div key={index} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${item.color} ring-1 ring-zinc-300 dark:ring-zinc-600`} />
              <span className="text-black dark:text-white">
                {item.name}
                {item.hasInfo && <Info className="w-3 h-3 text-zinc-500 inline ml-1" />}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-zinc-500 dark:text-zinc-400">${item.value.toFixed(2)}</span>
              <span className="text-black dark:text-white font-medium w-16 text-right">{item.percent.toFixed(2)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
