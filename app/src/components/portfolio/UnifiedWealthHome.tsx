import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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

export default function UnifiedWealthHome() {
  const { isConnected } = useAppKitAccount();
  const { cashBalance: portfolioCashBalance, balances: multichainBalances } = usePortfolio();

  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const { setActionModalOpen } = useGlobalModals();
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  const cashBalance = portfolioCashBalance?.totalCash || 12500;
  const totalStake = cashBalance + MOCK_PROPERTY_EQUITY;
  const spendingPower = totalStake * 0.5;

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

            {/* Equity Card – same card style as BorrowHome */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Equity Card</h3>
              <motion.div
                whileHover={{ scale: 1.01 }}
                className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-lg p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="font-medium text-black dark:text-white">Available limit</p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">50% of Combined Stake</p>
                    </div>
                  </div>
                  <p className="text-xl font-medium text-black dark:text-white">${spendingPower.toLocaleString()}</p>
                </div>
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-zinc-500 dark:text-zinc-400">Utilization</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium">0% Used</span>
                  </div>
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-[0%] rounded-full" />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                    <span>$0</span>
                    <span>${spendingPower.toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800/50">
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
              </motion.div>
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
