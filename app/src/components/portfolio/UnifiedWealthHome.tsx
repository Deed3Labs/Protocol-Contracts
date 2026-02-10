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
  Zap
} from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { LargePriceWheel } from '@/components/PriceWheel';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

// Mock Data for "Unified Wealth"
const MOCK_PROPERTY_EQUITY = 85000;
const MOCK_PROPERTIES = [
  { id: 1, address: '123 Ocean Drive, Miami FL', value: 450000, equity: 65000, status: 'Active', type: 'Condo' },
  { id: 2, address: '456 Alpine Way, Aspen CO', value: 850000, equity: 20000, status: 'Renovation', type: 'Chalet' }
];

export default function UnifiedWealthHome() {
  const { cashBalance: portfolioCashBalance } = usePortfolio();
  
  // State
  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const { setActionModalOpen } = useGlobalModals();
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  // Unused for now, but part of the prompt's functionality
  // const [transferAmount, setTransferAmount] = useState<number>(0);

  // Derived Values
  const cashBalance = portfolioCashBalance?.totalCash || 12500; // Default mock if 0/undefined
  const totalStake = cashBalance + MOCK_PROPERTY_EQUITY;
  const spendingPower = totalStake * 0.5;
  // const matchRatio = 1; // 1:1

  // Handle Scroll for Header
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolledPast(window.scrollY > 50);
    };
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

      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32 px-4">
        {/* 1. The "Total Stake" Dashboard (The Global Header) */}
        <section className="mb-12 text-center md:text-left">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Combined Equity Stake</span>
                <div className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold tracking-wide border border-green-200 dark:border-green-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  1:1 MATCH ACTIVE
                </div>
              </div>
              
              <div className="flex items-baseline gap-2 justify-center md:justify-start">
                <h1 className="text-5xl md:text-7xl font-light tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 dark:from-yellow-400 dark:via-amber-300 dark:to-yellow-500">
                  <LargePriceWheel value={totalStake} />
                </h1>
              </div>

              {/* The Breakdown Pill */}
              <div className="mt-4 inline-flex flex-wrap items-center justify-center md:justify-start gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-800">
                <div className="px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm font-medium flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  ${cashBalance.toLocaleString()} Cash
                </div>
                <span className="text-zinc-400 dark:text-zinc-600 font-light">+</span>
                <div className="px-4 py-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm font-medium flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  ${MOCK_PROPERTY_EQUITY.toLocaleString()} Property
                </div>
                <span className="text-zinc-400 dark:text-zinc-600 font-light">=</span>
                <div className="px-4 py-1.5 rounded-full text-zinc-700 dark:text-zinc-300 text-sm font-medium">
                  ${totalStake.toLocaleString()} Total
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full md:w-auto">
              <Button 
                onClick={() => setDepositModalOpen(true)}
                className="h-12 px-8 rounded-full bg-black dark:bg-white text-white dark:text-black font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2"
              >
                <ArrowUpRight className="w-4 h-4" />
                Boost Equity
              </Button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Equity Card & Logic */}
          <div className="lg:col-span-7 space-y-8">
            
            {/* 2. The "Equity Card" Control (The Liquidity Layer) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="relative overflow-hidden rounded-3xl p-8 bg-gradient-to-br from-zinc-100 to-white dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl"
            >
              <div className="absolute top-0 right-0 p-32 bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
              
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg text-white">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-black dark:text-white">Equity Card</h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Buying Power Access</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Available Limit</p>
                    <p className="text-2xl font-bold text-black dark:text-white">${spendingPower.toLocaleString()}</p>
                  </div>
                </div>

                {/* Spending Power Slider / Visualization */}
                <div className="mb-8">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-500 dark:text-zinc-400">Utilization</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium">0% Used</span>
                  </div>
                  <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700/50 relative">
                    {/* Background tick marks */}
                    <div className="absolute inset-0 flex justify-between px-2">
                       {[0, 25, 50, 75, 100].map(p => (
                         <div key={p} className="h-full w-px bg-zinc-300 dark:bg-zinc-700/50"></div>
                       ))}
                    </div>
                    <div className="h-full bg-blue-500 w-[0%] rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-400 mt-2">
                    <span>$0</span>
                    <span>${(spendingPower / 2).toLocaleString()}</span>
                    <span>${spendingPower.toLocaleString()}</span>
                  </div>
                </div>

                {/* The "One-Tap Transfer" */}
                <div className="bg-white/50 dark:bg-black/20 backdrop-blur-sm rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-black dark:text-white">Move Cash to Property</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Buy down principal instantly</p>
                  </div>
                  <Button variant="outline" className="rounded-full border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <ArrowRightLeft className="w-4 h-4 mr-2" />
                    Transfer
                  </Button>
                </div>
              </div>
            </motion.div>

            {/* The "Unified" Logic (Backend Rule Visualization) */}
            <div className="bg-zinc-50 dark:bg-zinc-900/30 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-4">Unified Protocol Logic</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-black dark:text-white text-sm">ESA = EA (1:1 Match)</h4>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      Depositing $1,000 Cash instantly increases Total Stake by $2,000 via the match program.
                    </p>
                  </div>
                </div>
                <div className="w-full h-px bg-zinc-200 dark:bg-zinc-800"></div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 mt-0.5">
                    <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-black dark:text-white text-sm">Smart Capital Priority</h4>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      Spends 0% interest Cash first. Then switches to Low-Interest Equity Draw automatically.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Property Portfolio & Growth */}
          <div className="lg:col-span-5 space-y-8">
            
            {/* 3. The "Property Portfolio" (Nested List) */}
            <div className="space-y-4">
              <h3 className="text-xl font-light text-black dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Property Portfolio
              </h3>
              
              {MOCK_PROPERTIES.map((property) => (
                <motion.div 
                  key={property.id}
                  whileHover={{ scale: 1.01 }}
                  className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-bl-full -mr-4 -mt-4 transition-opacity opacity-50 group-hover:opacity-100"></div>
                  
                  <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <Home className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                      </div>
                      <div>
                        <h4 className="font-medium text-black dark:text-white text-sm">{property.address}</h4>
                        <p className="text-xs text-zinc-500">{property.type} • {property.status}</p>
                      </div>
                    </div>
                    {/* Deed Protocol Badge */}
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-[10px] font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                      <ShieldCheck className="w-3 h-3 text-green-500" />
                      Synced
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4 relative z-10">
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Market Value</p>
                      <p className="font-medium text-black dark:text-white">${property.value.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Your Equity</p>
                      <p className="font-medium text-amber-600 dark:text-amber-500">${property.equity.toLocaleString()}</p>
                    </div>
                  </div>

                  {property.status === 'Renovation' && (
                    <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-zinc-500">Fixer Progress</span>
                        <span className="text-green-600 dark:text-green-500">+$12k Value Added</span>
                      </div>
                      <Progress value={45} className="h-1.5" />
                      <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                        <span>$5k Spent</span>
                        <span>Target: $25k</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
              
              <Button variant="ghost" className="w-full text-zinc-500 hover:text-black dark:hover:text-white text-sm">
                View All Properties
              </Button>
            </div>

            {/* 4. The "Path to 100%" (The Growth Chart) */}
            <div className="bg-zinc-900 text-white rounded-2xl p-6 relative overflow-hidden">
               {/* Background Chart Visualization */}
               <div className="absolute inset-0 opacity-20 pointer-events-none">
                  <svg className="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                    <path d="M0 40 L0 30 C 20 28, 40 35, 60 20 C 70 12, 80 5, 100 0 L 100 40 Z" fill="url(#gradient)" />
                    <defs>
                      <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#d97706" />
                      </linearGradient>
                    </defs>
                  </svg>
               </div>

               <div className="relative z-10">
                 <div className="flex items-center gap-2 mb-6">
                   <TrendingUp className="w-5 h-5 text-amber-400" />
                   <h3 className="font-medium">Path to 100% Equity</h3>
                 </div>

                 <div className="space-y-6">
                   <div className="flex justify-between items-end">
                     <div>
                       <p className="text-3xl font-light">7 Years</p>
                       <p className="text-xs text-zinc-400">Projected full ownership</p>
                     </div>
                     <div className="text-right">
                       <p className="text-amber-400 font-medium">+142%</p>
                       <p className="text-xs text-zinc-400">Growth</p>
                     </div>
                   </div>

                   {/* Pop Highlight */}
                   <div className="bg-white/10 backdrop-blur-md rounded-lg p-3 border border-white/10">
                     <div className="flex items-center gap-2 mb-1">
                       <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                       <span className="text-xs font-medium text-green-400">Renovation Pop Inbound</span>
                     </div>
                     <p className="text-sm">Estimated <span className="text-white font-medium">$15,000</span> gain upon completion of Aspen project.</p>
                   </div>
                 </div>
               </div>
            </div>

          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
