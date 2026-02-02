import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Coins,
  Lock,
  Ticket,
  Users,
  ChevronDown,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const STABLECOINS = [
  { symbol: 'USDC', name: 'USD Coin', color: '#2775CA', balance: '12,500.00' },
  { symbol: 'USDT', name: 'Tether', color: '#26A17B', balance: '5,000.00' },
  { symbol: 'DAI', name: 'Dai', color: '#F5AC37', balance: '7,500.00' },
];

const VAULT_TIERS = [
  { months: 1, apy: 5.5, label: '1M' },
  { months: 3, apy: 7.0, label: '3M' },
  { months: 6, apy: 9.5, label: '6M' },
  { months: 12, apy: 12.0, label: '1Y' },
  { months: 24, apy: 15.0, label: '2Y' },
];

const BOND_TOKENS = [
  { symbol: 'ETH', color: '#627EEA', balance: '2.45' },
  { symbol: 'BTC', color: '#F7931A', balance: '0.15' },
  { symbol: 'SOL', color: '#9945FF', balance: '45.8' },
];

const BOND_MATURITIES = [
  { years: 1, discount: 5 },
  { years: 3, discount: 8 },
  { years: 5, discount: 12 },
  { years: 10, discount: 18 },
];

const LOANS = [
  { id: 1, borrower: '0x7a2...3f4b', amount: 150000, funded: 97500, apr: 11.5, term: 12, collateral: 'Real Estate', stakers: 6 },
  { id: 2, borrower: '0x9c1...8d2e', amount: 75000, funded: 52500, apr: 14.0, term: 6, collateral: 'Business', stakers: 4 },
  { id: 3, borrower: '0x3b5...1a9c', amount: 25000, funded: 7500, apr: 18.5, term: 3, collateral: 'Crypto', stakers: 2 },
];

interface ActivePosition {
  type: string;
  amount: number;
  apy: number;
  detail: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  symbol?: string;
}

const ACTIVE_POSITIONS: ActivePosition[] = [
  { type: 'Vault', amount: 10000, apy: 12, detail: '245 days left', icon: Lock, iconBg: 'bg-purple-50 dark:bg-purple-900/20', iconColor: 'text-purple-500' },
  { type: 'Vault', amount: 5000, apy: 9.5, detail: '89 days left', icon: Lock, iconBg: 'bg-purple-50 dark:bg-purple-900/20', iconColor: 'text-purple-500' },
  { type: 'Loan', amount: 15000, apy: 14, detail: '2 of 6 months', icon: Users, iconBg: 'bg-emerald-50 dark:bg-emerald-900/20', iconColor: 'text-emerald-500' },
  { type: 'Bond', amount: 2, apy: 12, detail: 'Matures Dec 2031', icon: Ticket, iconBg: 'bg-amber-50 dark:bg-amber-900/20', iconColor: 'text-amber-500', symbol: 'ETH' },
];

export default function EarnHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const { setActionModalOpen } = useGlobalModals();
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  const [mintAmount, setMintAmount] = useState('');
  const [mintToken, setMintToken] = useState(STABLECOINS[0]);
  const [showMintTokens, setShowMintTokens] = useState(false);

  const [vaultAmount, setVaultAmount] = useState('');
  const [vaultTier, setVaultTier] = useState(VAULT_TIERS[2]);

  const [bondAmount, setBondAmount] = useState('');
  const [bondToken, setBondToken] = useState(BOND_TOKENS[0]);
  const [bondMaturity, setBondMaturity] = useState(BOND_MATURITIES[2]);
  const [showBondTokens, setShowBondTokens] = useState(false);

  const [selectedLoan, setSelectedLoan] = useState<typeof LOANS[0] | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');

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

      <main className="pt-24 pb-28 container mx-auto max-w-7xl md:pt-32">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
          {/* Left: Stats + Product cards */}
          <div className="md:col-span-8 space-y-10">
            {/* Header: Earn + CLRUSD balance (placeholder until token deployed) */}
            <div>
              <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                <span className="text-sm font-medium">Earn</span>
              </div>
              <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                Total Value Locked
                <span className="text-lg text-zinc-500 font-normal">$47,250</span>
              </h1>
              <p className="text-sm text-green-600 dark:text-green-500 mt-1">+12.4% this month</p>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                <span>$25,000.00</span>
                <span className="text-zinc-500 dark:text-zinc-400">CLRUSD</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Value Locked', value: '$47,250', sub: '+12.4% this month', valueClass: '' },
                { label: 'Total Earnings', value: '+$1,842', sub: 'All time', valueClass: 'text-green-600 dark:text-green-500' },
                { label: 'Active Positions', value: '5', sub: '3 vaults, 2 loans', valueClass: '' },
                { label: 'Avg. APY', value: '11.2%', sub: 'Weighted average', valueClass: 'text-blue-600 dark:text-blue-400' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-4"
                >
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">{stat.label}</p>
                  <p className={`text-xl font-semibold text-black dark:text-white ${stat.valueClass}`}>{stat.value}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{stat.sub}</p>
                </motion.div>
              ))}
            </div>

            {/* Product cards grid */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Earn products</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Mint CLRUSD */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                        <Coins className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-black dark:text-white">Mint CLRUSD</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Deposit stables → earn 4.5% APY</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-full text-sm text-blue-600 dark:text-blue-400 font-medium">4.5% APY</span>
                  </div>
                  <div className="p-4">
                    <div className="bg-white dark:bg-black/30 rounded p-3 mb-3 border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Deposit</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">${mintToken.balance}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={mintAmount}
                          onChange={(e) => setMintAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          className="flex-1 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                        />
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowMintTokens(!showMintTokens)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          >
                            <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: mintToken.color }} />
                            <span className="text-sm font-medium">{mintToken.symbol}</span>
                            <ChevronDown className="w-3 h-3 text-zinc-500" />
                          </button>
                          <AnimatePresence>
                            {showMintTokens && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 shadow-xl z-10 overflow-hidden"
                              >
                                {STABLECOINS.map((t) => (
                                  <button
                                    key={t.symbol}
                                    type="button"
                                    onClick={() => { setMintToken(t); setShowMintTokens(false); }}
                                    className="w-full flex items-center gap-2 p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                                  >
                                    <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                    <span className="text-sm">{t.symbol}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white dark:bg-black/30 rounded mb-3 border border-zinc-200 dark:border-zinc-800">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">You receive</span>
                      <span className="font-medium text-black dark:text-white">{mintAmount || '0.00'} CLRUSD</span>
                    </div>
                    <Button disabled={!mintAmount || parseFloat(mintAmount) <= 0} className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-40">
                      Mint CLRUSD
                    </Button>
                  </div>
                </motion.div>

                {/* Vault */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-black dark:text-white">Vault CLRUSD</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Lock for boosted yields</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-purple-50 dark:bg-purple-900/20 rounded-full text-sm text-purple-600 dark:text-purple-400 font-medium">Up to 15% APY</span>
                  </div>
                  <div className="p-4">
                    <div className="flex gap-1 mb-3">
                      {VAULT_TIERS.map((tier) => (
                        <button
                          key={tier.months}
                          type="button"
                          onClick={() => setVaultTier(tier)}
                          className={`flex-1 py-2 rounded text-center transition-all text-sm ${
                            vaultTier.months === tier.months
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                              : 'bg-white dark:bg-black/30 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800'
                          }`}
                        >
                          <p className="text-xs">{tier.label}</p>
                          <p className="font-semibold">{tier.apy}%</p>
                        </button>
                      ))}
                    </div>
                    <div className="bg-white dark:bg-black/30 rounded p-3 mb-3 border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Lock amount</span>
                        <button type="button" onClick={() => setVaultAmount('25000')} className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                          MAX
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={vaultAmount}
                          onChange={(e) => setVaultAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          className="flex-1 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                        />
                        <span className="text-zinc-500 dark:text-zinc-400">CLRUSD</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/10 rounded mb-3 border border-purple-200 dark:border-purple-800/30">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Est. earnings</span>
                      <span className="font-semibold text-green-600 dark:text-green-500">
                        +${((parseFloat(vaultAmount) || 0) * vaultTier.apy / 100 * vaultTier.months / 12).toFixed(2)}
                      </span>
                    </div>
                    <Button disabled={!vaultAmount || parseFloat(vaultAmount) <= 0} className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white rounded font-medium disabled:opacity-40">
                      Lock CLRUSD
                    </Button>
                  </div>
                </motion.div>

                {/* Savings Bonds */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                        <Ticket className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-black dark:text-white">Savings Bonds</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Buy at discount, redeem at maturity</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/20 rounded-full text-sm text-amber-600 dark:text-amber-400 font-medium">Up to 18% off</span>
                  </div>
                  <div className="p-4">
                    <div className="bg-white dark:bg-black/30 rounded p-3 mb-3 border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Face value</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{bondToken.balance} {bondToken.symbol}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={bondAmount}
                          onChange={(e) => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          className="flex-1 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                        />
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowBondTokens(!showBondTokens)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          >
                            <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: bondToken.color }} />
                            <span className="text-sm font-medium">{bondToken.symbol}</span>
                            <ChevronDown className="w-3 h-3 text-zinc-500" />
                          </button>
                          <AnimatePresence>
                            {showBondTokens && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 shadow-xl z-10 overflow-hidden"
                              >
                                {BOND_TOKENS.map((t) => (
                                  <button
                                    key={t.symbol}
                                    type="button"
                                    onClick={() => { setBondToken(t); setShowBondTokens(false); }}
                                    className="w-full flex items-center gap-2 p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                                  >
                                    <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                    <span className="text-sm">{t.symbol}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 mb-3">
                      {BOND_MATURITIES.map((m) => (
                        <button
                          key={m.years}
                          type="button"
                          onClick={() => setBondMaturity(m)}
                          className={`flex-1 py-2 rounded text-center transition-all text-sm ${
                            bondMaturity.years === m.years
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                              : 'bg-white dark:bg-black/30 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800'
                          }`}
                        >
                          <p className="text-xs">{m.years}Y</p>
                          <p className="font-semibold">{m.discount}%</p>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/10 rounded mb-3 border border-amber-200 dark:border-amber-800/30">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">You deposit</span>
                      <span className="font-semibold text-black dark:text-white">
                        {((parseFloat(bondAmount) || 0) * (1 - bondMaturity.discount / 100)).toFixed(4)} {bondToken.symbol}
                      </span>
                    </div>
                    <Button disabled={!bondAmount || parseFloat(bondAmount) <= 0} className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-black rounded font-medium disabled:opacity-40">
                      Mint Bond
                    </Button>
                  </div>
                </motion.div>

                {/* Loan Staking */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors flex flex-col"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                        <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-black dark:text-white">Loan Staking</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Fund loans, earn interest pro-rata</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-full text-sm text-emerald-600 dark:text-emerald-400 font-medium">10–18% APR</span>
                  </div>
                  <div className="p-4 space-y-2 min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ maxHeight: 280 }}>
                    {LOANS.map((loan) => {
                      const pct = (loan.funded / loan.amount) * 100;
                      return (
                        <button
                          key={loan.id}
                          type="button"
                          onClick={() => setSelectedLoan(loan)}
                          className="w-full p-3 bg-white dark:bg-black/30 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 transition-colors text-left"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-black dark:text-white">${loan.amount.toLocaleString()}</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{loan.apr}% APR</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                            <span>{loan.collateral}</span>
                            <span>•</span>
                            <span>{loan.term}mo</span>
                            <span>•</span>
                            <span>{loan.stakers} stakers</span>
                          </div>
                          <Progress value={pct} className="h-1.5 bg-zinc-200 dark:bg-zinc-700" />
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-zinc-500 dark:text-zinc-400">{pct.toFixed(0)}% funded</span>
                            <span className="text-emerald-600 dark:text-emerald-400">${(loan.amount - loan.funded).toLocaleString()} left</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Right: Active Positions + CTA */}
          <div className="md:col-span-4 space-y-6">
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden md:sticky md:top-28">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50">
                <h3 className="font-semibold text-black dark:text-white">Active Positions</h3>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {ACTIVE_POSITIONS.map((pos, i) => (
                  <div
                    key={i}
                    className="p-4 flex items-center justify-between hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full ${pos.iconBg} flex items-center justify-center shrink-0`}>
                        <pos.icon className={`w-5 h-5 ${pos.iconColor}`} />
                      </div>
                      <div>
                        <p className="font-medium text-black dark:text-white">
                          {pos.symbol ? `${pos.amount} ${pos.symbol}` : `$${pos.amount.toLocaleString()}`}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{pos.type} • {pos.detail}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-green-600 dark:text-green-500">{pos.apy}% APY</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">earning</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-600 rounded-lg p-5 text-white">
              <h3 className="font-medium mb-2">Grow your savings</h3>
              <p className="text-sm text-blue-100 mb-4">Mint CLRUSD, lock in vaults, or stake on loans to earn yield on your stablecoins.</p>
              <Button
                variant="secondary"
                className="w-full bg-white text-blue-600 hover:bg-blue-50 rounded-full text-sm font-normal"
                onClick={() => setDepositModalOpen(true)}
              >
                Add Funds
              </Button>
            </div>
          </div>
        </div>
      </main>

      <MobileNav onMenuOpen={() => setMenuOpen(true)} onActionOpen={() => setActionModalOpen(true)} />

      {/* Loan Stake Modal */}
      <AnimatePresence>
        {selectedLoan && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLoan(null)}
              className="fixed inset-0 bg-black/60 dark:bg-black/70 z-50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md z-50 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh] shadow-xl"
            >
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
                <h3 className="font-semibold text-black dark:text-white">Fund Loan</h3>
                <button
                  type="button"
                  onClick={() => setSelectedLoan(null)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto overscroll-contain">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-4 mb-4 border border-zinc-200 dark:border-zinc-700">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">Amount</p>
                      <p className="font-medium text-black dark:text-white">${selectedLoan.amount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">APR</p>
                      <p className="font-medium text-emerald-600 dark:text-emerald-400">{selectedLoan.apr}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">Term</p>
                      <p className="font-medium text-black dark:text-white">{selectedLoan.term} months</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">Available</p>
                      <p className="font-medium text-black dark:text-white">${(selectedLoan.amount - selectedLoan.funded).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3 mb-4 border border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Your stake</span>
                    <button
                      type="button"
                      onClick={() => setStakeAmount((selectedLoan.amount - selectedLoan.funded).toString())}
                      className="text-xs text-emerald-600 dark:text-emerald-400 font-medium"
                    >
                      MAX
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      className="flex-1 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                    />
                    <span className="text-zinc-500 dark:text-zinc-400">CLRUSD</span>
                  </div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded p-4 mb-4 border border-emerald-200 dark:border-emerald-800/30 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">Your share</span>
                    <span className="font-medium text-black dark:text-white">{((parseFloat(stakeAmount) || 0) / selectedLoan.amount * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">Monthly payment</span>
                    <span className="font-medium text-black dark:text-white">${((parseFloat(stakeAmount) || 0) * selectedLoan.apr / 100 / 12).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">Total interest</span>
                    <span className="font-medium text-green-600 dark:text-green-500">+${((parseFloat(stakeAmount) || 0) * selectedLoan.apr / 100 * selectedLoan.term / 12).toFixed(2)}</span>
                  </div>
                </div>
                <Button
                  disabled={!stakeAmount || parseFloat(stakeAmount) <= 0}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium disabled:opacity-40"
                >
                  Fund Loan
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
