import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Info, ChevronRight, Settings, Share2 } from 'lucide-react';
import InteractiveChart from './InteractiveChart';
import IncomeChart from './IncomeChart';
import { isStablecoin } from '@/utils/tokenUtils';
import type { RecurringStream } from '@/utils/apiClient';

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

interface WalletTransaction {
  id: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract';
  assetSymbol: string;
  amount: number;
  currency: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp?: number;
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
  /** Plaid recurring inflow/outflow streams – merged into monthly income chart (same data as Upcoming Transactions) */
  recurringStreams?: { inflowStreams: RecurringStream[]; outflowStreams: RecurringStream[] };
}

export function IncomeView({ totalValue: _totalValue, transactions, recurringStreams }: IncomeViewProps) {
  const years = ['Next 12M', '2026', '2025', '2024', '2023', '2022'];
  const [selectedYear, setSelectedYear] = useState('2026');
  
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
  
  const getIncomeData = useCallback((year: string) => {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const currentYear = new Date().getFullYear();
    const targetYear = year === 'Next 12M' ? currentYear + 1 : parseInt(year);
    
    const monthlyData = months.map(month => ({ month, inflow: 0, outflow: 0 }));
    
    // On-chain: deposit/mint = inflow, withdraw/sell = outflow
    if (transactions && transactions.length > 0) {
      transactions.forEach(tx => {
        if (!tx.timestamp) return;
        const txDate = new Date(tx.timestamp);
        const txYear = txDate.getFullYear();
        if (txYear !== targetYear && !(year === 'Next 12M' && txYear >= currentYear)) return;
        const monthIndex = txDate.getMonth();
        if (monthIndex >= 0 && monthIndex < 12) {
          if (tx.type === 'deposit' || tx.type === 'mint') {
            monthlyData[monthIndex].inflow += tx.amount;
          } else if (tx.type === 'withdraw' || tx.type === 'sell') {
            monthlyData[monthIndex].outflow += tx.amount;
          }
        }
      });
    }
    
    // Plaid recurring: add monthly totals to each month (streams are per-month; day = day of month)
    if (recurringStreams) {
      const recurringInflowPerMonth =
        recurringStreams.inflowStreams?.reduce((sum, s) => sum + (s.amount ?? 0), 0) ?? 0;
      const recurringOutflowPerMonth =
        recurringStreams.outflowStreams?.reduce((sum, s) => sum + Math.abs(s.amount ?? 0), 0) ?? 0;
      for (let i = 0; i < 12; i++) {
        monthlyData[i].inflow += recurringInflowPerMonth;
        monthlyData[i].outflow += recurringOutflowPerMonth;
      }
    }
    
    return monthlyData;
  }, [transactions, recurringStreams]);
  
  const incomeData = useMemo(() => getIncomeData(selectedYear), [getIncomeData, selectedYear]);
  const totalIncome = useMemo(() => incomeData.reduce((acc: number, curr: { month: string; inflow: number; outflow: number }) => acc + curr.inflow, 0), [incomeData]);
  const estIncome = useMemo(() => totalIncome * 1.1, [totalIncome]); // Projection estimate
  
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[#30D158] font-medium">${estIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-zinc-500">est. {selectedYear} income</span>
          <Info className="w-4 h-4 text-zinc-600" />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#30D158] font-medium">${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
      
      {/* Income Hub Link */}
      <button className="w-full flex items-center justify-between py-4 border-t border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-black dark:text-white">Income hub</span>
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
