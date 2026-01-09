import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Info, ArrowUpRight, ArrowRight, ShieldCheck, Home, Zap } from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import ActionModal from './ActionModal';

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
    rate: '4.5% - 7.5% APR',
    limit: 'Up to 60% LTV',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    id: 'mortgage',
    title: 'RWA Mortgages',
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
      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32 px-4 md:px-0">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
           {/* Left Column (Main Data & Loans) */}
           <div className="md:col-span-8 space-y-10">
              
              {/* Header Section */}
              <div>
                 <div className="flex items-center gap-2 mb-2 text-zinc-500 dark:text-zinc-400">
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
                    <button className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4" />
                      Increase Power
                    </button>
                    <button className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800">
                      Loan Calculator
                    </button>
                 </div>
              </div>

              {/* Visualization Bar */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded-xl border border-zinc-200 dark:border-zinc-800/50 p-6">
                 <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-500">Utilization</span>
                    <span className="text-black dark:text-white font-medium">{utilization.toFixed(1)}%</span>
                 </div>
                 <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${utilization}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className="h-full bg-blue-600 rounded-full"
                    />
                 </div>
                 <div className="flex justify-between text-xs text-zinc-500 mt-2">
                    <span>${usedPower.toLocaleString()} used</span>
                    <span>${totalLimit.toLocaleString()} total limit</span>
                 </div>
              </div>

              {/* Loan Types Grid */}
              <div>
                <h3 className="text-xl font-light text-black dark:text-white mb-6">Loan Products</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {loanTypes.map((loan) => (
                    <motion.div 
                      key={loan.id}
                      whileHover={{ scale: 1.01 }}
                      className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-xl p-6 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
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
              
              {/* Active Loans Widget */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded-xl border border-zinc-200 dark:border-zinc-800/50 overflow-hidden">
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="text-base font-medium text-black dark:text-white">Active Loans</h2>
                    <button className="text-xs text-blue-600 hover:text-blue-500">View All</button>
                  </div>
                  <div className="p-2">
                    {currentLoans.map((loan) => (
                      <div key={loan.id} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer">
                         <div className="flex justify-between mb-1">
                            <span className="text-sm font-medium text-black dark:text-white">{loan.type}</span>
                            <span className="text-sm font-medium text-black dark:text-white">${loan.amount.toLocaleString()}</span>
                         </div>
                         <div className="flex justify-between text-xs text-zinc-500">
                            <span>Due {loan.dueDate}</span>
                            <span className="text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">{loan.status}</span>
                         </div>
                      </div>
                    ))}
                    {currentLoans.length === 0 && (
                      <div className="p-8 text-center text-zinc-500 text-sm">
                        No active loans
                      </div>
                    )}
                  </div>
              </div>

              {/* Market Rates Widget */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded-xl border border-zinc-200 dark:border-zinc-800/50 p-1">
                  <div className="p-4">
                    <h2 className="text-base font-medium text-black dark:text-white mb-4">Current Rates</h2>
                    <div className="space-y-3">
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-500">Base Rate</span>
                          <span className="text-black dark:text-white">4.50%</span>
                       </div>
                       <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-500">Spread</span>
                          <span className="text-black dark:text-white">+1.50%</span>
                       </div>
                       <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-2" />
                       <div className="flex justify-between items-center text-sm font-medium">
                          <span className="text-black dark:text-white">Your Effective Rate</span>
                          <span className="text-blue-600">6.00%</span>
                       </div>
                    </div>
                  </div>
              </div>

              {/* Help Box */}
              <div className="bg-blue-600 rounded-xl p-5 text-white">
                 <h3 className="font-medium mb-2">Need help?</h3>
                 <p className="text-sm text-blue-100 mb-4">Talk to our loan specialists about custom financing options for your assets.</p>
                 <button className="w-full bg-white text-blue-600 py-2 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors">
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
