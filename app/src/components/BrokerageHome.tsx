import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Info, ArrowUpRight, ArrowDownLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { ReturnView, IncomeView, AccountValueView, AllocationView } from './portfolio/TabViews';
import SideMenu from './portfolio/SideMenu';
import HeaderNav from './portfolio/HeaderNav';
import MobileNav from './portfolio/MobileNav';
import DepositModal from './portfolio/DepositModal';
import WithdrawModal from './portfolio/WithdrawModal';
import ActionModal from './portfolio/ActionModal';
import CTAStack from './portfolio/CTAStack';

// Types
interface User {
  name: string;
}

interface Holding {
  id: number;
  asset_symbol: string;
  asset_name: string;
  quantity: number;
  average_cost: number;
  current_price: number;
}

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}

interface Transaction {
  id: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade';
  assetSymbol: string;
  assetName?: string;
  amount: number;
  currency: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
}

// Mock base44 client (since it's not available in this env)
const base44 = {
  auth: {
    me: async (): Promise<User> => ({ name: 'Isaiah Litt' })
  },
  entities: {
    Holding: {
      list: async (): Promise<Holding[]> => [
         { id: 1, asset_symbol: 'TSLA', asset_name: 'Tesla', quantity: 0.05, average_cost: 279.80, current_price: 274.96 }, // Loss example
         { id: 2, asset_symbol: 'AAPL', asset_name: 'Apple', quantity: 0, average_cost: 0, current_price: 0 },
         { id: 3, asset_symbol: 'BTC', asset_name: 'Bitcoin', quantity: 0, average_cost: 0, current_price: 0 }
      ]
    }
  }
};

const generateChartData = (range: string, isNegative: boolean): ChartPoint[] => {
  const pointsMap: Record<string, number> = { '1D': 48, '1W': 7, '1M': 30, '3M': 90, '6M': 180, 'YTD': 200, '1Y': 365, 'All': 730 };
  const points = pointsMap[range] || 48;
  const data: ChartPoint[] = [];
  let value = 13.00;
  
  for (let i = 0; i < points; i++) {
    const volatility = 0.025;
    const trend = isNegative ? -0.002 : 0.002;
    value = value * (1 + (Math.random() - 0.5) * volatility + trend);
    data.push({ time: i, value, date: new Date(Date.now() - (points - i) * 3600000) });
  }
  return data;
};

// Mock Activity Data
const recentActivity: Transaction[] = [
  { id: '1', type: 'buy', assetSymbol: 'TSLA', assetName: 'Tesla', amount: 500.00, currency: 'USD', date: 'Today', status: 'completed' },
  { id: '2', type: 'deposit', assetSymbol: 'USD', amount: 1000.00, currency: 'USD', date: 'Yesterday', status: 'completed' },
  { id: '3', type: 'mint', assetSymbol: 'House #1204', amount: 0, currency: 'NFT', date: 'Oct 24', status: 'completed' },
  { id: '4', type: 'trade', assetSymbol: 'ETH', amount: 1.5, currency: 'ETH', date: 'Oct 20', status: 'completed' },
];

export default function BrokerageHome() {
  const [user, setUser] = useState<User | null>(null);
  const [selectedTab, setSelectedTab] = useState('Return');
  const [selectedRange, setSelectedRange] = useState('1D');
  const [chartData, setChartData] = useState<ChartPoint[]>(() => generateChartData('1D', true));
  const [portfolioFilter, setPortfolioFilter] = useState('All');
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  
  // State for tracking scroll position relative to portfolio value header
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  
  useEffect(() => {
    // Mock API calls
    base44.auth.me().then(setUser).catch(() => {});
    base44.entities.Holding.list().then(setHoldings).catch(() => {});
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      // Show mini-portfolio value when user scrolls past 100px (approx height of large header area)
      const threshold = 100;
      setIsScrolledPast(window.scrollY > threshold);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  const totalValue = 13.76; // Hardcoded for demo match
  
  // Calculate dynamic change stats based on chart data
  const { dailyChange, dailyChangePercent, isNegative } = (() => {
    if (chartData.length < 2) return { dailyChange: 0, dailyChangePercent: 0, isNegative: false };
    const startValue = chartData[0].value;
    const endValue = chartData[chartData.length - 1].value;
    const change = endValue - startValue;
    const percent = startValue !== 0 ? (change / startValue) * 100 : 0;
    return {
      dailyChange: change,
      dailyChangePercent: percent,
      isNegative: change < 0
    };
  })();
  
  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    // Randomly determine if the new range should be negative or positive for variety
    const shouldBeNegative = Math.random() > 0.5;
    setChartData(generateChartData(range, shouldBeNegative));
  };
  
  const tabs = ['Return', 'Income', 'Account value', 'Allocations'];

  const renderTabContent = () => {
    switch (selectedTab) {
      case 'Return':
        return (
          <ReturnView 
            chartData={chartData}
            selectedRange={selectedRange}
            onRangeChange={handleRangeChange}
            dailyChange={dailyChange}
            dailyChangePercent={dailyChangePercent}
            isNegative={isNegative}
          />
        );
      case 'Income':
        return <IncomeView totalValue={totalValue} />;
      case 'Account value':
        return (
          <AccountValueView 
            chartData={chartData}
            selectedRange={selectedRange}
            onRangeChange={handleRangeChange}
            totalValue={totalValue}
          />
        );
      case 'Allocations':
        return <AllocationView totalValue={totalValue} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans pb-20 md:pb-0 transition-colors duration-200">
      {/* Side Menu */}
      <SideMenu 
        isOpen={menuOpen} 
        onClose={() => setMenuOpen(false)} 
        user={user}
        totalValue={totalValue}
      />
      
      {/* Deposit Modal */}
      <DepositModal 
        isOpen={depositModalOpen} 
        onClose={() => setDepositModalOpen(false)} 
      />

      {/* Withdraw Modal */}
      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        withdrawableBalance={totalValue} // Using totalValue as mock cash balance
      />

      {/* Action Modal */}
      <ActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
      />
      
      {/* Header */}
      <HeaderNav
        totalValue={totalValue}
        isScrolledPast={isScrolledPast}
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
        user={user}
        profileMenuOpen={profileMenuOpen}
        setProfileMenuOpen={setProfileMenuOpen}
      />
      
      {/* Main Content */}
      
      {/* Main Content */}
      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32">
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
           {/* Left Column (Chart & Main Data) */}
           <div className="md:col-span-8">
              {/* Persistent Portfolio Value & Subheader */}
              <div className="mt-4 mb-8 flex items-end justify-between">
                   <div>
                       <div className="flex items-center gap-2 mb-1 text-zinc-500 dark:text-zinc-500">
                         <span className="text-sm font-medium">Account Balance</span>
                         <div className="group relative">
                            <Info className="h-4 w-4 cursor-help" />
                         </div>
                      </div>
                      <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                        ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span className="text-lg text-zinc-500 font-normal">USD</span>
                      </h1>
                   </div>
                   <div className="flex gap-3 pb-2">
                      <button 
                        onClick={() => setDepositModalOpen(true)}
                        className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 rounded-full text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                      >
                        Deposit
                      </button>
                      <button 
                        onClick={() => setWithdrawModalOpen(true)}
                        className="bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      >
                        Withdraw
                      </button>
                   </div>
              </div>
              
              {/* Tabs */}
              <div className="flex gap-6 mb-6 border-b border-zinc-200 dark:border-zinc-800 pb-0 overflow-x-auto no-scrollbar">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSelectedTab(tab)}
                    className={`text-sm font-medium transition-colors relative pb-2 whitespace-nowrap ${
                      selectedTab === tab ? 'text-black dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    {tab}
                    {selectedTab === tab && (
                      <motion.div 
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-[2px] bg-black dark:bg-white"
                      />
                    )}
                  </button>
                ))}
              </div>
              
              {/* Tab Content */}
              <div className="min-h-[300px]">
                 {renderTabContent()}
              </div>
           </div>

           {/* Right Column (Sidebar Widgets) */}
           <div className="md:col-span-4 space-y-6">
              {/* CTA Stack - Persistent */}
              <CTAStack />
              
              {/* Portfolio Section - Persistent */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4 flex items-center justify-between">
                    <h2 className="text-xl font-light text-black dark:text-white">Portfolio</h2>
                    <button className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      1D return
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Filter Pills */}
                  <div className="flex gap-2 mb-2 px-4">
                    {['All', 'Asset Types'].map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setPortfolioFilter(filter)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                          portfolioFilter === filter
                            ? 'bg-zinc-900 dark:bg-zinc-800 text-white'
                            : 'bg-transparent text-zinc-500 dark:text-zinc-500 border border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
                        }`}
                      >
                        {filter}
                        {filter === 'Asset Types' && <ChevronDown className="w-3 h-3" />}
                      </button>
                    ))}
                  </div>
                  
                  {/* Equities Section */}
                  <div className="mt-4 px-2 pb-2">
                    <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                      <span>Equities</span>
                      <span>1D return</span>
                    </div>
                    
                    {/* Holdings List */}
                    <div className="space-y-1">
                      {holdings.length > 0 ? holdings.map((holding) => {
                        const change = (holding.current_price || 0) - holding.average_cost;
                        const changePercent = holding.average_cost > 0 ? (change / holding.average_cost) * 100 : 0;
                        // For demo, force TSLA to be negative as per screenshot
                        const isHoldingNegative = holding.asset_symbol === 'TSLA' ? true : change < 0;
                        const displayChange = holding.asset_symbol === 'TSLA' ? -0.25 : change;
                        const displayPercent = holding.asset_symbol === 'TSLA' ? -1.83 : changePercent;
                        
                        return (
                          <div key={holding.id} className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 rounded-full flex items-center justify-center shrink-0 transition-colors">
                                 <span className="font-bold text-xs text-black dark:text-white">{holding.asset_symbol[0]}</span>
                              </div>
                              <div>
                                <p className="text-black dark:text-white font-medium text-sm">{holding.asset_symbol}</p>
                                <p className="text-zinc-500 text-xs">{holding.asset_name}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className={`font-medium text-sm ${isHoldingNegative ? 'text-[#FF3B30]' : 'text-[#30D158]'}`}>
                                  {isHoldingNegative ? '-' : '+'}${Math.abs(displayChange * (holding.quantity || 1)).toFixed(2)}
                                </p>
                                <p className={`text-xs ${isHoldingNegative ? 'text-[#FF3B30]' : 'text-[#30D158]'}`}>
                                  {isHoldingNegative ? '' : '+'}{displayPercent.toFixed(2)}%
                                </p>
                              </div>
                              <ChevronDown className="w-4 h-4 text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400" />
                            </div>
                          </div>
                        );
                      }) : (
                         <div className="py-8 text-center text-zinc-500">No holdings found</div>
                      )}
                    </div>
                  </div>
              </div>
              
              {/* Activity History Section */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4 flex items-center justify-between">
                    <h2 className="text-xl font-light text-black dark:text-white">Activity</h2>
                    <button className="text-zinc-500 text-sm hover:text-black dark:hover:text-white transition-colors">
                      View all
                    </button>
                  </div>
                  
                  <div className="space-y-1 px-2 pb-2">
                    {recentActivity.map((item) => (
                      <div key={item.id} className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            item.type === 'buy' || item.type === 'deposit' || item.type === 'mint' 
                              ? 'bg-zinc-200 dark:bg-zinc-800 text-green-600 dark:text-green-500 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700' 
                              : 'bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700'
                          }`}>
                             {item.type === 'buy' && <ArrowDownLeft className="w-5 h-5" />}
                             {item.type === 'deposit' && <ArrowDownLeft className="w-5 h-5" />}
                             {item.type === 'mint' && <CheckCircle2 className="w-5 h-5" />}
                             {item.type === 'sell' && <ArrowUpRight className="w-5 h-5" />}
                             {item.type === 'withdraw' && <ArrowUpRight className="w-5 h-5" />}
                             {item.type === 'trade' && <RefreshCw className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="text-black dark:text-white font-medium text-sm capitalize">
                              {item.type === 'buy' ? `Bought ${item.assetSymbol}` : 
                               item.type === 'sell' ? `Sold ${item.assetSymbol}` : 
                               item.type === 'mint' ? `Minted ${item.assetSymbol}` :
                               item.type}
                            </p>
                            <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                              <span>{item.date}</span>
                              <span className="w-0.5 h-0.5 bg-zinc-400 dark:bg-zinc-600 rounded-full"></span>
                              <span className="capitalize">{item.status}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-black dark:text-white font-medium text-sm">
                            {item.amount > 0 ? (
                              <>
                                {item.type === 'deposit' || item.type === 'buy' ? '+' : ''}
                                {item.currency === 'USD' ? '$' : ''}{item.amount.toLocaleString()} {item.currency !== 'USD' ? item.currency : ''}
                              </>
                            ) : (
                               <span className="text-zinc-500 text-xs">View</span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
           </div>
        </div>
      </main>
      
      {/* Bottom Navigation (Mobile) */}
      <MobileNav 
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />
    </div>
  );
}
