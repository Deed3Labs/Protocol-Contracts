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
import { useAppKitAccount } from '@reown/appkit/react';
import { useDeedName } from '@/hooks/useDeedName';
import { usePortfolioHistory } from '@/hooks/usePortfolioHistory';
import { getNetworkByChainId } from '@/config/networks';
import { usePortfolio } from '@/context/PortfolioContext';
import { LargePriceWheel } from './PriceWheel';
import type { MultichainDeedNFT } from '@/hooks/useMultichainDeedNFTs';

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
// Helper function to get asset type label (same as DeedNFTContext)
const getAssetTypeLabel = (assetType: number): string => {
  const types = ["Land", "Vehicle", "Estate", "Commercial Equipment"];
  return types[assetType] || "Unknown";
};

const NFTHoldingItem = ({ holding, deed }: { holding: Holding; deed: MultichainDeedNFT | undefined }) => {
  const deedName = useDeedName(deed || null);
  
  // Truncate text to prevent wrapping (max ~25 chars for main, ~20 for secondary)
  const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };
  
  // Get asset type label for fallback
  const assetTypeLabel = deed?.assetType !== undefined ? getAssetTypeLabel(deed.assetType) : 'T-Deed';
  const fallbackName = `${assetTypeLabel} #${deed?.tokenId || holding.id}`;
  
  // Main text: name from metadata renderer (via useDeedName), fallback to asset type + token ID (same as Explore/DeedCard)
  const mainText = deedName 
    ? truncateText(deedName, 25) 
    : truncateText(fallbackName, 25);
  const mainTextFull = deedName || fallbackName;
  
  // Secondary text: description or configuration, fallback to asset_name
  // Truncate at the end (not beginning) to show start of text
  const secondaryTextRaw = deed?.definition 
    ? deed.definition
    : deed?.configuration
    ? deed.configuration
    : holding.asset_name;
  const secondaryText = truncateText(secondaryTextRaw, 20);
  const secondaryTextFull = secondaryTextRaw;
  
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
            ${(holding.valueUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-zinc-500 text-xs">
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

// Generate chart data from historical portfolio values or show flat line at current value
const generateChartData = (
  range: string, 
  currentValue: number, 
  historicalSnapshots: Array<{ timestamp: number; value: number; date: Date }>
): ChartPoint[] => {
  // If we have historical data, use it
  if (historicalSnapshots.length > 0) {
    const pointsMap: Record<string, number> = { 
      '1D': 48, '1W': 7, '1M': 30, '3M': 90, 
      '6M': 180, 'YTD': 200, '1Y': 365, 'All': 730 
    };
    const targetPoints = pointsMap[range] || 48;
    
    // If we have enough historical data, use it directly
    if (historicalSnapshots.length >= targetPoints) {
      // Sample evenly from historical data
      const step = Math.floor(historicalSnapshots.length / targetPoints);
      const sampled = historicalSnapshots.filter((_, i) => i % step === 0).slice(0, targetPoints);
      
      return sampled.map((snapshot, i) => ({
        time: i,
        value: snapshot.value,
        date: snapshot.date
      }));
    } else {
      // We have some history but not enough - interpolate between known points
      const data: ChartPoint[] = [];
      const startValue = historicalSnapshots[0]?.value || 0;
      const endValue = currentValue;
      
      // Fill in missing points with interpolation
      for (let i = 0; i < targetPoints; i++) {
        const progress = i / (targetPoints - 1);
        const historicalIndex = Math.floor(progress * (historicalSnapshots.length - 1));
        
        if (historicalSnapshots[historicalIndex]) {
          data.push({
            time: i,
            value: historicalSnapshots[historicalIndex].value,
            date: historicalSnapshots[historicalIndex].date
          });
        } else {
          // Interpolate between start and end
          const interpolatedValue = startValue + (endValue - startValue) * progress;
          const timeOffset = (targetPoints - i) * (24 * 60 * 60 * 1000 / targetPoints);
          data.push({
            time: i,
            value: interpolatedValue,
            date: new Date(Date.now() - timeOffset)
          });
        }
      }
      
      return data;
    }
  }
  
  // No historical data - show flat line at current value (or zero if no value)
  // This ensures we don't show mock/fake data on first visit
  const pointsMap: Record<string, number> = { 
    '1D': 48, '1W': 7, '1M': 30, '3M': 90, 
    '6M': 180, 'YTD': 200, '1Y': 365, 'All': 730 
  };
  const points = pointsMap[range] || 48;
  const data: ChartPoint[] = [];
  
  // Use current value (or zero) for all points - flat line
  const value = currentValue || 0;
  
  for (let i = 0; i < points; i++) {
    const timeOffset = (points - i) * (24 * 60 * 60 * 1000 / points);
    data.push({ 
      time: i, 
      value: value, 
      date: new Date(Date.now() - timeOffset) 
    });
  }
  
  return data;
};

export default function BrokerageHome() {
  // Wallet connection
  const { address, isConnected } = useAppKitAccount();
  
  // Global portfolio context - provides balances, holdings, cash balance, and activity
  const {
    balances: multichainBalances,
    totalBalance,
    totalBalanceUSD,
    previousTotalBalanceUSD,
    holdings: portfolioHoldings,
    cashBalance: portfolioCashBalance,
    transactions: walletTransactions,
    isLoading: portfolioLoading,
    refreshAll,
  } = usePortfolio();
  
  // Portfolio history tracking
  const { addSnapshot, getSnapshotsForRange, fetchAndMergeHistory } = usePortfolioHistory();
  
  // Get currency symbol from first available balance (or default to ETH)
  const currencySymbol = useMemo(() => {
    const firstBalance = multichainBalances.find(b => parseFloat(b.balance) > 0);
    return firstBalance?.currencySymbol || 'ETH';
  }, [multichainBalances]);
  
  // Get block explorer URL (use first available chain)
  const blockExplorerUrl = useMemo(() => {
    const firstBalance = multichainBalances.find(b => parseFloat(b.balance) > 0);
    if (firstBalance) {
      const network = getNetworkByChainId(firstBalance.chainId);
      return network?.blockExplorer || 'https://basescan.org';
    }
    return 'https://basescan.org';
  }, [multichainBalances]);
  
  
  const [user, setUser] = useState<User | null>(null);
  const [selectedTab, setSelectedTab] = useState('Return');
  const [selectedRange, setSelectedRange] = useState('1D');
  const [portfolioFilter, setPortfolioFilter] = useState<'All' | 'NFTs' | 'Tokens'>('All');
  const [isPortfolioExpanded, setIsPortfolioExpanded] = useState(false);
  const [showZeroValueAssets, setShowZeroValueAssets] = useState(true); // Show assets with $0 value by default
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  
  // State for tracking scroll position relative to portfolio value header
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  
  // Convert portfolio holdings to Holding format for compatibility
  const allHoldings = useMemo<Holding[]>(() => {
    return portfolioHoldings.map((holding) => {
      const baseHolding: Holding = {
        id: holding.id,
        asset_symbol: holding.asset_symbol,
        asset_name: holding.asset_name,
        quantity: holding.type === 'nft' ? 1 : parseFloat(holding.balance || '0'),
        average_cost: 0,
        current_price: holding.balanceUSD / (holding.type === 'nft' ? 1 : parseFloat(holding.balance || '1')),
        valueUSD: holding.balanceUSD,
        type: holding.type === 'nft' ? 'nft' as const : 'token' as const,
      };
      // Add additional properties if needed
      return baseHolding;
    });
  }, [portfolioHoldings]);

  // Filter holdings based on selected filter and zero value toggle
  const filteredHoldings = useMemo(() => {
    let holdings = allHoldings;
    
    // Apply type filter
    if (portfolioFilter === 'NFTs') {
      holdings = holdings.filter(h => h.type === 'nft');
    } else if (portfolioFilter === 'Tokens') {
      holdings = holdings.filter(h => h.type === 'token');
    }
    
    // Filter by value: Always show NFTs, optionally filter tokens with 0 value
    if (!showZeroValueAssets) {
      holdings = holdings.filter(h => {
        // Always show NFTs regardless of value
        if (h.type === 'nft') return true;
        // For tokens, only show if value > 0
        return (h.valueUSD || 0) > 0;
      });
    }
    
    return holdings;
  }, [allHoldings, portfolioFilter, showZeroValueAssets]);

  // Limit displayed holdings when not expanded
  const displayedHoldings = useMemo(() => {
    if (isPortfolioExpanded) return filteredHoldings;
    return filteredHoldings.slice(0, 5); // Show 5 holdings initially
  }, [filteredHoldings, isPortfolioExpanded]);
  
  // Debug: Verify data is being fetched (remove in production)
  useEffect(() => {
    if (isConnected && address) {
      const nftHoldings = portfolioHoldings.filter(h => h.type === 'nft');
      const tokenHoldings = portfolioHoldings.filter(h => h.type === 'token');
      console.log('[BrokerageHome] Data check:', {
        balancesCount: multichainBalances.length,
        totalBalanceUSD,
        portfolioHoldingsCount: portfolioHoldings.length,
        nftHoldingsCount: nftHoldings.length,
        tokenHoldingsCount: tokenHoldings.length,
        nftHoldings: nftHoldings.map(h => ({ id: h.id, name: h.asset_name, chain: h.chainName })),
        allHoldingsCount: allHoldings.length,
        filteredHoldingsCount: filteredHoldings.length,
        displayedHoldingsCount: displayedHoldings.length,
        displayedNFTs: displayedHoldings.filter(h => h.type === 'nft').length,
        displayedTokens: displayedHoldings.filter(h => h.type === 'token').length,
      });
    }
  }, [isConnected, address, multichainBalances, totalBalanceUSD, portfolioHoldings, allHoldings, filteredHoldings, displayedHoldings]);
  
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
  
  // Cash balance is automatically calculated from stablecoin holdings in PortfolioContext
  const cashBalance = portfolioCashBalance?.totalCash || 0;
  
  // Calculate total value from wallet balance and holdings across all chains
  const totalValue = useMemo(() => {
    if (!isConnected) return 0;
    
    // Calculate holdings value (tokens + NFTs)
    const holdingsValue = allHoldings.reduce((sum, h) => sum + (h.valueUSD || 0), 0);
    
    // Total portfolio value = aggregated wallet balance + holdings
    return totalBalanceUSD + holdingsValue;
  }, [isConnected, totalBalanceUSD, allHoldings]);
  
  // Track portfolio value history
  useEffect(() => {
    if (isConnected && totalValue > 0) {
      addSnapshot(totalValue);
    }
  }, [isConnected, totalValue, addSnapshot]);
  
  // Fetch historical portfolio data from blockchain transactions
  useEffect(() => {
    if (isConnected && address && walletTransactions.length > 0 && totalValue > 0) {
      // Fetch and merge historical data from transactions
      fetchAndMergeHistory(
        address,
        walletTransactions.map(tx => ({
          timestamp: tx.timestamp,
          date: tx.date,
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency
        })),
        totalValue
      );
    }
  }, [isConnected, address, walletTransactions, totalValue, fetchAndMergeHistory]);
  
  // Generate chart data from historical snapshots or current value
  const chartData = useMemo(() => {
    const historicalSnapshots = getSnapshotsForRange(selectedRange, totalValue);
    return generateChartData(selectedRange, totalValue, historicalSnapshots);
  }, [selectedRange, totalValue, getSnapshotsForRange]);
  
  // Calculate dynamic change stats based on chart data (real returns)
  const { dailyChange, dailyChangePercent, isNegative } = useMemo(() => {
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
  }, [chartData]);
  
  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    // Chart data will be regenerated automatically via useMemo
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
            holdings={allHoldings}
            balanceUSD={cashBalance}
          />
        );
      case 'Income':
        return <IncomeView totalValue={totalValue} transactions={walletTransactions} />;
      case 'Account value':
        return (
          <AccountValueView 
            chartData={chartData}
            selectedRange={selectedRange}
            onRangeChange={handleRangeChange}
            totalValue={totalValue}
            balanceUSD={cashBalance}
            holdings={allHoldings}
          />
        );
      case 'Allocations':
        return <AllocationView totalValue={totalValue} holdings={allHoldings} balanceUSD={cashBalance} />;
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
      />

      {/* Action Modal */}
      <ActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
      />
      
      {/* Header */}
      <HeaderNav
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
                     <span className="text-sm font-medium">Cash Balance</span>
                     <div className="group relative">
                        <Info className="h-4 w-4 cursor-help" />
                        <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          Stablecoins only (USDC priority)
                        </div>
                     </div>
                     {!isConnected && (
                       <span className="text-xs text-amber-500">Connect wallet to view balance</span>
                     )}
                     {isConnected && multichainBalances.length > 1 && (
                       <span className="text-xs text-zinc-400">Across {multichainBalances.length} networks</span>
                     )}
                   </div>
                   <div className="min-h-[60px] flex items-center">
                     <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                       {isConnected ? (
                         <>
                           <LargePriceWheel 
                             value={cashBalance || 0} 
                             previousValue={previousTotalBalanceUSD}
                             className="font-light"
                           />
                           <span className="text-lg text-zinc-500 font-normal">USD</span>
                         </>
                       ) : (
                         <>
                           $0.00
                           <span className="text-lg text-zinc-500 font-normal">USD</span>
                         </>
                       )}
                     </h1>
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
                        disabled={!isConnected || parseFloat(totalBalance) === 0}
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
                  
                  {/* Filter Pills and Zero Value Toggle */}
                  <div className="px-4 mb-2 space-y-2">
                    <div className="flex gap-2">
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
                    
                    {/* Zero Value Assets Toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowZeroValueAssets(!showZeroValueAssets)}
                        className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-all ${
                          showZeroValueAssets
                            ? 'text-zinc-700 dark:text-zinc-300'
                            : 'text-zinc-500 dark:text-zinc-500'
                        }`}
                        title={showZeroValueAssets ? 'Hide assets with $0 value' : 'Show assets with $0 value'}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                          showZeroValueAssets
                            ? 'border-zinc-700 dark:border-zinc-300 bg-zinc-700 dark:bg-zinc-300'
                            : 'border-zinc-400 dark:border-zinc-600'
                        }`}>
                          {showZeroValueAssets && (
                            <svg className="w-3 h-3 text-white dark:text-zinc-900" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xs">Show $0 assets</span>
                      </button>
                    </div>
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
                              // Extract tokenId and chainId from holding id format: "{chainId}-nft-{tokenId}"
                              const parts = holding.id.toString().split('-');
                              let tokenId: string | undefined;
                              let chainId: number | undefined;
                              
                              if (parts.length >= 3 && parts[1] === 'nft') {
                                chainId = parseInt(parts[0]);
                                tokenId = parts.slice(2).join('-');
                              }
                              
                              // Get the full deed data from portfolio holdings (includes all properties from multichainNFTs)
                              const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && h.type === 'nft');
                              const deed: MultichainDeedNFT | undefined = portfolioHolding && tokenId && chainId ? ({
                                tokenId: (portfolioHolding.tokenId as string) || tokenId,
                                chainId: portfolioHolding.chainId || chainId,
                                chainName: portfolioHolding.chainName || getNetworkByChainId(chainId)?.name || '',
                                owner: (portfolioHolding.owner as string) || address || '',
                                assetType: (portfolioHolding.assetType as number) || 0,
                                uri: (portfolioHolding.uri as string) || '',
                                definition: (portfolioHolding.definition as string) || holding.asset_name,
                                configuration: (portfolioHolding.configuration as string) || '',
                                validatorAddress: (portfolioHolding.validatorAddress as string) || '',
                                token: (portfolioHolding.token as string) || '',
                                salt: (portfolioHolding.salt as string) || '',
                                isMinted: true,
                              } as unknown as MultichainDeedNFT) : undefined;
                              
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
                      onClick={refreshAll}
                      className="text-zinc-500 text-sm hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
                      disabled={portfolioLoading}
                    >
                      {portfolioLoading ? (
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
                    ) : walletTransactions.length > 0 ? (
                      walletTransactions.map((item) => (
                        <div 
                          key={item.id} 
                          className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group"
                          onClick={() => {
                            if (item.hash) {
                              // Get the correct block explorer URL for this transaction's chain
                              const txChainId = 'chainId' in item && typeof item.chainId === 'number' ? item.chainId : undefined;
                              let explorerUrl = blockExplorerUrl;
                              if (txChainId) {
                                const network = getNetworkByChainId(txChainId);
                                explorerUrl = network?.blockExplorer || blockExplorerUrl;
                              }
                              window.open(`${explorerUrl}/tx/${item.hash}`, '_blank');
                            }
                          }}
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
                                <span className="capitalize">{item.status || 'completed'}</span>
                                {(() => {
                                  if ('chainName' in item && item.chainName && typeof item.chainName === 'string') {
                                    return (
                                      <>
                                        <span className="w-0.5 h-0.5 bg-zinc-400 dark:bg-zinc-600 rounded-full"></span>
                                        <span>{String(item.chainName)}</span>
                                      </>
                                    );
                                  }
                                  return null;
                                })()}
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
