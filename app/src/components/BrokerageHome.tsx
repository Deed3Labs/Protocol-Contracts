import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Info, ArrowUpRight, ArrowDownLeft, CheckCircle2, RefreshCw, Loader2, Landmark } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ReturnView, IncomeView, AccountValueView, AllocationView } from './portfolio/TabViews';
import SideMenu from './portfolio/SideMenu';
import HeaderNav from './portfolio/HeaderNav';
import MobileNav from './portfolio/MobileNav';
import DepositModal from './portfolio/DepositModal';
import WithdrawModal from './portfolio/WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import CTAStack from './portfolio/CTAStack';
import { SpendTracker } from './portfolio/SpendTracker';
import { UpcomingTransactions } from './portfolio/UpcomingTransactions';
import { BudgetTracker } from './portfolio/BudgetTracker';
import { useAppKitAccount } from '@reown/appkit/react';
import { useDeedName } from '@/hooks/useDeedName';
import { usePortfolioHistory } from '@/hooks/usePortfolioHistory';
import { getNetworkByChainId } from '@/config/networks';
import { usePortfolio } from '@/context/PortfolioContext';
import { useBankBalance } from '@/hooks/useBankBalance';
import { LargePriceWheel } from './PriceWheel';
import type { MultichainDeedNFT } from '@/hooks/useMultichainDeedNFTs';
import type { BankAccountBalance } from '@/utils/apiClient';

// Types
interface Holding {
  id: string | number;
  asset_symbol: string;
  asset_name: string;
  quantity: number;
  average_cost: number;
  current_price: number;
  valueUSD?: number; // USD value for sorting/filtering
  type: 'equity' | 'nft' | 'rwa' | 'token' | 'crypto';
}

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}

const formatCompactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toString();
};

// Transaction type is now imported from useWalletActivity

// Component to display NFT holding with name from metadata
// Helper function to get asset type label (same as DeedNFTContext)
const getAssetTypeLabel = (assetType: number): string => {
  const types = ["Land", "Vehicle", "Estate", "Commercial Equipment"];
  return types[assetType] || "Unknown";
};

// Helper function to get asset color based on symbol
const getAssetColor = (symbol: string): string => {
  const colors: Record<string, string> = {
    BTC: "bg-orange-500",
    ETH: "bg-blue-500",
    SOL: "bg-gradient-to-r from-purple-500 to-cyan-400",
    USDC: "bg-blue-600",
    USDT: "bg-green-600",
    DAI: "bg-yellow-500",
  };
  return colors[symbol.toUpperCase()] || "bg-zinc-500";
};

// Helper function to convert Holding to Asset format for TradeModal
const holdingToAsset = (holding: Holding, portfolioHolding?: any): { symbol: string; name: string; color: string; balance?: number; balanceUSD?: number; type?: 'token' | 'nft' | 'rwa'; chainId?: number; chainName?: string } => {
  return {
    symbol: holding.asset_symbol,
    name: holding.asset_name,
    color: getAssetColor(holding.asset_symbol),
    balance: holding.quantity,
    balanceUSD: holding.valueUSD,
    type: holding.type === 'token' ? 'token' : holding.type === 'rwa' ? 'rwa' : 'nft',
    chainId: portfolioHolding?.chainId,
    chainName: portfolioHolding?.chainName,
  };
};

// Helper component to render expanded holding details
const ExpandedHoldingDetails = ({ 
  holding, 
  holdingsTotal,
  onBuy,
  onSell
}: { 
  holding: Holding; 
  holdingsTotal: number;
  onBuy?: () => void;
  onSell?: () => void;
}) => {
  const currentValue = holding.valueUSD || 0;
  const totalCost = holding.average_cost * holding.quantity;
  const unrealizedReturn = currentValue - totalCost;
  const unrealizedReturnPercent = totalCost > 0 ? (unrealizedReturn / totalCost) * 100 : 0;
  const portfolioWeighting = holdingsTotal > 0 ? (currentValue / holdingsTotal) * 100 : 0;
  const currentPrice = holding.current_price || 0;
  const averageCostBasis = holding.average_cost || 0;

  return (
    <div className="px-3 pb-3 space-y-2.5 border-t border-zinc-200 dark:border-zinc-800 mt-2 pt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Current value</span>
        <span className="text-black dark:text-white font-medium">
          ${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">Total cost</span>
          <div className="group relative">
            <Info className="h-3 w-3 cursor-help text-zinc-400 dark:text-zinc-500" />
            <div className="absolute left-0 top-5 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
              Total amount paid for this holding
            </div>
          </div>
        </div>
        <span className="text-black dark:text-white font-medium">
          ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">Unrealized return</span>
          <div className="group relative">
            <Info className="h-3 w-3 cursor-help text-zinc-400 dark:text-zinc-500" />
            <div className="absolute left-0 top-5 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
              Profit or loss not yet realized from sale
            </div>
          </div>
        </div>
        <span className={`font-medium ${unrealizedReturn >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
          ${unrealizedReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({unrealizedReturnPercent >= 0 ? '+' : ''}{unrealizedReturnPercent.toFixed(2)}%)
        </span>
      </div>
      
      {/* Divider */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 my-2"></div>
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Current quantity</span>
        <span className="text-black dark:text-white font-medium">
          {holding.quantity.toLocaleString('en-US', { 
            minimumFractionDigits: holding.quantity < 1 ? 4 : 2,
            maximumFractionDigits: holding.quantity < 1 ? 4 : 2
          })} {holding.type === 'token' ? holding.asset_symbol : 'items'}
        </span>
      </div>
      {holding.type === 'token' && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">Current price</span>
            <span className="text-black dark:text-white font-medium">
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 dark:text-zinc-400">Average cost basis</span>
              <div className="group relative">
                <Info className="h-3 w-3 cursor-help text-zinc-400 dark:text-zinc-500" />
                <div className="absolute left-0 top-5 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  Average price paid per unit
                </div>
              </div>
            </div>
            <span className="text-black dark:text-white font-medium">
              ${averageCostBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/{holding.type === 'token' ? holding.asset_symbol : 'item'}
            </span>
          </div>
        </>
      )}
      
      {/* Divider */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 my-2"></div>
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Portfolio weighting</span>
        <span className="text-black dark:text-white font-medium">
          {portfolioWeighting.toFixed(2)}% of portfolio
        </span>
      </div>
      
      {/* Divider above action buttons */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 my-2"></div>
      
      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button 
          onClick={onBuy}
          className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10"
        >
          Buy
        </button>
        <button 
          onClick={onSell}
          className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10"
        >
          Sell
        </button>
        <button className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10 flex items-center justify-center gap-1">
          More
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

/** Renders the main cash balance from PortfolioContext. Subscribes directly to context so it stays in sync when balance updates (e.g. after deposit) without requiring a page switch. */
function PortfolioCashBalanceBlock({
  isConnected,
  multichainBalancesLength,
  onDeposit,
  onWithdraw,
  totalBalance,
}: {
  isConnected: boolean;
  multichainBalancesLength: number;
  onDeposit: () => void;
  onWithdraw: () => void;
  totalBalance: string;
}) {
  const { cashBalance: portfolioCashBalance, previousTotalBalanceUSD } = usePortfolio();
  const cashBalance = portfolioCashBalance?.totalCash || 0;
  const bankLinked = portfolioCashBalance?.bankLinked ?? false;
  const cashBalanceTooltip = bankLinked
    ? 'Stablecoins (USDC priority) plus linked bank accounts'
    : 'Stablecoins only (USDC priority)';
  return (
    <div>
      <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
        <span className="text-sm font-medium">Cash Balance</span>
        <div className="group relative">
          <Info className="h-4 w-4 cursor-help" />
          <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
            {cashBalanceTooltip}
          </div>
        </div>
        {!isConnected && (
          <span className="text-xs text-amber-500">Connect wallet to view balance</span>
        )}
        {isConnected && multichainBalancesLength > 1 && (
          <span className="text-xs text-zinc-400">Across {multichainBalancesLength} networks</span>
        )}
      </div>
      <div className="min-h-[60px] flex items-center">
        <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
          {isConnected ? (
            <>
              <LargePriceWheel
                key={`cash-balance-${cashBalance}`}
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
          onClick={onDeposit}
          className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
        >
          <ArrowUpRight className="w-4 h-4" />
          Add Funds
        </button>
        <button
          onClick={onWithdraw}
          className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800"
          disabled={!isConnected || parseFloat(totalBalance) === 0}
        >
          Withdraw Funds
        </button>
      </div>
    </div>
  );
}

const NFTHoldingItem = ({ 
  holding, 
  deed, 
  chainId, 
  chainName, 
  isExpanded, 
  onToggle, 
  holdingsTotal,
  onBuy,
  onSell
}: { 
  holding: Holding; 
  deed: MultichainDeedNFT | undefined; 
  chainId?: number; 
  chainName?: string;
  isExpanded: boolean;
  onToggle: () => void;
  holdingsTotal: number;
  onBuy?: () => void;
  onSell?: () => void;
}) => {
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
  
  // Get chain display name: prefer chainName, fallback to network name from chainId, then chainId itself
  const displayChainName = chainName || (chainId ? getNetworkByChainId(chainId)?.name : null) || (chainId ? `Chain ${chainId}` : null) || (deed?.chainName || (deed?.chainId ? getNetworkByChainId(deed.chainId)?.name : null) || (deed?.chainId ? `Chain ${deed.chainId}` : null));
  
  return (
    <div className="rounded-lg transition-colors">
      <div 
        onClick={onToggle}
        className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 rounded-full flex items-center justify-center shrink-0 transition-colors">
            <span className="font-bold text-xs text-black dark:text-white">N</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-black dark:text-white font-medium text-sm truncate" title={mainTextFull}>{mainText}</p>
              {displayChainName && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-500 bg-transparent font-normal leading-tight">
                  {displayChainName}
                </Badge>
              )}
            </div>
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
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="expanded-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <ExpandedHoldingDetails 
              holding={holding} 
              holdingsTotal={holdingsTotal}
              onBuy={onBuy}
              onSell={onSell}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
    totalBalanceUSD,
    holdings: portfolioHoldings,
    cashBalance: portfolioCashBalance,
    transactions: walletTransactions,
    isLoading: portfolioLoading,
    refreshAll,
  } = usePortfolio();

  // Linked bank/investment accounts (Plaid)
  const {
    accounts: bankAccounts,
    linked: bankLinked,
    isLoading: bankAccountsLoading,
    refresh: refreshBankAccounts,
  } = useBankBalance(address ?? undefined);
  
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
  
  
  // User data is now derived globally in GlobalModalsContext
  const [selectedTab, setSelectedTab] = useState('Return');
  const [selectedRange, setSelectedRange] = useState('1D');
  const [portfolioFilter, setPortfolioFilter] = useState<'All' | 'RWAs' | 'NFTs' | 'Tokens'>('All');
  const [isPortfolioExpanded, setIsPortfolioExpanded] = useState(false);
  const [showZeroValueAssets, setShowZeroValueAssets] = useState(false); // Hide assets with $0 value by default
  const [expandedHoldings, setExpandedHoldings] = useState<Set<string | number>>(new Set()); // Track which holdings are expanded
  const [activityFilter, setActivityFilter] = useState<
    'All' | 'Deposits' | 'Withdrawals' | 'Buys' | 'Sells' | 'Mints' | 'Transfers' | 'Trades' | 'Other'
  >('All');
  const [activitySort, setActivitySort] = useState<'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow'>('Newest');
  const [activityChainFilter, setActivityChainFilter] = useState<'All' | string>('All');
  const [activityVisibleCount, setActivityVisibleCount] = useState(7);
  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositInitialOption, setDepositInitialOption] = useState<'bank' | 'card' | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [isAccountsExpanded, setIsAccountsExpanded] = useState(false);
  const [accountSort, setAccountSort] = useState<'Balance (high)' | 'Balance (low)' | 'Name (A–Z)'>('Balance (high)');
  const { setActionModalOpen, openTradeModal } = useGlobalModals();
  
  // State for tracking scroll position relative to portfolio value header
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  
  // Convert portfolio holdings to Holding format for compatibility
  const allHoldings = useMemo<Holding[]>(() => {
    return portfolioHoldings.map((holding) => {
      // Type guard to check if holding is NFT or RWA
      // Use type assertion to help TypeScript understand the union type
      const holdingType = holding.type as 'nft' | 'rwa' | 'token';
      const isNFTOrRWA = holdingType === 'nft' || holdingType === 'rwa';
      
      // Map UnifiedHolding type to Holding type
      let mappedType: Holding['type'];
      if (holdingType === 'rwa') {
        mappedType = 'rwa';
      } else if (holdingType === 'nft') {
        mappedType = 'nft';
      } else {
        mappedType = 'token';
      }
      
      const baseHolding: Holding = {
        id: holding.id,
        asset_symbol: holding.asset_symbol,
        asset_name: holding.asset_name,
        quantity: isNFTOrRWA ? 1 : parseFloat(holding.balance || '0'),
        average_cost: 0,
        current_price: holding.balanceUSD / (isNFTOrRWA ? 1 : parseFloat(holding.balance || '1')),
        valueUSD: holding.balanceUSD,
        type: mappedType,
      };
      // Add additional properties if needed
      return baseHolding;
    });
  }, [portfolioHoldings]);

  // Filter holdings based on selected filter and zero value toggle
  const filteredHoldings = useMemo(() => {
    let holdings = allHoldings;
    
    // Apply type filter
    if (portfolioFilter === 'RWAs') {
      holdings = holdings.filter(h => h.type === 'rwa'); // T-Deeds (Real World Assets)
    } else if (portfolioFilter === 'NFTs') {
      holdings = holdings.filter(h => h.type === 'nft'); // General NFTs
    } else if (portfolioFilter === 'Tokens') {
      holdings = holdings.filter(h => h.type === 'token');
    }
    
    // Filter by value: Always show NFTs and RWAs, optionally filter tokens with 0 value
    if (!showZeroValueAssets) {
      holdings = holdings.filter(h => {
        // Always show NFTs and RWAs regardless of value
        if (h.type === 'nft' || h.type === 'rwa') return true;
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

  // Sorted and displayed linked bank/investment accounts
  const sortedBankAccounts = useMemo(() => {
    const list = [...bankAccounts];
    const getBalance = (a: BankAccountBalance) => (a.current ?? a.available ?? 0);
    list.sort((a, b) => {
      if (accountSort === 'Name (A–Z)') {
        return (a.name || '').localeCompare(b.name || '');
      }
      const va = getBalance(a);
      const vb = getBalance(b);
      return accountSort === 'Balance (high)' ? vb - va : va - vb;
    });
    return list;
  }, [bankAccounts, accountSort]);

  const displayedBankAccounts = useMemo(() => {
    if (isAccountsExpanded) return sortedBankAccounts;
    return sortedBankAccounts.slice(0, 5);
  }, [sortedBankAccounts, isAccountsExpanded]);

  const activityTransactions = useMemo(() => {
    const getTxTimeMs = (tx: any): number => {
      if (tx?.timestamp) {
        const t = new Date(tx.timestamp).getTime();
        if (!Number.isNaN(t)) return t;
      }
      const parsed = Date.parse(tx?.date);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const filtered = walletTransactions.filter((tx) => {
      const type = String((tx as any)?.type || '').toLowerCase();
      const chainName = (tx as any)?.chainName ? String((tx as any).chainName) : '';
      const chainId =
        typeof (tx as any)?.chainId === 'number' ? String((tx as any).chainId) : (tx as any)?.chainId ? String((tx as any).chainId) : '';

      if (activityChainFilter !== 'All') {
        // Prefer matching by chainName if present, otherwise fall back to chainId string match
        const matchesChain =
          (chainName && chainName === activityChainFilter) ||
          (!chainName && chainId && chainId === activityChainFilter) ||
          (chainId && chainId === activityChainFilter);
        if (!matchesChain) return false;
      }

      switch (activityFilter) {
        case 'Deposits':
          return type === 'deposit';
        case 'Withdrawals':
          return type === 'withdraw';
        case 'Buys':
          return type === 'buy';
        case 'Sells':
          return type === 'sell';
        case 'Mints':
          return type === 'mint';
        case 'Transfers':
          return type === 'transfer';
        case 'Trades':
          return type === 'trade';
        case 'Other':
          return !['deposit', 'withdraw', 'buy', 'sell', 'mint', 'transfer', 'trade'].includes(type);
        case 'All':
        default:
          return true;
      }
    });

    const sorted = [...filtered].sort((a, b) => {
      const aAny = a as any;
      const bAny = b as any;
      const aTime = getTxTimeMs(aAny);
      const bTime = getTxTimeMs(bAny);
      const aAmt = Math.abs(Number(aAny?.amount || 0));
      const bAmt = Math.abs(Number(bAny?.amount || 0));

      switch (activitySort) {
        case 'Oldest':
          return aTime - bTime;
        case 'AmountHigh':
          return bAmt - aAmt;
        case 'AmountLow':
          return aAmt - bAmt;
        case 'Newest':
        default:
          return bTime - aTime;
      }
    });

    return sorted;
  }, [walletTransactions, activityFilter, activitySort, activityChainFilter]);

  const activityChains = useMemo(() => {
    // Unique list of available chains from the raw walletTransactions
    const names = new Set<string>();
    const ids = new Set<string>();

    for (const tx of walletTransactions as any[]) {
      if (tx?.chainName) names.add(String(tx.chainName));
      if (typeof tx?.chainId === 'number') ids.add(String(tx.chainId));
      else if (tx?.chainId) ids.add(String(tx.chainId));
    }

    const nameList = Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const idList = Array.from(ids).filter(Boolean).sort((a, b) => Number(a) - Number(b));

    // Prefer human-readable chainName entries; include chainId entries too for cases where name isn't present.
    // De-dupe by keeping both if they are different strings.
    return [...nameList, ...idList.filter((id) => !names.has(id))];
  }, [walletTransactions]);

  const displayedActivityTransactions = useMemo(() => {
    return activityTransactions.slice(0, activityVisibleCount);
  }, [activityTransactions, activityVisibleCount]);

  useEffect(() => {
    setActivityVisibleCount(7);
  }, [activityFilter, activitySort, activityChainFilter, isConnected, address]);
  
  // Debug: Verify data is being fetched (remove in production)
  useEffect(() => {
    if (isConnected && address) {
      const rwaHoldings = portfolioHoldings.filter(h => h.type === 'rwa' as any);
      const nftHoldings = portfolioHoldings.filter(h => h.type === 'nft' as any);
      const tokenHoldings = portfolioHoldings.filter(h => h.type === 'token');
      console.log('[BrokerageHome] Data check:', {
        balancesCount: multichainBalances.length,
        totalBalanceUSD,
        portfolioHoldingsCount: portfolioHoldings.length,
        rwaHoldingsCount: rwaHoldings.length,
        nftHoldingsCount: nftHoldings.length,
        tokenHoldingsCount: tokenHoldings.length,
        rwaHoldings: (rwaHoldings as any[]).map((h: any) => ({ id: h.id, name: h.asset_name, chain: h.chainName })),
        nftHoldings: (nftHoldings as any[]).map((h: any) => ({ id: h.id, name: h.asset_name, chain: h.chainName })),
        allHoldingsCount: allHoldings.length,
        filteredHoldingsCount: filteredHoldings.length,
        displayedHoldingsCount: displayedHoldings.length,
        displayedRWAs: displayedHoldings.filter(h => h.type === 'rwa').length,
        displayedNFTs: displayedHoldings.filter(h => h.type === 'nft').length,
        displayedTokens: displayedHoldings.filter(h => h.type === 'token').length,
      });
    }
  }, [isConnected, address, multichainBalances, totalBalanceUSD, portfolioHoldings, allHoldings, filteredHoldings, displayedHoldings]);
  
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
  // Note: We read cashBalance from context here for use in tabs/holdings; the main hero
  // balance uses PortfolioCashBalanceBlock so it stays in sync when context updates.
  const cashBalance = portfolioCashBalance?.totalCash || 0;
  
  // Calculate holdings-only total (for portfolio weighting)
  const holdingsTotal = useMemo(() => {
    if (!isConnected) return 0;
    return allHoldings.reduce((sum, h) => sum + (h.valueUSD || 0), 0);
  }, [isConnected, allHoldings]);
  
  // Calculate total value from wallet balance and holdings across all chains
  const totalValue = useMemo(() => {
    if (!isConnected) return 0;
    
    // Total portfolio value = aggregated wallet balance + holdings
    return totalBalanceUSD + holdingsTotal;
  }, [isConnected, totalBalanceUSD, holdingsTotal]);
  
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
      />
      
      {/* Deposit Modal */}
      <DepositModal 
        isOpen={depositModalOpen} 
        onClose={() => { setDepositModalOpen(false); setDepositInitialOption(null); }} 
        initialOption={depositInitialOption}
        onLinkSuccess={refreshBankAccounts}
      />

      {/* Withdraw Modal */}
      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
      />

      {/* ActionModal and TradeModal are now global - rendered in AppLayout */}
      
      {/* Header */}
      <HeaderNav
        isScrolledPast={isScrolledPast}
        onMenuOpen={() => setMenuOpen(true)}
        onActionOpen={() => setActionModalOpen(true)}
      />
      
      {/* Main Content */}
      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32">
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
           {/* Left Column (Chart & Main Data) */}
           <div className="md:col-span-8 space-y-10">
              {/* Persistent Portfolio Value & Subheader - uses direct context consumer so balance stays in sync */}
              <PortfolioCashBalanceBlock
                isConnected={isConnected}
                multichainBalancesLength={multichainBalances.length}
                onDeposit={() => setDepositModalOpen(true)}
                onWithdraw={() => setWithdrawModalOpen(true)}
                totalBalance={String(portfolioCashBalance?.totalCash ?? 0)}
              />
              
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

              {/* 2x1 Grid: Spend / Calendar row + Budget row; column and row gaps match */}
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Row 1 - Col 1: Spend Tracker */}
                  <SpendTracker />
                  {/* Row 1 - Col 2: Upcoming Transactions (Subscriptions Tracker) */}
                  <UpcomingTransactions />
                </div>
                {/* Row 2: Budget Tracker */}
                <BudgetTracker />
              </div>
           </div>

           {/* Right Column (Sidebar Widgets) */}
           <div className="md:col-span-4 space-y-6">
              {/* CTA Stack - Persistent */}
              <CTAStack />

              {/* Linked Accounts – Bank & investment accounts (same rounded, flat, border-only as Portfolio) */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4">
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <div className="w-9 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                        <Landmark className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                      </div>
                      <div>
                        <h2 className="text-base font-medium text-black dark:text-white">Linked Accounts</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Bank & investment accounts</p>
                      </div>
                    </div>
                    {bankLinked && bankAccounts.length > 0 && (
                      <div className="flex items-center justify-between gap-2 mt-3">
                        <Select
                          value={accountSort}
                          onValueChange={(value: 'Balance (high)' | 'Balance (low)' | 'Name (A–Z)') => setAccountSort(value)}
                        >
                          <SelectTrigger size="xs" className="w-28 sm:w-32 text-xs font-normal text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                            <SelectValue placeholder="Sort by" />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg z-50">
                            <SelectItem value="Balance (high)" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Balance (high → low)</SelectItem>
                            <SelectItem value="Balance (low)" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Balance (low → high)</SelectItem>
                            <SelectItem value="Name (A–Z)" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Name (A–Z)</SelectItem>
                          </SelectContent>
                        </Select>
                        <button
                          onClick={() => refreshBankAccounts()}
                          className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          disabled={bankAccountsLoading}
                        >
                          {bankAccountsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Refresh
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="px-3 pb-3">
                    {!isConnected ? (
                      <div className="py-8 text-center text-zinc-500 text-sm rounded-full border border-dashed border-zinc-200 dark:border-zinc-800">
                        Connect wallet to view linked accounts
                      </div>
                    ) : bankAccountsLoading && bankAccounts.length === 0 ? (
                      <div className="py-8 flex items-center justify-center gap-2 text-zinc-500 text-sm rounded-lg">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading accounts...
                      </div>
                    ) : !bankLinked || bankAccounts.length === 0 ? (
                      <div className="py-8 text-center space-y-4 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
                        <p className="text-zinc-500 text-sm">No linked bank or investment accounts yet</p>
                        <button
                          onClick={() => { setDepositInitialOption('bank'); setDepositModalOpen(true); }}
                          className="inline-flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-sm font-medium py-2.5 px-4 rounded-full hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors border border-zinc-800 dark:border-zinc-200"
                        >
                          <Landmark className="w-4 h-4" />
                          Link account
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-3">
                          {displayedBankAccounts.map((account) => {
                            const balance = account.current ?? account.available ?? 0;
                            const displayName = account.name || 'Account';
                            const maskText = account.mask ? `•••• ${account.mask}` : '';

                            return (
                              <div
                                key={account.account_id}
                                className="rounded-md border border-zinc-200 dark:border-zinc-800/50 bg-white dark:bg-zinc-900/30 p-3"
                              >
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                                      <Landmark className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-black dark:text-white font-medium text-sm truncate">{displayName}</p>
                                      {maskText ? <p className="text-zinc-500 dark:text-zinc-400 text-xs">{maskText}</p> : null}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-black dark:text-white font-semibold text-sm">
                                      ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                    {account.available != null && account.current !== account.available && (
                                      <p className="text-zinc-500 dark:text-zinc-400 text-xs">Available: ${(account.available ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                                  <button
                                    onClick={() => setDepositModalOpen(true)}
                                    className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10"
                                  >
                                    Deposit
                                  </button>
                                  <button
                                    onClick={() => setWithdrawModalOpen(true)}
                                    className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10"
                                  >
                                    Withdraw
                                  </button>
                                  <button
                                    onClick={() => { setDepositInitialOption('bank'); setDepositModalOpen(true); }}
                                    className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white text-xs font-medium py-2 px-3 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-white/10"
                                  >
                                    Manage
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {sortedBankAccounts.length > 5 && (
                          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                            <button
                              onClick={() => setIsAccountsExpanded(!isAccountsExpanded)}
                              className="w-full text-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-2"
                            >
                              {isAccountsExpanded
                                ? `Show less (${sortedBankAccounts.length} accounts)`
                                : `View all (${sortedBankAccounts.length} accounts)`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
              </div>
              
              {/* Portfolio Section - Persistent */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4 flex items-center justify-between">
                    <h2 className="text-lg font-medium text-black dark:text-white">Portfolio</h2>
                    <button className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 text-xs font-normal border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      1D return
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Filter Selector and Zero Value Toggle */}
                  <div className="px-3 mb-2">
                    <div className="flex items-center justify-between gap-2">
                      {/* Single Filter Selector */}
                      <Select 
                        value={portfolioFilter} 
                        onValueChange={(value: 'All' | 'RWAs' | 'NFTs' | 'Tokens') => setPortfolioFilter(value)}
                      >
                        <SelectTrigger size="xs" className="w-24 sm:w-28 text-xs font-normal text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                          <SelectValue placeholder="Filter" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-50">
                          <SelectItem value="All" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">All</SelectItem>
                          <SelectItem value="Tokens" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Tokens</SelectItem>
                          <SelectItem value="RWAs" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">RWAs</SelectItem>
                          <SelectItem value="NFTs" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">NFTs</SelectItem>
                        </SelectContent>
                      </Select>
                      
                      {/* Zero Value Assets Toggle Switch */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500 dark:text-zinc-500">Show $0 assets</span>
                        <button
                          onClick={() => setShowZeroValueAssets(!showZeroValueAssets)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 ${
                            showZeroValueAssets
                              ? 'bg-zinc-900 dark:bg-zinc-700'
                              : 'bg-zinc-300 dark:bg-zinc-600'
                          }`}
                          role="switch"
                          aria-checked={showZeroValueAssets}
                          title={showZeroValueAssets ? 'Hide assets with $0 value' : 'Show assets with $0 value'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              showZeroValueAssets ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
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
                          // Handle both RWAs (T-Deeds) and general NFTs separately
                          const rwaHoldingsWithDeeds = displayedHoldings
                            .filter(h => h.type === 'rwa')
                            .map(holding => {
                              // Extract tokenId and chainId from holding id format: "{chainId}-rwa-{tokenId}"
                              const parts = holding.id.toString().split('-');
                              let tokenId: string | undefined;
                              let chainId: number | undefined;
                              
                              if (parts.length >= 3 && parts[1] === 'rwa') {
                                chainId = parseInt(parts[0]);
                                tokenId = parts.slice(2).join('-');
                              }
                              
                              // Get the full deed data from portfolio holdings (includes all properties from multichainNFTs)
                              const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && (h.type as string) === 'rwa');
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
                              
                              return { holding, deed, chainId: portfolioHolding?.chainId || chainId, chainName: portfolioHolding?.chainName };
                            });
                          // General NFTs (for future expansion - currently empty)
                          const nftHoldingsWithDeeds = displayedHoldings
                            .filter(h => h.type === 'nft')
                            .map(holding => {
                              // For general NFTs, we don't have DeedNFT data yet
                              const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && (h.type as string) === 'nft');
                              return { 
                                holding, 
                                deed: undefined as MultichainDeedNFT | undefined,
                                chainId: portfolioHolding?.chainId,
                                chainName: portfolioHolding?.chainName
                              };
                            });
                          
                          const tokenHoldings = displayedHoldings.filter(h => h.type === 'token');
                          
                          return (
                            <>
                              {/* Tokens - Display first */}
                              {tokenHoldings.length > 0 && (portfolioFilter === 'All' || portfolioFilter === 'Tokens') && (
                                <div className="mb-4">
                                  <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                                    <span>Tokens</span>
                                    <span>Value</span>
                                  </div>
                                  <div className="space-y-1">
                                    {tokenHoldings.map((holding) => {
                                      const valueUSD = holding.valueUSD || 0;
                                      const isExpanded = expandedHoldings.has(holding.id);
                                      
                                      // Get chain information from portfolio holdings
                                      const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && h.type === 'token');
                                      const chainId = portfolioHolding?.chainId;
                                      const chainName = portfolioHolding?.chainName || (chainId ? getNetworkByChainId(chainId)?.name : null) || (chainId ? `Chain ${chainId}` : null);
                                      
                                      // Truncate text to prevent wrapping (max ~25 chars for main, ~20 for secondary)
                                      const truncateText = (text: string, maxLength: number): string => {
                                        if (text.length <= maxLength) return text;
                                        return text.substring(0, maxLength - 3) + '...';
                                      };
                                      
                                      // Main text: asset symbol (truncate to 25 chars like NFTs)
                                      const mainText = truncateText(holding.asset_symbol, 25);
                                      const mainTextFull = holding.asset_symbol;
                                      
                                      // Secondary text: asset name (truncate to 20 chars like NFTs)
                                      const secondaryText = truncateText(holding.asset_name, 20);
                                      const secondaryTextFull = holding.asset_name;
                                      
                                      return (
                                        <div key={holding.id} className="rounded-lg transition-colors">
                                          <div 
                                            onClick={() => {
                                              setExpandedHoldings(prev => {
                                                const next = new Set(prev);
                                                if (next.has(holding.id)) {
                                                  next.delete(holding.id);
                                                } else {
                                                  next.add(holding.id);
                                                }
                                                return next;
                                              });
                                            }}
                                            className="flex items-center justify-between py-3 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer group"
                                          >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                              <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 rounded-full flex items-center justify-center shrink-0 transition-colors">
                                                <span className="font-bold text-xs text-black dark:text-white">
                                                  {holding.asset_symbol[0]}
                                                </span>
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                  <p className="text-black dark:text-white font-medium text-sm truncate" title={mainTextFull}>{mainText}</p>
                                                  {chainName && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-500 bg-transparent font-normal leading-tight">
                                                      {chainName}
                                                    </Badge>
                                                  )}
                                                </div>
                                                <p className="text-zinc-500 text-xs truncate" title={secondaryTextFull}>{secondaryText}</p>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
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
                                              <motion.div
                                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                                className="text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400"
                                              >
                                                <ChevronDown className="w-4 h-4" />
                                              </motion.div>
                                            </div>
                                          </div>
                                          <AnimatePresence initial={false}>
                                            {isExpanded && (
                                              <motion.div
                                                key="expanded-details"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                                                className="overflow-hidden"
                                              >
                                                <ExpandedHoldingDetails 
                                                  holding={holding} 
                                                  holdingsTotal={holdingsTotal}
                                                  onBuy={() => {
                                                    const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && h.type === 'token');
                                                    const asset = holdingToAsset(holding, portfolioHolding);
                                                    openTradeModal('buy', asset);
                                                  }}
                                                  onSell={() => {
                                                    const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && h.type === 'token');
                                                    const asset = holdingToAsset(holding, portfolioHolding);
                                                    openTradeModal('sell', asset);
                                                  }}
                                                />
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {/* RWAs (T-Deeds) - Protocol-controlled Real World Assets - Display after Tokens */}
                              {rwaHoldingsWithDeeds.length > 0 && (portfolioFilter === 'All' || portfolioFilter === 'RWAs') && (
                                <div className="mb-4">
                                  <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                                    <span>RWAs (T-Deeds)</span>
                                    <span>Value</span>
                                  </div>
                                  <div className="space-y-1">
                                    {rwaHoldingsWithDeeds.map(({ holding, deed, chainId, chainName }) => {
                                      const isExpanded = expandedHoldings.has(holding.id);
                                      const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && (h.type as string) === 'rwa');
                                      return (
                                        <NFTHoldingItem 
                                          key={holding.id} 
                                          holding={holding} 
                                          deed={deed} 
                                          chainId={chainId} 
                                          chainName={chainName}
                                          isExpanded={isExpanded}
                                          onToggle={() => {
                                            setExpandedHoldings(prev => {
                                              const next = new Set(prev);
                                              if (next.has(holding.id)) {
                                                next.delete(holding.id);
                                              } else {
                                                next.add(holding.id);
                                              }
                                              return next;
                                            });
                                          }}
                                          holdingsTotal={holdingsTotal}
                                          onBuy={() => {
                                            const asset = holdingToAsset(holding, portfolioHolding);
                                            openTradeModal('buy', asset);
                                          }}
                                          onSell={() => {
                                            const asset = holdingToAsset(holding, portfolioHolding);
                                            openTradeModal('sell', asset);
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {/* General NFTs (for future expansion) */}
                              {nftHoldingsWithDeeds.length > 0 && (portfolioFilter === 'All' || portfolioFilter === 'NFTs') && (
                                <div className="mb-4">
                                  <div className="flex items-center justify-between text-zinc-500 text-xs uppercase tracking-wider mb-2 px-2">
                                    <span>NFTs</span>
                                    <span>Value</span>
                                  </div>
                                  <div className="space-y-1">
                                    {nftHoldingsWithDeeds.map(({ holding, deed, chainId, chainName }) => {
                                      const isExpanded = expandedHoldings.has(holding.id);
                                      const portfolioHolding = portfolioHoldings.find(h => h.id === holding.id && (h.type as string) === 'nft');
                                      return (
                                        <NFTHoldingItem 
                                          key={holding.id} 
                                          holding={holding} 
                                          deed={deed} 
                                          chainId={chainId} 
                                          chainName={chainName}
                                          isExpanded={isExpanded}
                                          onToggle={() => {
                                            setExpandedHoldings(prev => {
                                              const next = new Set(prev);
                                              if (next.has(holding.id)) {
                                                next.delete(holding.id);
                                              } else {
                                                next.add(holding.id);
                                              }
                                              return next;
                                            });
                                          }}
                                          holdingsTotal={holdingsTotal}
                                          onBuy={() => {
                                            const asset = holdingToAsset(holding, portfolioHolding);
                                            openTradeModal('buy', asset);
                                          }}
                                          onSell={() => {
                                            const asset = holdingToAsset(holding, portfolioHolding);
                                            openTradeModal('sell', asset);
                                          }}
                                        />
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
                    <h2 className="text-lg font-medium text-black dark:text-white">Activity</h2>
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
                  
                  {/* Activity filter/sort controls */}
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-2 flex-nowrap">
                      <div className="flex items-center gap-2 shrink-0">
                        <Select
                          value={activityFilter}
                          onValueChange={(
                            value:
                              | 'All'
                              | 'Deposits'
                              | 'Withdrawals'
                              | 'Buys'
                              | 'Sells'
                              | 'Mints'
                              | 'Transfers'
                              | 'Trades'
                              | 'Other'
                          ) => setActivityFilter(value)}
                        >
                          <SelectTrigger size="xs" className="w-24 md:w-26 text-xs font-normal text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                            <SelectValue placeholder="Filter" />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-50">
                            <SelectItem value="All" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">All</SelectItem>
                            <SelectItem value="Deposits" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Deposits</SelectItem>
                            <SelectItem value="Withdrawals" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Withdrawals</SelectItem>
                            <SelectItem value="Buys" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Buys</SelectItem>
                            <SelectItem value="Sells" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Sells</SelectItem>
                            <SelectItem value="Mints" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Mints</SelectItem>
                            <SelectItem value="Transfers" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Transfers</SelectItem>
                            <SelectItem value="Trades" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Trades</SelectItem>
                            <SelectItem value="Other" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Other</SelectItem>
                          </SelectContent>
                        </Select>

                        <Select
                          value={activitySort}
                          onValueChange={(value: 'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow') => setActivitySort(value)}
                        >
                          <SelectTrigger size="xs" className="w-24 md:w-28 text-xs font-normal text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                            <SelectValue placeholder="Sort" />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-50">
                            <SelectItem value="Newest" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Newest</SelectItem>
                            <SelectItem value="Oldest" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Oldest</SelectItem>
                            <SelectItem value="AmountHigh" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Amount (high)</SelectItem>
                            <SelectItem value="AmountLow" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Amount (low)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Let Network flex so row never overflows */}
                      <div className="flex-1 min-w-0">
                        <Select value={activityChainFilter} onValueChange={(value: string) => setActivityChainFilter(value)}>
                          <SelectTrigger size="xs" className="w-full min-w-0 text-xs font-normal text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                            <SelectValue placeholder="Network" />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-50">
                          <SelectItem value="All" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">
                            All networks
                          </SelectItem>
                          {activityChains.map((chain) => (
                            <SelectItem
                              key={chain}
                              value={chain}
                              className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5"
                            >
                              {chain}
                            </SelectItem>
                          ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 px-2 pb-2">
                    {!isConnected ? (
                      <div className="py-8 text-center text-zinc-500 text-sm">
                        Connect wallet to view activity
                      </div>
                    ) : activityTransactions.length > 0 ? (
                      displayedActivityTransactions.map((item) => (
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
                                <span>
                                  {(() => {
                                    // Try to use timestamp if available, otherwise fallback to date string
                                    // Use type assertion to access timestamp which might be on the object but not in the type definition used here
                                    const tx = item as any;
                                    if (tx.timestamp) {
                                      const date = new Date(tx.timestamp);
                                      // Format: "MM/DD/YY : H:MMam/pm" (e.g., "01/01/26 : 7:18am")
                                      const month = (date.getMonth() + 1).toString().padStart(2, '0');
                                      const day = date.getDate().toString().padStart(2, '0');
                                      const year = date.getFullYear().toString().slice(-2);
                                      
                                      let hours = date.getHours();
                                      const minutes = date.getMinutes().toString().padStart(2, '0');
                                      const ampm = hours >= 12 ? 'pm' : 'am';
                                      
                                      hours = hours % 12;
                                      hours = hours ? hours : 12; // the hour '0' should be '12'
                                      
                                      return `${month}/${day}/${year} : ${hours}:${minutes}${ampm}`;
                                    }
                                    return item.date;
                                  })()}
                                </span>
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
                                  {(() => {
                                    const isPlus = item.type === 'deposit' || item.type === 'buy';
                                    const isMinus = item.type === 'withdraw' || item.type === 'sell';
                                    const sign = isPlus ? '+' : isMinus ? '-' : '';

                                    const absAmount = Math.abs(item.amount);
                                    const smallDecimals = item.currency === currencySymbol ? 4 : 2;
                                    const numberPart =
                                      absAmount >= 1000
                                        ? formatCompactNumber(absAmount)
                                        : absAmount.toLocaleString(undefined, {
                                            minimumFractionDigits: smallDecimals,
                                            maximumFractionDigits: smallDecimals,
                                          });

                                    return (
                                      <>
                                        {sign}
                                        {item.currency === 'USD' ? '$' : ''}
                                        {numberPart}
                                        {item.currency !== 'USD' ? ` ${item.currency}` : ''}
                                      </>
                                    );
                                  })()}
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

                  {/* Load more / Show less */}
                  {isConnected && activityTransactions.length > 7 && (
                    <div className="mt-2 px-3 pb-3">
                      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <button
                          onClick={() => {
                            if (activityVisibleCount >= activityTransactions.length) {
                              setActivityVisibleCount(7);
                              return;
                            }
                            setActivityVisibleCount((prev) => Math.min(prev + 7, activityTransactions.length));
                          }}
                          className="w-full text-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-2"
                        >
                          {activityVisibleCount >= activityTransactions.length
                            ? `Show Less (${activityTransactions.length} total)`
                            : `Load More (${Math.min(activityVisibleCount + 7, activityTransactions.length)}/${activityTransactions.length})`}
                        </button>
                      </div>
                    </div>
                  )}
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
