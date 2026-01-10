import { useState } from 'react';
import { TrendingUp, TrendingDown, Info, ChevronRight, Settings, Share2 } from 'lucide-react';
import InteractiveChart from './InteractiveChart';
import IncomeChart from './IncomeChart';

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}


interface ReturnViewProps {
  chartData: ChartPoint[];
  selectedRange: string;
  onRangeChange: (range: string) => void;
  dailyChange: number;
  dailyChangePercent: number;
  isNegative: boolean;
}

// Return Tab View
export function ReturnView({ chartData, selectedRange, onRangeChange, dailyChange, dailyChangePercent, isNegative }: ReturnViewProps) {
  const timeRanges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'];
  const periodLabels: Record<string, string> = { '1D': 'today', '1W': 'past week', '1M': 'past month', '3M': 'past quarter', '6M': 'past 6 months', 'YTD': 'year to date', '1Y': 'past year', 'All': 'all time' };
  
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

      {/* Buying/Borrowing Power Link */}
      <button className="w-full flex items-center justify-between py-4 border-t border-b border-zinc-200 dark:border-zinc-800 mt-4">
        <span className="text-black dark:text-white">Borrowing power</span>
        <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <span>$8500.00</span>
          <ChevronRight className="w-5 h-5 text-zinc-500" />
        </div>
      </button>
    </div>
  );
}

// Income Tab View
export function IncomeView({ totalValue: _totalValue }: { totalValue: number }) {
  const years = ['Next 12M', '2026', '2025', '2024', '2023', '2022'];
  const [selectedYear, setSelectedYear] = useState('2026');
  
  // Mock data generator for income chart based on year
  const getIncomeData = (year: string) => {
    // Generate 12 months of data
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    
    // Base multiplier to make years look different
    const multiplier = year === '2026' ? 1.2 : year === '2025' ? 1.0 : year === '2024' ? 0.8 : 0.6;
    
    return months.map(month => ({
      month,
      inflow: Math.floor((Math.random() * 100 + 100) * multiplier),
      outflow: Math.floor((Math.random() * 60 + 20) * multiplier)
    }));
  };
  
  const incomeData = getIncomeData(selectedYear);
  const totalIncome = incomeData.reduce((acc, curr) => acc + curr.inflow, 0);
  const estIncome = totalIncome * 1.1; // Just a mock projection
  
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
}

// Account Value Tab View
export function AccountValueView({ chartData, selectedRange, onRangeChange, totalValue }: AccountValueViewProps) {
  const timeRanges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'];
  
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#30D158]" />
          <span className="text-[#30D158] font-medium">${totalValue.toFixed(2)}</span>
          <span className="text-zinc-500">all time</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#30D158] font-medium">$5.00</span>
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
export function AllocationView({ totalValue }: { totalValue: number }) {
  // Calculate allocations dynamically based on totalValue
  const rawAllocations = [
    { name: 'Equities', value: totalValue * 0.70, color: 'bg-white dark:bg-white bg-zinc-900', hasInfo: false },
    { name: 'Options', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Bonds', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Crypto', value: totalValue * 0.20, color: 'bg-blue-500', hasInfo: false },
    { name: 'High-Yield Cash', value: 0, color: 'bg-blue-500', hasInfo: false },
    { name: 'Cash', value: totalValue * 0.10, color: 'bg-green-500', hasInfo: true },
    { name: 'Margin Usage', value: 0, color: 'bg-zinc-600', hasInfo: false },
  ];

  const allocations = rawAllocations.map(item => ({
    ...item,
    percent: totalValue > 0 ? (item.value / totalValue) * 100 : 0
  }));
  
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
