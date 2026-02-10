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
  Info
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

  // Derived Values
  const cashBalance = portfolioCashBalance?.totalCash || 12500; // Default mock if 0/undefined
  const totalStake = cashBalance + MOCK_PROPERTY_EQUITY;
  const spendingPower = totalStake * 0.5;

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
        <section className="mb-12">
          <div className="flex flex-col md:flex-row items-start justify-between gap-8 border-b border-zinc-200 dark:border-zinc-800 pb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide">Combined Equity Stake</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 text-green-600 dark:text-green-500 text-[10px] font-bold uppercase tracking-wider border border-green-500/20">
                  <span className="w-1.5 h-1.5 bg-green-500"></span>
                  1:1 Match Active
                </div>
              </div>
              
              <div className="flex items-baseline gap-2">
                <h1 className="text-6xl md:text-8xl font-light tracking-tighter text-black dark:text-white">
                  <LargePriceWheel value={totalStake} />
                </h1>
              </div>

              {/* The Breakdown - Flat Text */}
              <div className="mt-6 flex items-center gap-6 text-sm font-medium">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-600 dark:bg-blue-500"></div>
                  <span className="text-zinc-500 dark:text-zinc-400">Cash</span>
                  <span className="text-black dark:text-white">${cashBalance.toLocaleString()}</span>
                </div>
                <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-700"></div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-amber-500 dark:bg-amber-500"></div>
                  <span className="text-zinc-500 dark:text-zinc-400">Property</span>
                  <span className="text-black dark:text-white">${MOCK_PROPERTY_EQUITY.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full md:w-auto self-end">
              <Button 
                onClick={() => setDepositModalOpen(true)}
                className="h-12 px-8 rounded-none bg-black dark:bg-white text-white dark:text-black font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2 uppercase tracking-wide text-xs"
              >
                <ArrowUpRight className="w-4 h-4" />
                Boost Equity
              </Button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Equity Card & Logic */}
          <div className="lg:col-span-7 space-y-12">
            
            {/* 2. The "Equity Card" Control (The Liquidity Layer) */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-black dark:text-white flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Equity Card
                </h3>
                <div className="text-right">
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 uppercase tracking-wide mb-1">Available Limit</p>
                  <p className="text-xl font-medium text-black dark:text-white font-mono">${spendingPower.toLocaleString()}</p>
                </div>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/20 p-6 md:p-8">
                {/* Spending Power Slider / Visualization */}
                <div className="mb-8">
                  <div className="flex justify-between text-xs font-medium uppercase tracking-wide mb-3">
                    <span className="text-zinc-500 dark:text-zinc-500">Utilization</span>
                    <span className="text-blue-600 dark:text-blue-500">0% Used</span>
                  </div>
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-800 w-full relative">
                    <div className="absolute top-0 left-0 h-full bg-blue-600 dark:bg-blue-500 w-[0%]"></div>
                    {/* Tick marks */}
                    <div className="absolute top-0 left-1/4 h-full w-px bg-white dark:bg-zinc-900"></div>
                    <div className="absolute top-0 left-1/2 h-full w-px bg-white dark:bg-zinc-900"></div>
                    <div className="absolute top-0 left-3/4 h-full w-px bg-white dark:bg-zinc-900"></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 uppercase font-mono mt-2">
                    <span>$0</span>
                    <span>${(spendingPower / 2).toLocaleString()}</span>
                    <span>${spendingPower.toLocaleString()}</span>
                  </div>
                </div>

                {/* The "One-Tap Transfer" */}
                <div className="flex items-center justify-between pt-6 border-t border-zinc-200 dark:border-zinc-800">
                  <div>
                    <p className="font-medium text-black dark:text-white text-sm">Move Cash to Property</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Buy down principal instantly</p>
                  </div>
                  <Button variant="outline" className="rounded-none border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 uppercase text-xs tracking-wide h-9">
                    <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                    Transfer
                  </Button>
                </div>
              </div>
            </div>

            {/* The "Unified" Logic (Backend Rule Visualization) */}
            <div>
              <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Info className="w-3.5 h-3.5" />
                Protocol Logic
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-1.5 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-500">
                      <Zap className="w-4 h-4" />
                    </div>
                    <h4 className="font-medium text-black dark:text-white text-sm">ESA = EA (1:1 Match)</h4>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Depositing $1,000 Cash instantly increases Total Stake by $2,000 via the match program.
                  </p>
                </div>
                
                <div className="border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <h4 className="font-medium text-black dark:text-white text-sm">Smart Capital Priority</h4>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Spends 0% interest Cash first. Then switches to Low-Interest Equity Draw automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Property Portfolio & Growth */}
          <div className="lg:col-span-5 space-y-12">
            
            {/* 3. The "Property Portfolio" (Nested List) */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-black dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Property Portfolio
                </h3>
              </div>
              
              <div className="space-y-4">
                {MOCK_PROPERTIES.map((property) => (
                  <motion.div 
                    key={property.id}
                    whileHover={{ y: -2 }}
                    className="group border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                          <Home className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-medium text-black dark:text-white text-sm">{property.address}</h4>
                          <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                            <span>{property.type}</span>
                            <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full"></span>
                            <span>{property.status}</span>
                          </div>
                        </div>
                      </div>
                      {/* Deed Protocol Badge */}
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
                        <ShieldCheck className="w-3 h-3 text-green-500" />
                        Synced
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-100 dark:border-zinc-900">
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Market Value</p>
                        <p className="font-medium text-black dark:text-white font-mono">${property.value.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Your Equity</p>
                        <p className="font-medium text-amber-600 dark:text-amber-500 font-mono">${property.equity.toLocaleString()}</p>
                      </div>
                    </div>

                    {property.status === 'Renovation' && (
                      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-900">
                        <div className="flex justify-between text-xs mb-2">
                          <span className="text-zinc-500 font-medium">Fixer Progress</span>
                          <span className="text-green-600 dark:text-green-500 font-medium text-[10px] uppercase">+$12k Value Added</span>
                        </div>
                        <Progress value={45} className="h-1 bg-zinc-100 dark:bg-zinc-900 rounded-none" />
                        <div className="flex justify-between text-[10px] text-zinc-400 mt-2 font-mono">
                          <span>$5k Spent</span>
                          <span>Target: $25k</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
              
              <Button variant="ghost" className="w-full mt-4 text-zinc-500 hover:text-black dark:hover:text-white text-xs uppercase tracking-wide hover:bg-transparent">
                View All Properties →
              </Button>
            </div>

            {/* 4. The "Path to 100%" (The Growth Chart) */}
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/20 p-6">
               <div className="flex items-center justify-between mb-6">
                 <div className="flex items-center gap-2">
                   <TrendingUp className="w-4 h-4 text-amber-500" />
                   <h3 className="font-medium text-sm text-black dark:text-white uppercase tracking-wide">Path to 100% Equity</h3>
                 </div>
                 <div className="text-right">
                   <p className="text-amber-600 dark:text-amber-500 font-medium text-sm font-mono">+142%</p>
                 </div>
               </div>

               <div className="h-32 w-full relative border-b border-l border-zinc-300 dark:border-zinc-700 mb-4">
                  {/* Simple SVG Chart Line */}
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <path d="M0 128 L 50 110 L 100 105 L 150 90 L 200 60 L 250 40 L 300 0" vectorEffect="non-scaling-stroke" stroke="currentColor" strokeWidth="2" fill="none" className="text-amber-500" />
                    {/* Pop Highlight Marker */}
                    <circle cx="200" cy="60" r="4" className="fill-green-500" />
                  </svg>
                  
                  {/* Pop Label */}
                  <div className="absolute top-[30%] left-[60%] bg-white dark:bg-zinc-900 border border-green-500/30 px-2 py-1 text-[10px] text-green-600 dark:text-green-500 shadow-sm">
                    Renovation Pop
                  </div>
               </div>

               <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                 <span>Now</span>
                 <span>7 Years</span>
               </div>
            </div>

          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />
    </div>
  );
}
