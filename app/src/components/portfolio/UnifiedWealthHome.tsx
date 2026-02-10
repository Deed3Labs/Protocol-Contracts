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
  Copy,
  Eye,
  EyeOff,
  Receipt,
} from 'lucide-react';
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
  { id: 1, address: '123 Ocean Drive, Miami FL', value: 450000, equity: 65000, status: 'Active', type: 'Condo' },
  { id: 2, address: '456 Alpine Way, Aspen CO', value: 850000, equity: 20000, status: 'Renovation', type: 'Chalet' },
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
            {/* Balance header – same pattern as BrokerageHome / MarketsHome / BorrowHome */}
            <div>
              <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                <span className="text-sm font-medium">Combined Equity Stake</span>
                <div className="group relative">
                  <Info className="h-4 w-4 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-[220px]">
                    Cash (ESA) + property equity. 1:1 match on cash adds to buying power.
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold tracking-wide border border-green-200 dark:border-green-800 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  1:1 Match Active
                </span>
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
              {/* Breakdown with rounded-full dots (cash vs property mix) */}
              <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
                  ${cashBalance.toLocaleString()} Cash
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">+</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
                  ${MOCK_PROPERTY_EQUITY.toLocaleString()} Property
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">=</span>
                <span className="text-black dark:text-white font-medium">
                  ${totalStake.toLocaleString()} Total
                </span>
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

            {/* Equity Card – flippable card + limit breakdown + expandable details & transactions */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Equity Card</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                {/* Flippable card */}
                <div className="perspective-[1200px] mb-6">
                  <div
                    className="relative w-full max-w-[340px] h-[200px] mx-auto cursor-pointer"
                    style={{ perspective: '1200px' }}
                    onClick={() => setCardFlipped((f) => !f)}
                  >
                    <motion.div
                      className="relative w-full h-full"
                      animate={{ rotateY: cardFlipped ? 180 : 0 }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                      style={{ transformStyle: 'preserve-3d' }}
                    >
                      {/* Front: logo, name/address, chip, last4 */}
                      <div
                        className="absolute inset-0 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 dark:from-zinc-800 dark:to-zinc-950 border border-zinc-600/50 dark:border-zinc-700 shadow-xl flex flex-col justify-between p-5 text-white"
                        style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                      >
                        <div className="flex justify-between items-start">
                          <div className="w-10 h-8 rounded bg-white/20 flex items-center justify-center text-xs font-bold text-white">
                            CLEAR
                          </div>
                          <div className="w-12 h-9 rounded-lg bg-amber-400/90 flex items-center justify-center">
                            <div className="w-8 h-6 rounded border-2 border-amber-600/50 bg-gradient-to-br from-amber-200 to-amber-400" />
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Equity Card</p>
                          <p className="font-mono text-sm tracking-wider">
                            •••• •••• •••• {MOCK_CARD.last4}
                          </p>
                          <p className="text-xs text-zinc-400 mt-2 font-mono">
                            {formatWalletDisplay(address)}
                          </p>
                        </div>
                      </div>
                      {/* Back: stripe, number, expiry, CVV */}
                      <div
                        className="absolute inset-0 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 dark:from-zinc-800 dark:to-zinc-950 border border-zinc-600/50 dark:border-zinc-700 shadow-xl flex flex-col justify-between p-5 text-white"
                        style={{
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'rotateY(180deg)',
                        }}
                      >
                        <div className="h-10 -mx-5 mt-0 bg-zinc-800/80" />
                        <div className="space-y-3 text-right">
                          <p className="text-[10px] text-zinc-400">Card number</p>
                          <p className="font-mono text-sm tracking-wider">
                            {revealNumber ? MOCK_CARD.number.replace(/(\d{4})/g, '$1 ').trim() : `•••• •••• •••• ${MOCK_CARD.last4}`}
                          </p>
                          <div className="flex justify-end gap-6">
                            <div>
                              <p className="text-[10px] text-zinc-400">Expires</p>
                              <p className="font-mono text-sm">{MOCK_CARD.expiry}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-400">CVV</p>
                              <p className="font-mono text-sm">{revealCVV ? MOCK_CARD.cvv : '•••'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                  <p className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-2">Tap card to flip</p>
                </div>

                {/* Limit breakdown: what makes up the card limit */}
                <div className="mb-6 p-4 rounded-lg bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5" />
                    What makes up your card limit
                  </p>
                  <p className="text-sm text-black dark:text-white mb-3">
                    Your spending limit is <span className="font-medium">50% of your Combined Equity Stake</span>. It is drawn in this order:
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-zinc-600 dark:text-zinc-300">From ESA (0% interest)</span>
                      <span className="font-medium text-black dark:text-white">${limitFromCash.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-zinc-600 dark:text-zinc-300">From Beneficial Interest (low interest)</span>
                      <span className="font-medium text-black dark:text-white">${limitFromEquity.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex">
                    <div
                      className="h-full bg-blue-500 rounded-l-full"
                      style={{ width: `${(limitFromCash / spendingPower) * 100}%` }}
                    />
                    <div
                      className="h-full bg-amber-500 rounded-r-full"
                      style={{ width: `${(limitFromEquity / spendingPower) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                    <span>$0</span>
                    <span>${(spendingPower * 0.25).toLocaleString()}</span>
                    <span>${(spendingPower * 0.5).toLocaleString()}</span>
                    <span>${(spendingPower * 0.75).toLocaleString()}</span>
                    <span>${spendingPower.toLocaleString()}</span>
                  </div>
                </div>

                {/* Utilization bar with breaks */}
                <div className="mb-6">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-zinc-500 dark:text-zinc-400">Utilization</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium">{utilizationPct.toFixed(0)}% Used</span>
                  </div>
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${utilizationPct}%` }}
                    />
                    {[25, 50, 75].map((p) => (
                      <div
                        key={p}
                        className="absolute top-0 bottom-0 w-px bg-white/30 dark:bg-zinc-600 pointer-events-none"
                        style={{ left: `${p}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                    <span>$0 used</span>
                    <span>${spendingPower.toLocaleString()} limit</span>
                  </div>
                </div>

                {/* Move Cash to Property */}
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
                            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
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
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
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
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
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
            {/* Property Portfolio */}
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50">
                <h3 className="text-base font-medium text-black dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Property Portfolio
                </h3>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {MOCK_PROPERTIES.map((property) => (
                  <div
                    key={property.id}
                    className="p-4 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                          <Home className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                        </div>
                        <div>
                          <p className="font-medium text-black dark:text-white text-sm">{property.address}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{property.type} · {property.status}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                        <ShieldCheck className="w-3 h-3 text-green-500" />
                        Synced
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                      <div>
                        <p className="text-zinc-500 dark:text-zinc-400 mb-0.5">Market Value</p>
                        <p className="font-medium text-black dark:text-white">${property.value.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 dark:text-zinc-400 mb-0.5">Your Equity</p>
                        <p className="font-medium text-amber-600 dark:text-amber-500">${property.equity.toLocaleString()}</p>
                      </div>
                    </div>
                    {property.status === 'Renovation' && (
                      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800/50">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-zinc-500 dark:text-zinc-400">Fixer Progress</span>
                          <span className="text-green-600 dark:text-green-500 font-medium">+$12k Value</span>
                        </div>
                        <Progress value={45} className="h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                        <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                          <span>$5k Spent</span>
                          <span>Target: $25k</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button className="w-full py-3 text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
                View All Properties
              </button>
            </div>

            {/* Path to 100% */}
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-5">
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
              <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">Renovation Pop Inbound</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Est. <span className="font-medium text-black dark:text-white">$15,000</span> gain on Aspen completion.
                </p>
              </div>
            </div>

            {/* CTA – same style as BorrowHome help box */}
            <div className="bg-blue-600 rounded-lg p-5 text-white">
              <h3 className="font-medium mb-2">Boost your stake</h3>
              <p className="text-sm text-blue-100 mb-4">Add cash to get a 1:1 match and grow your combined equity stake.</p>
              <button
                onClick={() => setDepositModalOpen(true)}
                className="w-full bg-white text-blue-600 py-2 rounded-full text-sm font-normal hover:bg-blue-50 transition-colors"
              >
                Add Funds
              </button>
            </div>
          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
