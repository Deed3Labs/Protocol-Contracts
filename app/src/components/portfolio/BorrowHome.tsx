import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Info, ArrowUpRight, ArrowRight, ShieldCheck, Home, Zap } from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import ActionModal from './ActionModal';
import CreditCycleWidget from './CreditCycleWidget';
import ActiveLoansWidget from './ActiveLoansWidget';
import MarketRatesWidget from './MarketRatesWidget';
import UtilizationWidget from './UtilizationWidget';

// Mock Data
const loanTypes = [
  {
    id: 'quick',
    title: 'Quick Loans',
    description: 'Instant liquidity for short-term needs up to $500.',
    icon: Zap,
    rate: '0% APR',
    limit: '$500',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    id: 'secured',
    title: 'Secured Loans',
    description: 'Borrow against your portfolio assets with competitive LTV ratios.',
    icon: ShieldCheck,
    rate: 'Flexible Terms',
    limit: 'Up to 95% LTV',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    id: 'mortgage',
    title: 'Purchase Loans',
    description: 'Long-term financing for real world asset purchases.',
    icon: Home,
    rate: '5.5% - 8.5% APR',
    limit: 'Based on Asset',
    color: 'bg-purple-500',
    textColor: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
  }
];

const currentLoans = [
  { id: 1, type: 'Secured Loan', amount: 1250.00, rate: '5.2%', dueDate: 'Nov 15', status: 'Active' },
];

export default function BorrowHome() {
  const [user] = useState<any>({ name: 'Isaiah Litt' }); // Mock user
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  // Mock values
  const totalValue = 13.76;
  const borrowingPower = 8500.00;
  const usedPower = 1250.00;
  const totalLimit = 15000.00;
  const utilization = (usedPower / totalLimit) * 100;

  useEffect(() => {
    const handleScroll = () => {
      const threshold = 50;
      setIsScrolledPast(window.scrollY > threshold);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans pb-20 md:pb-0 transition-colors duration-200">
      {/* Side Menu */}
      <SideMenu 
        isOpen={menuOpen} 
        onClose={() => setMenuOpen(false)} 
        user={user}
        totalValue={totalValue}
      />
      
      {/* Modals - keeping consistent with BrokerageHome */}
      <DepositModal 
        isOpen={depositModalOpen} 
        onClose={() => setDepositModalOpen(false)} 
      />
      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        withdrawableBalance={totalValue}
      />
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
           {/* Left Column (Main Data & Loans) */}
           <div className="md:col-span-8 space-y-10">
              
              {/* Header Section */}
              <div>
                 <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                   <span className="text-sm font-medium">Available Borrowing Power</span>
                   <div className="group relative">
                      <Info className="h-4 w-4 cursor-help" />
                   </div>
                 </div>
                 <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                   ${borrowingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   <span className="text-lg text-zinc-500 font-normal">USD</span>
                 </h1>
                 
                 <div className="mt-6 flex flex-wrap gap-3">
                    <button className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4" />
                      Increase Power
                    </button>
                    <button className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800">
                      Loan Calculator
                    </button>
                 </div>
              </div>

              {/* Visualization Bar */}
              <UtilizationWidget 
                utilization={utilization} 
                usedPower={usedPower} 
                totalLimit={totalLimit} 
              />

              {/* Loan Types Grid */}
              <div>
                <h3 className="text-xl font-light text-black dark:text-white mb-6">Loan Products</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {loanTypes.map((loan) => (
                    <motion.div 
                      key={loan.id}
                      whileHover={{ scale: 1.01 }}
                      className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-6 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                    >
                       <div className="flex justify-between items-start mb-4">
                          <div className={`w-10 h-10 rounded-full ${loan.bgColor} flex items-center justify-center`}>
                             <loan.icon className={`w-5 h-5 ${loan.textColor}`} />
                          </div>
                          <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 px-3 py-1 rounded-full text-xs font-medium">
                             {loan.rate}
                          </div>
                       </div>
                       <h4 className="text-lg font-medium text-black dark:text-white mb-2">{loan.title}</h4>
                       <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 h-10">{loan.description}</p>
                       <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                          <span className="text-xs font-medium text-zinc-500">{loan.limit}</span>
                          <ArrowRight className="w-4 h-4 text-zinc-400" />
                       </div>
                    </motion.div>
                  ))}
                </div>
              </div>
           </div>

           {/* Right Column (Active Loans & Stats) */}
           <div className="md:col-span-4 space-y-6">
              
              {/* Credit Cycle Widget */}
              <CreditCycleWidget />

              {/* Active Loans Widget */}
              <ActiveLoansWidget loans={currentLoans} />

              {/* Market Rates Widget */}
              <MarketRatesWidget />

              {/* Help Box */}
              <div className="bg-blue-600 rounded-lg p-5 text-white">
                 <h3 className="font-medium mb-2">Need help?</h3>
                 <p className="text-sm text-blue-100 mb-4">Talk to our loan specialists about custom financing options for your assets.</p>
                 <button className="w-full bg-white text-blue-600 py-2 rounded-full text-sm font-normal hover:bg-blue-50 transition-colors">
                   Contact Support
                 </button>
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
