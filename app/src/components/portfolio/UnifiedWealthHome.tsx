import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  CreditCard,
  ArrowUpRight,
  ArrowRightLeft,
  Home,
  TrendingUp,
  ShieldCheck,
  Zap,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Receipt,
  Plus,
  FileCheck,
  ExternalLink,
  Hash,
  Calendar,
  Landmark,
  ArrowDownLeft,
  FileText,
} from 'lucide-react';
import ClearPathLogo from '../../assets/ClearPath-Logo.png';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { useAppKitAccount } from '@reown/appkit/react';
import { usePortfolio } from '@/context/PortfolioContext';
import { LargePriceWheel } from '@/components/PriceWheel';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const MOCK_PROPERTY_EQUITY = 85000;
const MOCK_PROPERTIES = [
  {
    id: 1,
    address: '123 Ocean Drive, Miami FL',
    value: 450000,
    equity: 65000,
    status: 'Active',
    type: 'Condo',
    deedTokenId: '0x7a3...f2b1',
    trustId: 'WY-NT-8847',
    chainId: 8453,
    lastSyncedAt: '2025-02-10T14:32:00Z',
    verificationStatus: 'Verified',
    lienBalance: 0,
    equityPct: 14.4,
    renovationSpent: null,
    renovationTarget: null,
    renovationValueAdd: null,
  },
  {
    id: 2,
    address: '456 Alpine Way, Aspen CO',
    value: 850000,
    equity: 20000,
    status: 'Renovation',
    type: 'Chalet',
    deedTokenId: '0x9c1...d4e2',
    trustId: 'WY-NT-8848',
    chainId: 8453,
    lastSyncedAt: '2025-02-09T09:15:00Z',
    verificationStatus: 'Pending review',
    lienBalance: 830000,
    equityPct: 2.4,
    renovationSpent: 5000,
    renovationTarget: 25000,
    renovationValueAdd: 12000,
  },
];

// Mock Equity Card details (in production would come from API)
const MOCK_CARD = {
  last4: '4242',
  number: '4242424242424242',
  expiry: '12/28',
  cvv: '123',
  accountNumber: 'ACC-ESA-8847-2291',
};

const MOCK_CARD_TRANSACTIONS = [
  { id: 1, description: 'Amazon.com', amount: -47.32, date: '2025-02-09', category: 'Shopping' },
  { id: 2, description: 'Whole Foods', amount: -82.15, date: '2025-02-08', category: 'Groceries' },
  { id: 3, description: 'Stake credit', amount: 250.0, date: '2025-02-05', category: 'Credit' },
  { id: 4, description: 'Netflix', amount: -15.99, date: '2025-02-01', category: 'Subscription' },
];

const MOCK_ESA_ACCOUNT = { accountNumber: 'ESA-8847-2291', routingRef: 'CLEAR-ESA' };

const MOCK_ESA_ACTIVITY = [
  { id: 1, type: 'deposit' as const, amount: 5000, date: '2025-02-08T10:30:00Z', description: 'Bank transfer', status: 'Completed' },
  { id: 2, type: 'match' as const, amount: 5000, date: '2025-02-08T10:30:00Z', description: '1:1 Match credit', status: 'Completed' },
  { id: 3, type: 'withdrawal' as const, amount: -1500, date: '2025-02-05T14:00:00Z', description: 'Transfer to Property', status: 'Completed' },
  { id: 4, type: 'deposit' as const, amount: 2500, date: '2025-02-01T09:15:00Z', description: 'Bank transfer', status: 'Completed' },
];

function formatWalletDisplay(address: string | undefined): string {
  if (!address) return 'Connect wallet';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function UnifiedWealthHome() {
  const { isConnected, address } = useAppKitAccount();
  const { cashBalance: portfolioCashBalance, balances: multichainBalances } = usePortfolio();

  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const { setActionModalOpen } = useGlobalModals();
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [revealNumber, setRevealNumber] = useState(false);
  const [revealCVV, setRevealCVV] = useState(false);
  const [expandedPropertyId, setExpandedPropertyId] = useState<number | null>(null);
  const [esaActivityExpanded, setEsaActivityExpanded] = useState(false);

  const cashBalance = portfolioCashBalance?.totalCash || 12500;
  const totalStake = cashBalance + MOCK_PROPERTY_EQUITY;
  const spendingPower = totalStake * 0.5;
  // Limit is 50% of stake; mock split: cash portion (0% interest) vs equity draw (low interest)
  const limitFromCash = Math.min(cashBalance * 0.5, spendingPower);
  const limitFromEquity = spendingPower - limitFromCash;
  const usedAmount = 0; // mock
  const utilizationPct = spendingPower > 0 ? (usedAmount / spendingPower) * 100 : 0;

  useEffect(() => {
    const handleScroll = () => setIsScrolledPast(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
          {/* Left Column */}
          <div className="md:col-span-8 space-y-10">
            {/* Balance header – single source of truth; no duplicate breakdown (see ESA below) */}
            <div>
              <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                <span className="text-sm font-medium">Combined Equity Stake</span>
                <div className="group relative">
                  <Info className="h-4 w-4 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-[220px]">
                    ESA balance + property equity. Breakdown in Equity Savings Account below.
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
                      <LargePriceWheel value={totalStake} className="font-light" />
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
                  disabled={!isConnected || totalStake === 0}
                >
                  Withdraw Funds
                </button>
              </div>
            </div>

            {/* Equity Savings Account (ESA) – neo-bank style, single place for ESA + composition */}
            <div className="bg-white dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                      <Landmark className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-black dark:text-white">Equity Savings Account</h3>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">Account {MOCK_ESA_ACCOUNT.accountNumber}</p>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold tracking-wide border border-green-200 dark:border-green-800 flex items-center gap-1.5 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    1:1 Match Active
                  </span>
                </div>
              </div>
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-0.5">Available balance</p>
                    <p className="text-2xl font-semibold text-black dark:text-white tabular-nums">${cashBalance.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">Cash in ESA · 0% APR (match-first)</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setDepositModalOpen(true)}
                      className="rounded-full h-8 text-xs font-medium"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" />
                      Deposit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWithdrawModalOpen(true)}
                      disabled={!isConnected || cashBalance === 0}
                      className="rounded-full h-8 text-xs font-medium border-zinc-300 dark:border-zinc-700"
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5 mr-1.5" />
                      Withdraw
                    </Button>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Composition (combined stake)</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-zinc-600 dark:text-zinc-300">ESA</span>
                      <span className="font-medium text-black dark:text-white">${cashBalance.toLocaleString()}</span>
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-500">+</span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-zinc-600 dark:text-zinc-300">Property equity</span>
                      <span className="font-medium text-black dark:text-white">${MOCK_PROPERTY_EQUITY.toLocaleString()}</span>
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-500">=</span>
                    <span className="font-semibold text-black dark:text-white">${totalStake.toLocaleString()} total</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-1.5">Match adds 1:1 to buying power when you deposit.</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Recent activity</p>
                  <button
                    type="button"
                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    onClick={() => setEsaActivityExpanded((e) => !e)}
                  >
                    {esaActivityExpanded ? 'Show less' : 'View all'}
                  </button>
                </div>
                <ul className="space-y-0 divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {(esaActivityExpanded ? MOCK_ESA_ACTIVITY : MOCK_ESA_ACTIVITY.slice(0, 2)).map((item) => (
                    <li key={item.id} className="flex items-center justify-between py-2.5 first:pt-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${item.type === 'deposit' || item.type === 'match' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                          {item.type === 'match' ? (
                            <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
                          ) : item.type === 'deposit' ? (
                            <ArrowUpRight className="w-4 h-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-black dark:text-white truncate">{item.description}</p>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {item.status}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-medium tabular-nums shrink-0 ml-2 ${item.amount >= 0 ? 'text-green-600 dark:text-green-500' : 'text-black dark:text-white'}`}>
                        {item.amount >= 0 ? '+' : ''}${item.amount.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/50">
                  <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white">
                    <FileText className="w-3 h-3 mr-1.5" />
                    Statements
                  </Button>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(MOCK_ESA_ACCOUNT.accountNumber)}
                    className="inline-flex items-center gap-1.5 h-7 px-2 text-xs text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Copy className="w-3 h-3" />
                    Copy account ref
                  </button>
                </div>
              </div>
            </div>

            {/* Equity Card – two columns: card (40%) | limit + utilization (60%) */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Equity Card</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] gap-6 lg:gap-8 items-stretch">
                  {/* Left: Flippable card – centered in column, standard card ratio ~1.586:1 */}
                  <div className="flex flex-col justify-center items-center min-h-[200px] lg:min-h-0 lg:h-full">
                    <div
                      className="relative w-[300px] h-[189px] cursor-pointer shrink-0"
                      style={{ perspective: '1200px' }}
                      onClick={() => setCardFlipped((f) => !f)}
                    >
                      <motion.div
                        className="relative w-full h-full"
                        animate={{ rotateY: cardFlipped ? 180 : 0 }}
                        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                        style={{ transformStyle: 'preserve-3d' }}
                      >
                        {/* Front: off-white in light mode, dark gradient in dark mode */}
                        <div
                          className="absolute inset-0 rounded bg-[#f5f2ee] dark:bg-gradient-to-br dark:from-zinc-800 dark:to-zinc-950 border border-zinc-300 dark:border-zinc-700 shadow-xl flex flex-col justify-between p-4 text-zinc-800 dark:text-white"
                          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                        >
                          <div className="flex justify-between items-start">
                            <div className="w-9 h-9 rounded border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50 shrink-0">
                              <img src={ClearPathLogo} alt="CLEAR" className="w-full h-full object-cover" />
                            </div>
                            <div className="w-11 h-8 rounded bg-amber-400/90 flex items-center justify-center shrink-0">
                              <div className="w-7 h-5 rounded border-2 border-amber-600/50 bg-gradient-to-br from-amber-200 to-amber-400" />
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-0.5">Equity Card</p>
                            <p className="font-mono text-sm tracking-wider">•••• •••• •••• {MOCK_CARD.last4}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 font-mono">{formatWalletDisplay(address)}</p>
                          </div>
                        </div>
                        {/* Back: off-white in light mode, dark in dark mode */}
                        <div
                          className="absolute inset-0 rounded bg-[#f5f2ee] dark:bg-gradient-to-br dark:from-zinc-800 dark:to-zinc-950 border border-zinc-300 dark:border-zinc-700 shadow-xl flex flex-col justify-between p-4 text-zinc-800 dark:text-white"
                          style={{
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)',
                          }}
                        >
                          <div className="h-8 -mx-4 mt-0 bg-zinc-300 dark:bg-zinc-800/80" />
                          <div className="space-y-2 text-right">
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Card number</p>
                            <p className="font-mono text-xs tracking-wider">
                              {revealNumber ? MOCK_CARD.number.replace(/(\d{4})/g, '$1 ').trim() : `•••• •••• •••• ${MOCK_CARD.last4}`}
                            </p>
                            <div className="flex justify-end gap-4">
                              <div>
                                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Expires</p>
                                <p className="font-mono text-xs">{MOCK_CARD.expiry}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">CVV</p>
                                <p className="font-mono text-xs">{revealCVV ? MOCK_CARD.cvv : '•••'}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                    <p className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-2">Tap card to flip</p>
                  </div>

                  {/* Right: What makes up limit + Utilization */}
                  <div className="space-y-5 min-w-0 flex flex-col justify-center">
                    <div className="p-4 rounded bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-2">
                        <Info className="w-3.5 h-3.5" />
                        What makes up your card limit
                      </p>
                      <p className="text-sm text-black dark:text-white mb-2">
                        Limit = 50% of Combined Stake. Drawn in order:
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            From ESA (0% interest)
                          </span>
                          <span className="font-medium text-black dark:text-white shrink-0">${limitFromCash.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                            From Beneficial Interest (low interest)
                          </span>
                          <span className="font-medium text-black dark:text-white shrink-0">${limitFromEquity.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex">
                        <div className="h-full bg-blue-500 rounded-l-full" style={{ width: `${(limitFromCash / spendingPower) * 100}%` }} />
                        <div className="h-full bg-amber-500 rounded-r-full" style={{ width: `${(limitFromEquity / spendingPower) * 100}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                        <span>$0</span>
                        <span>${(spendingPower * 0.5).toLocaleString()}</span>
                        <span>${spendingPower.toLocaleString()}</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-zinc-500 dark:text-zinc-400">Utilization</span>
                        <span className="text-blue-600 dark:text-blue-400 font-medium">{utilizationPct.toFixed(0)}% Used</span>
                      </div>
                      <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden relative">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${utilizationPct}%` }} />
                        {[25, 50, 75].map((p) => (
                          <div key={p} className="absolute top-0 bottom-0 w-px bg-white/30 dark:bg-zinc-600 pointer-events-none" style={{ left: `${p}%` }} />
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                        <span>$0 used</span>
                        <span>${spendingPower.toLocaleString()} limit</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Move Cash to Property – full width below columns */}
                <div className="flex items-center justify-between py-4 border-t border-zinc-200 dark:border-zinc-800/50">
                  <div>
                    <p className="font-medium text-black dark:text-white text-sm">Move Cash to Property</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Buy down principal instantly</p>
                  </div>
                  <Button
                    variant="outline"
                    className="rounded-full border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm"
                  >
                    <ArrowRightLeft className="w-4 h-4 mr-2" />
                    Transfer
                  </Button>
                </div>

                {/* Expand: card details + transactions */}
                <div className="border-t border-zinc-200 dark:border-zinc-800/50 pt-4">
                  <button
                    type="button"
                    onClick={() => setCardExpanded((e) => !e)}
                    className="w-full flex items-center justify-between text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-2"
                  >
                    <span className="flex items-center gap-2">
                      <Receipt className="w-4 h-4" />
                      {cardExpanded ? 'Hide' : 'Show'} card details & activity
                    </span>
                    {cardExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {cardExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-4 space-y-6">
                          {/* Card info: number, expiry, CVV, account number */}
                          <div className="p-4 rounded-lg bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-3">
                            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Card & account details</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 dark:text-zinc-400">Card number</span>
                                <span className="font-mono flex items-center gap-2">
                                  {revealNumber ? MOCK_CARD.number.replace(/(\d{4})/g, '$1 ').trim() : `•••• •••• •••• ${MOCK_CARD.last4}`}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setRevealNumber((r) => !r); }}
                                    className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                                    aria-label={revealNumber ? 'Hide number' : 'Show number'}
                                  >
                                    {revealNumber ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 dark:text-zinc-400">Expiration</span>
                                <span className="font-mono">{MOCK_CARD.expiry}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 dark:text-zinc-400">Security code (CVV)</span>
                                <span className="font-mono flex items-center gap-2">
                                  {revealCVV ? MOCK_CARD.cvv : '•••'}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setRevealCVV((r) => !r); }}
                                    className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                                    aria-label={revealCVV ? 'Hide CVV' : 'Show CVV'}
                                  >
                                    {revealCVV ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </span>
                              </div>
                              <div className="flex items-center justify-between sm:col-span-2">
                                <span className="text-zinc-500 dark:text-zinc-400">Account number</span>
                                <span className="font-mono flex items-center gap-2">
                                  {MOCK_CARD.accountNumber}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(MOCK_CARD.accountNumber); }}
                                    className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                                    aria-label="Copy account number"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Recent transactions */}
                          <div>
                            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">Recent transactions</p>
                            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                              {MOCK_CARD_TRANSACTIONS.map((tx) => (
                                <div
                                  key={tx.id}
                                  className="flex items-center justify-between py-3 px-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                                >
                                  <div>
                                    <p className="font-medium text-black dark:text-white text-sm">{tx.description}</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{tx.date} · {tx.category}</p>
                                  </div>
                                  <span className={`font-medium text-sm ${tx.amount >= 0 ? 'text-green-600 dark:text-green-500' : 'text-black dark:text-white'}`}>
                                    {tx.amount >= 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <button type="button" className="w-full py-2 mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                              View all transactions
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Protocol Logic – same card style as BorrowHome loan cards */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Protocol Logic</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <h4 className="font-medium text-black dark:text-white">ESA = EA (1:1 Match)</h4>
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Depositing $1,000 Cash instantly increases Total Stake by $2,000 via the match program.
                  </p>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h4 className="font-medium text-black dark:text-white">Smart Capital Priority</h4>
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Spends 0% interest Cash first. Then switches to Low-Interest Equity Draw automatically.
                  </p>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Right Column – same spacing as BorrowHome */}
          <div className="md:col-span-4 space-y-6">
            {/* Property Portfolio – information-dense, expandable, RWA-ready */}
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-zinc-600 dark:text-zinc-400 shrink-0" />
                    <h3 className="text-base font-medium text-black dark:text-white">Property Portfolio</h3>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full border-zinc-300 dark:border-zinc-700 text-xs font-medium h-8 px-3 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Add / verify property
                  </Button>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    <span className="font-medium text-black dark:text-white">{MOCK_PROPERTIES.length}</span> properties
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500">·</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    Total equity <span className="font-medium text-amber-600 dark:text-amber-500">${MOCK_PROPERTIES.reduce((s, p) => s + p.equity, 0).toLocaleString()}</span>
                  </span>
                </div>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {MOCK_PROPERTIES.map((property) => {
                  const isExpanded = expandedPropertyId === property.id;
                  return (
                    <div key={property.id} className="bg-white dark:bg-zinc-950/50">
                      <button
                        type="button"
                        onClick={() => setExpandedPropertyId(isExpanded ? null : property.id)}
                        className="w-full p-4 flex items-center gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <Home className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-black dark:text-white text-sm truncate">{property.address}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{property.type}</span>
                            <span className="text-[10px] text-zinc-400">·</span>
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">${property.equity.toLocaleString()} equity</span>
                            {property.status === 'Renovation' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                                Renovation
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            <ShieldCheck className="w-3 h-3 text-green-500" />
                            {property.verificationStatus === 'Verified' ? 'Synced' : 'Pending'}
                          </span>
                          <motion.span
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-zinc-400 dark:text-zinc-500"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </motion.span>
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden border-t border-zinc-200 dark:border-zinc-800/50"
                          >
                            <div className="p-4 pt-2 bg-zinc-50/80 dark:bg-zinc-900/40 space-y-4">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                                <div className="flex justify-between gap-2">
                                  <span className="text-zinc-500 dark:text-zinc-400">Market value</span>
                                  <span className="font-medium text-black dark:text-white tabular-nums">${property.value.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-zinc-500 dark:text-zinc-400">Your equity</span>
                                  <span className="font-medium text-amber-600 dark:text-amber-500 tabular-nums">${property.equity.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-zinc-500 dark:text-zinc-400">Equity %</span>
                                  <span className="font-medium text-black dark:text-white tabular-nums">{property.equityPct}%</span>
                                </div>
                                {property.lienBalance > 0 && (
                                  <div className="flex justify-between gap-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">Outstanding lien</span>
                                    <span className="font-medium text-black dark:text-white tabular-nums">${property.lienBalance.toLocaleString()}</span>
                                  </div>
                                )}
                                <div className="flex justify-between gap-2 col-span-2">
                                  <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                    <Hash className="w-3 h-3" /> Deed / token ID
                                  </span>
                                  <span className="font-mono text-[10px] text-zinc-600 dark:text-zinc-300 truncate max-w-[140px]" title={property.deedTokenId}>
                                    {property.deedTokenId}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-zinc-500 dark:text-zinc-400">Trust ID</span>
                                  <span className="font-mono text-[10px] text-black dark:text-white">{property.trustId}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-zinc-500 dark:text-zinc-400">Verification</span>
                                  <span className={`font-medium ${property.verificationStatus === 'Verified' ? 'text-green-600 dark:text-green-500' : 'text-amber-600 dark:text-amber-500'}`}>
                                    {property.verificationStatus}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-2 col-span-2">
                                  <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Last synced
                                  </span>
                                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                    {new Date(property.lastSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                              {property.status === 'Renovation' && property.renovationSpent != null && property.renovationTarget != null && (
                                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/50">
                                  <div className="flex justify-between text-[10px] mb-1.5">
                                    <span className="text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wide">Fixer progress</span>
                                    {property.renovationValueAdd != null && (
                                      <span className="text-green-600 dark:text-green-500 font-medium">+${(property.renovationValueAdd / 1000).toFixed(0)}k value add</span>
                                    )}
                                  </div>
                                  <Progress
                                    value={Math.min(100, ((property.renovationSpent ?? 0) / (property.renovationTarget ?? 1)) * 100)}
                                    className="h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full"
                                  />
                                  <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-mono">
                                    <span>${((property.renovationSpent ?? 0) / 1000).toFixed(0)}k spent</span>
                                    <span>Target ${((property.renovationTarget ?? 0) / 1000).toFixed(0)}k</span>
                                  </div>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2 pt-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                >
                                  <ExternalLink className="w-3 h-3 mr-1.5" />
                                  View on chain
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                >
                                  <FileCheck className="w-3 h-3 mr-1.5" />
                                  Documents
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="w-full py-2.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors border-t border-zinc-200 dark:border-zinc-800/50"
              >
                View all properties
              </button>
            </div>

            {/* Path to 100% */}
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-black dark:text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" />
                  Path to 100% Equity
                </h3>
                <span className="text-sm font-medium text-amber-600 dark:text-amber-500">+142%</span>
              </div>
              <div className="h-24 w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex items-end justify-around pb-2 gap-px">
                {[20, 35, 45, 55, 70, 85, 100].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-amber-500/80 dark:bg-amber-500/60 rounded-t min-h-[4px]"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                <span>Now</span>
                <span>7 Years</span>
              </div>
              <div className="mt-3 p-3 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">Renovation Pop Inbound</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Est. <span className="font-medium text-black dark:text-white">$15,000</span> gain on Aspen completion.
                </p>
              </div>
            </div>

          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
