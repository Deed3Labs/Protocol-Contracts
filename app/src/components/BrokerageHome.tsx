import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Info, ArrowUpRight, ArrowDownLeft, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import { ReturnView, IncomeView, AccountValueView, AllocationView } from './portfolio/TabViews';
import SideMenu from './portfolio/SideMenu';
import HeaderNav from './portfolio/HeaderNav';
import MobileNav from './portfolio/MobileNav';
import DepositModal from './portfolio/DepositModal';
import WithdrawModal from './portfolio/WithdrawModal';
import ActionModal from './portfolio/ActionModal';
import CTAStack from './portfolio/CTAStack';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { useWalletActivity } from '@/hooks/useWalletActivity';
import { useDeedNFTData } from '@/hooks/useDeedNFTData';
import { useTokenBalances } from '@/hooks/useTokenBalances';
import { useAppKitAccount } from '@reown/appkit/react';
import { useDeedName } from '@/hooks/useDeedName';
import type { DeedNFT } from '@/hooks/useDeedNFTData';

// Types
interface User {
  name: string;
}

interface Holding {
  id: string | number;
  asset_symbol: string;
  asset_name: string;
  quantity: number;
  average_cost: number;
  current_price: number;
  valueUSD?: number; // USD value for sorting/filtering
  type: 'equity' | 'nft' | 'token' | 'crypto';
}

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}

// Transaction type is now imported from useWalletActivity

// Component to display NFT holding with name from metadata
const NFTHoldingItem = ({ holding, deed }: { holding: Holding; deed: DeedNFT | undefined }) => {
  const deedName = useDeedName(deed || null);
  
  // Truncate text to prevent wrapping (max ~25 chars for main, ~20 for secondary)
  const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };
  
  // Truncate secondary text to show last few characters (max ~18 chars)
  const truncateSecondary = (text: string, maxLength: number = 18): string => {
    if (text.length <= maxLength) return text;
    return '...' + text.substring(text.length - (maxLength - 3));
  };
  
  // Main text: name from metadata, fallback to asset_symbol
  const mainText = deedName 
    ? truncateText(deedName, 25) 
    : truncateText(holding.asset_symbol, 25);
  const mainTextFull = deedName || holding.asset_symbol;
  
  // Secondary text: description or configuration, fallback to asset_name
  const secondaryText = deed?.definition 
    ? truncateSecondary(deed.definition, 18)
    : deed?.configuration
    ? truncateSecondary(deed.configuration, 18)
    : truncateSecondary(holding.asset_name, 18);
  const secondaryTextFull = deed?.definition || deed?.configuration || holding.asset_name;
  
  return (
    <div className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 rounded-full flex items-center justify-center shrink-0 transition-colors">
          <span className="font-bold text-xs text-black dark:text-white">N</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-black dark:text-white font-medium text-sm truncate" title={mainTextFull}>{mainText}</p>
          <p className="text-zinc-500 text-xs truncate" title={secondaryTextFull}>{secondaryText}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-black dark:text-white font-medium text-sm">
            {holding.quantity} {holding.quantity === 1 ? 'item' : 'items'}
          </p>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400" />
      </div>
    </div>
  );
};

// Mock base44 client (since it's not available in this env)
const base44 = {
  auth: {
    me: async (): Promise<User> => ({ name: 'Isaiah Litt' })
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

export default function BrokerageHome() {
  // Wallet connection
  const { isConnected } = useAppKitAccount();
  
  // Wallet balance hook
  const { balance: walletBalance, error: balanceError, currencySymbol, balanceUSD } = useWalletBalance();
  
  // Wallet activity hook
  const { transactions: walletTransactions, isLoading: activityLoading, error: activityError, refresh: refreshActivity, blockExplorerUrl } = useWalletActivity(10);
  
  // DeedNFT holdings
  const { userDeedNFTs, getAssetTypeLabel } = useDeedNFTData();
  
  // Token balances
  const { tokens: tokenBalances } = useTokenBalances();
  
  const [user, setUser] = useState<User | null>(null);
  const [selectedTab, setSelectedTab] = useState('Return');
  const [selectedRange, setSelectedRange] = useState('1D');
  const [chartData, setChartData] = useState<ChartPoint[]>(() => generateChartData('1D', true));
  const [portfolioFilter, setPortfolioFilter] = useState<'All' | 'NFTs' | 'Tokens'>('All');
  const [isPortfolioExpanded, setIsPortfolioExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  
  // State for tracking scroll position relative to portfolio value header
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  
  // Combine DeedNFTs with token balances
  const allHoldings = useMemo<Holding[]>(() => {
    const holdings: Holding[] = [];
    
    // Add DeedNFTs
    const deedNFTHoldings: Holding[] = userDeedNFTs.map((deed) => ({
      id: `deed-${deed.tokenId}`,
      asset_symbol: `T-Deed #${deed.tokenId}`,
      asset_name: deed.definition || getAssetTypeLabel?.(deed.assetType) || 'T-Deed',
      quantity: 1,
      average_cost: 0,
      current_price: 0,
      valueUSD: 0, // NFTs don't have USD value yet
      type: 'nft' as const
    }));
    holdings.push(...deedNFTHoldings);
    
    // Add token balances
    const tokenHoldings: Holding[] = tokenBalances.map((token) => ({
      id: `token-${token.address}`,
      asset_symbol: token.symbol,
      asset_name: token.name,
      quantity: parseFloat(token.balance),
      average_cost: 0,
      current_price: token.balanceUSD / parseFloat(token.balance) || 0,
      valueUSD: token.balanceUSD,
      type: 'token' as const
    }));
    holdings.push(...tokenHoldings);
    
    // Sort by USD value (highest first), then by type
    return holdings.sort((a, b) => {
      if (a.valueUSD !== b.valueUSD) {
        return (b.valueUSD || 0) - (a.valueUSD || 0);
      }
      return a.type.localeCompare(b.type);
    });
  }, [userDeedNFTs, getAssetTypeLabel, tokenBalances]);

  // Filter holdings based on selected filter
  const filteredHoldings = useMemo(() => {
    if (portfolioFilter === 'All') return allHoldings;
    if (portfolioFilter === 'NFTs') return allHoldings.filter(h => h.type === 'nft');
    if (portfolioFilter === 'Tokens') return allHoldings.filter(h => h.type === 'token');
    return allHoldings;
  }, [allHoldings, portfolioFilter]);

  // Limit displayed holdings when not expanded
  const displayedHoldings = useMemo(() => {
    if (isPortfolioExpanded) return filteredHoldings;
    return filteredHoldings.slice(0, 5); // Show 5 holdings initially
  }, [filteredHoldings, isPortfolioExpanded]);
  
  useEffect(() => {
    // Mock API calls for user info
    base44.auth.me().then(setUser).catch(() => {});
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
  
  // Calculate total value from wallet balance and holdings
  // Use USD balance for total value calculation
  const totalValue = useMemo(() => {
    if (!isConnected) return 0;
    // Use USD balance from the hook
    // In production, you'd add value from holdings (NFTs, tokens, etc.)
    return balanceUSD || 0;
  }, [isConnected, balanceUSD]);
  
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
        withdrawableBalance={isConnected ? parseFloat(walletBalance) : 0}
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
      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32">
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
           {/* Left Column (Chart & Main Data) */}
           <div className="md:col-span-8 space-y-10">
              {/* Persistent Portfolio Value & Subheader */}
              <div>
                   <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                     <span className="text-sm font-medium">Wallet Balance</span>
                     <div className="group relative">
                        <Info className="h-4 w-4 cursor-help" />
                        <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          Native token balance from connected wallet
                        </div>
                     </div>
                     {!isConnected && (
                       <span className="text-xs text-amber-500">Connect wallet to view balance</span>
                     )}
                   </div>
                   <div className="min-h-[60px] flex items-center">
                     {balanceError ? (
                       <div className="text-red-500 text-sm">{balanceError}</div>
                     ) : (
                       <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                         {isConnected ? (
                           <>
                             ${balanceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                             <span className="text-lg text-zinc-500 font-normal">USD</span>
                           </>
                         ) : (
                           <>
                             $0.00
                             <span className="text-lg text-zinc-500 font-normal">USD</span>
                           </>
                         )}
                       </h1>
                     )}
                   </div>
                   
                   <div className="mt-6 flex flex-wrap gap-3">
                      <button 
                        onClick={() => setDepositModalOpen(true)}
                        className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                         Add Funds
                      </button>
                      <button 
                        onClick={() => setWithdrawModalOpen(true)}
                        className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800"
                      >
                        Withdraw Funds
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
                    {(['All', 'NFTs', 'Tokens'] as const).map((filter) => (
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
                      </button>
                    ))}
                  </div>
                  
                  {/* Holdings Section */}
                  <div className="mt-4 px-2 pb-2">
                    {!isConnected ? (
                      <div className="py-8 text-center text-zinc-500 text-sm">
                        Connect wallet to view holdings
                      </div>
                    ) : filteredHoldings.length > 0 ? (
                      <>
                        {/* Group holdings by type for display */}
                        {(() => {
                          // Map displayed holdings back to their original DeedNFT objects for name fetching
                          const nftHoldingsWithDeeds = displayedHoldings
                            .filter(h => h.type === 'nft')
                            .map(holding => {
                              const tokenId = holding.id.toString().replace('deed-', '');
                              const deed = userDeedNFTs.find(d => d.tokenId === tokenId);
                              return { holding, deed };
                            });
                          const tokenHoldings = displayedHoldings.filter(h => h.type === 'token');
                          
                          return (
                            <>
                              {nftHoldingsWithDeeds.length > 0 && (portfolioFilter === 'All' || portfolioFilter === 'NFTs') && (
                                <div className="mb-4">
                                  <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                                    <span>NFTs</span>
                                    <span>Value</span>
                                  </div>
                                  <div className="space-y-1">
                                    {nftHoldingsWithDeeds.map(({ holding, deed }) => (
                                      <NFTHoldingItem key={holding.id} holding={holding} deed={deed} />
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {tokenHoldings.length > 0 && (portfolioFilter === 'All' || portfolioFilter === 'Tokens') && (
                                <div>
                                  <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                                    <span>Tokens</span>
                                    <span>Value</span>
                                  </div>
                                  <div className="space-y-1">
                                    {tokenHoldings.map((holding) => {
                                      const valueUSD = holding.valueUSD || 0;
                                      
                                      return (
                                        <div key={holding.id} className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group">
                                          <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 rounded-full flex items-center justify-center shrink-0 transition-colors">
                                              <span className="font-bold text-xs text-black dark:text-white">
                                                {holding.asset_symbol[0]}
                                              </span>
                                            </div>
                                            <div>
                                              <p className="text-black dark:text-white font-medium text-sm">{holding.asset_symbol}</p>
                                              <p className="text-zinc-500 text-xs">{holding.asset_name}</p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-3">
                                            <div className="text-right">
                                              <p className="text-black dark:text-white font-medium text-sm">
                                                ${valueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </p>
                                              <p className="text-zinc-500 text-xs">
                                                {holding.quantity.toLocaleString('en-US', { 
                                                  minimumFractionDigits: holding.quantity < 1 ? 4 : 2,
                                                  maximumFractionDigits: holding.quantity < 1 ? 4 : 2
                                                })} {holding.asset_symbol}
                                              </p>
                                            </div>
                                            <ChevronDown className="w-4 h-4 text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400" />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {/* View All / Show Less Button */}
                              {filteredHoldings.length > 5 && (
                                <div className="mt-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                                  <button
                                    onClick={() => setIsPortfolioExpanded(!isPortfolioExpanded)}
                                    className="w-full text-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-2"
                                  >
                                    {isPortfolioExpanded 
                                      ? `Show Less (${filteredHoldings.length} total)`
                                      : `View All (${filteredHoldings.length} holdings)`
                                    }
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="py-8 text-center text-zinc-500 text-sm">
                        No holdings found
                      </div>
                    )}
                  </div>
              </div>
              
              {/* Activity History Section */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4 flex items-center justify-between">
                    <h2 className="text-xl font-light text-black dark:text-white">Activity</h2>
                    <button 
                      onClick={refreshActivity}
                      className="text-zinc-500 text-sm hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
                      disabled={activityLoading}
                    >
                      {activityLoading ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Refreshing...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3" />
                          <span>Refresh</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  <div className="space-y-1 px-2 pb-2">
                    {!isConnected ? (
                      <div className="py-8 text-center text-zinc-500 text-sm">
                        Connect wallet to view activity
                      </div>
                    ) : activityError ? (
                      <div className="py-8 text-center text-red-500 text-sm">
                        {activityError}
                      </div>
                    ) : walletTransactions.length > 0 ? (
                      walletTransactions.map((item) => (
                        <div 
                          key={item.id} 
                          className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group"
                          onClick={() => item.hash && window.open(`${blockExplorerUrl}/tx/${item.hash}`, '_blank')}
                        >
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
                               {item.type === 'transfer' && <ArrowUpRight className="w-5 h-5" />}
                               {item.type === 'contract' && <RefreshCw className="w-4 h-4" />}
                            </div>
                            <div>
                              <p className="text-black dark:text-white font-medium text-sm capitalize">
                                {item.type === 'buy' ? `Bought ${item.assetSymbol}` : 
                                 item.type === 'sell' ? `Sold ${item.assetSymbol}` : 
                                 item.type === 'mint' ? `Minted ${item.assetSymbol}` :
                                 item.type === 'deposit' ? `Received ${item.assetSymbol}` :
                                 item.type === 'withdraw' ? `Sent ${item.assetSymbol}` :
                                 item.type === 'transfer' ? `Transferred ${item.assetSymbol}` :
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
                                  {item.type === 'deposit' || item.type === 'buy' ? '+' : item.type === 'withdraw' || item.type === 'sell' ? '-' : ''}
                                  {item.currency === 'USD' ? '$' : ''}{item.amount.toLocaleString(undefined, { 
                                    minimumFractionDigits: item.currency === currencySymbol ? 4 : 2,
                                    maximumFractionDigits: item.currency === currencySymbol ? 4 : 2
                                  })} {item.currency !== 'USD' ? item.currency : ''}
                                </>
                              ) : (
                                 <span className="text-zinc-500 text-xs">View</span>
                              )}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center text-zinc-500 text-sm">
                        No recent activity
                      </div>
                    )}
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
