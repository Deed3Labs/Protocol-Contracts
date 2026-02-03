import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Coins,
  Lock,
  Ticket,
  Users,
  ChevronDown,
  X,
  Info,
  ArrowUpRight,
  Filter,
  ArrowUpDown,
  LockOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  id: number;
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
  { id: 1, type: 'Vault', amount: 10000, apy: 12, detail: '245 days left', icon: Lock, iconBg: 'bg-purple-50 dark:bg-purple-900/20', iconColor: 'text-purple-500' },
  { id: 2, type: 'Vault', amount: 5000, apy: 9.5, detail: '89 days left', icon: Lock, iconBg: 'bg-purple-50 dark:bg-purple-900/20', iconColor: 'text-purple-500' },
  { id: 3, type: 'Loan', amount: 15000, apy: 14, detail: '2 of 6 months', icon: Users, iconBg: 'bg-emerald-50 dark:bg-emerald-900/20', iconColor: 'text-emerald-500' },
  { id: 4, type: 'Bond', amount: 2, apy: 12, detail: 'Matures Dec 2031', icon: Ticket, iconBg: 'bg-amber-50 dark:bg-amber-900/20', iconColor: 'text-amber-500', symbol: 'ETH' },
];

// Mock CLRUSD balance data until token is deployed
const MOCK_CLRUSD_BALANCE = 25000;
const MOCK_CLRUSD_GROWTH_PCT = 7.9;
const MOCK_TVL_GROWTH_PCT = 12.4;
const MINT_CLRUSD_APY = 4.5;

export default function EarnHome() {
  const { isConnected } = useAppKitAccount();
  const { cashBalance: portfolioCashBalance, balances: multichainBalances } = usePortfolio();
  const cashBalance = portfolioCashBalance?.totalCash || 0;

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
  const [isActivePositionsExpanded, setIsActivePositionsExpanded] = useState(false);
  const [expandedActivePositionIds, setExpandedActivePositionIds] = useState<Set<number>>(new Set());
  const [loansModalOpen, setLoansModalOpen] = useState(false);
  const [loansSort, setLoansSort] = useState<'apr-desc' | 'amount-desc' | 'term-asc' | 'funded-desc'>('apr-desc');
  const [loansFilterCollateral, setLoansFilterCollateral] = useState<string>('All');
  const [loansFilterTerm, setLoansFilterTerm] = useState<string>('All');

  type RedeemAction = 'burn' | 'bonds' | 'vault' | 'loans';
  const [redeemAction, setRedeemAction] = useState<RedeemAction>('burn');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemPositionId, setRedeemPositionId] = useState<number | null>(null);

  const ACTIVE_POSITIONS_VISIBLE = 3;
  const displayedActivePositions = isActivePositionsExpanded
    ? ACTIVE_POSITIONS
    : ACTIVE_POSITIONS.slice(0, ACTIVE_POSITIONS_VISIBLE);

  const LOANS_VISIBLE = 2;
  const displayedLoans = LOANS.slice(0, LOANS_VISIBLE);

  const collateralOptions = useMemo(() => ['All', ...Array.from(new Set(LOANS.map((l) => l.collateral)))], []);
  const termOptions = useMemo(() => ['All', ...Array.from(new Set(LOANS.map((l) => `${l.term}mo`)))], []);

  const redeemableBonds = useMemo(() => ACTIVE_POSITIONS.filter((p) => p.type === 'Bond'), []);
  const redeemableVaults = useMemo(() => ACTIVE_POSITIONS.filter((p) => p.type === 'Vault'), []);
  const redeemableLoans = useMemo(() => ACTIVE_POSITIONS.filter((p) => p.type === 'Loan'), []);
  const selectedRedeemPosition = redeemAction === 'bonds'
    ? redeemableBonds.find((p) => p.id === redeemPositionId)
    : redeemAction === 'vault'
      ? redeemableVaults.find((p) => p.id === redeemPositionId)
      : redeemAction === 'loans'
        ? redeemableLoans.find((p) => p.id === redeemPositionId)
        : null;

  const modalLoans = useMemo(() => {
    let list = LOANS.filter((l) => {
      if (loansFilterCollateral !== 'All' && l.collateral !== loansFilterCollateral) return false;
      if (loansFilterTerm !== 'All' && `${l.term}mo` !== loansFilterTerm) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (loansSort === 'apr-desc') return b.apr - a.apr;
      if (loansSort === 'amount-desc') return b.amount - a.amount;
      if (loansSort === 'term-asc') return a.term - b.term;
      const pctA = (a.funded / a.amount) * 100;
      const pctB = (b.funded / b.amount) * 100;
      return pctB - pctA;
    });
    return list;
  }, [loansSort, loansFilterCollateral, loansFilterTerm]);

  const togglePositionExpanded = (id: number) => {
    setExpandedActivePositionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            {/* Balance (CLRUSD) Header - mock data until $CLRUSD is deployed */}
            <div>
              <div className="flex items-center gap-2 mt-4 mb-1 text-zinc-500 dark:text-zinc-500">
                <span className="text-sm font-medium">CLRUSD Balance</span>
                <div className="group relative">
                  <Info className="h-4 w-4 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-[220px]">
                    Your $CLRUSD balance; earns yield when minted or locked in vaults.
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
                        value={MOCK_CLRUSD_BALANCE}
                        previousValue={MOCK_CLRUSD_BALANCE * (1 - MOCK_CLRUSD_GROWTH_PCT / 100)}
                        className="font-light"
                      />
                      <span className="text-lg text-zinc-500 font-normal">CLRUSD</span>
                    </>
                  ) : (
                    <>
                      $0.00
                      <span className="text-lg text-zinc-500 font-normal">CLRUSD</span>
                    </>
                  )}
                </h1>
              </div>
              {isConnected && (
                <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                  +{MOCK_TVL_GROWTH_PCT}% this month
                </p>
              )}
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
                  disabled={!isConnected || cashBalance === 0}
                >
                  Withdraw Funds
                </button>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                  <p className={`text-xl font-medium ${stat.valueClass || 'text-black dark:text-white'}`}>{stat.value}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{stat.sub}</p>
                </motion.div>
              ))}
            </div>

            {/* Product cards grid */}
            <div>
              <h3 className="text-xl font-light text-black dark:text-white mb-6">Earn products</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Mint CLRUSD */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-visible hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                        <Coins className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-normal text-black dark:text-white">Mint CLRUSD</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Deposit stables → earn 4.5% APY</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-full text-xs text-blue-600 dark:text-blue-400 font-medium">4.5% APY</span>
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
                          className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                        />
                        <div className="relative shrink-0 w-28 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowMintTokens(!showMintTokens)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          >
                            <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: mintToken.color }} />
                            <span className="text-sm font-medium">{mintToken.symbol}</span>
                            <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                          </button>
                          <AnimatePresence>
                            {showMintTokens && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute right-0 left-auto top-full mt-1 w-40 min-w-0 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 shadow-xl z-20"
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
                    <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/10 rounded mb-3 border border-blue-200 dark:border-blue-800/30">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Est. earnings (1y)</span>
                      <span className="font-semibold text-green-600 dark:text-green-500">
                        +${(((parseFloat(mintAmount) || 0) * MINT_CLRUSD_APY) / 100).toFixed(2)}
                      </span>
                    </div>
                    <Button disabled={!mintAmount || parseFloat(mintAmount) <= 0} className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium disabled:opacity-40">
                      Mint CLRUSD
                    </Button>
                  </div>
                </motion.div>

                {/* Vault */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-visible hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-normal text-black dark:text-white">Vault CLRUSD</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Lock for boosted yields</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-purple-50 dark:bg-purple-900/20 rounded-full text-xs text-purple-600 dark:text-purple-400 font-medium">Upto 15% APY</span>
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
                    <Button disabled={!vaultAmount || parseFloat(vaultAmount) <= 0} className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white rounded-full font-medium disabled:opacity-40">
                      Lock CLRUSD
                    </Button>
                  </div>
                </motion.div>

                {/* Savings Bonds */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-visible hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                        <Ticket className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <h3 className="font-normal text-black dark:text-white">Savings Bonds</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Buy at discount, redeem at maturity</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/20 rounded-full text-xs text-amber-600 dark:text-amber-400 font-medium">Upto 18% off</span>
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
                          className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none text-black dark:text-white"
                        />
                        <div className="relative shrink-0 w-28 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowBondTokens(!showBondTokens)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          >
                            <div className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: bondToken.color }} />
                            <span className="text-sm font-medium">{bondToken.symbol}</span>
                            <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                          </button>
                          <AnimatePresence>
                            {showBondTokens && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute right-0 left-auto top-full mt-1 w-36 min-w-0 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 shadow-xl z-20"
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
                    <Button disabled={!bondAmount || parseFloat(bondAmount) <= 0} className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-black rounded-full font-medium disabled:opacity-40">
                      Mint Bond
                    </Button>
                  </div>
                </motion.div>

                {/* Loan Staking */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-visible hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors flex flex-col"
                >
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                        <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="font-normal text-black dark:text-white">Loan Staking</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Fund loans, earn interest pro-rata</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-full text-xs text-emerald-600 dark:text-emerald-400 font-medium">10–18% APR</span>
                  </div>
                  <div className="p-4 space-y-2 min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ maxHeight: 280 }}>
                    {displayedLoans.map((loan) => {
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
                            <span className="text-emerald-600 text-sm dark:text-emerald-400 font-medium">{loan.apr}% APR</span>
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
                  {LOANS.length > LOANS_VISIBLE && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800/50 shrink-0">
                      <button
                        type="button"
                        onClick={() => setLoansModalOpen(true)}
                        className="w-full flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-4 min-h-[52px]"
                      >
                        View All ({LOANS.length} loans)
                      </button>
                    </div>
                  )}
                </motion.div>
              </div>
            </div>
          </div>

          {/* Right: CTA first, then Active Positions (same sticky block so they scroll together) */}
          <div className="md:col-span-4 space-y-6 md:sticky md:top-28 md:self-start">
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

            {/* Redeem & Unlock – all-in-one */}
            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    <LockOpen className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-black dark:text-white">Unlock & Redeem</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Burn $CLRUSD, redeem bonds, or unlock assets</p>
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'burn' as const, label: 'Burn', icon: Coins },
                      { id: 'bonds' as const, label: 'Bonds', icon: Ticket },
                      { id: 'vault' as const, label: 'Vault', icon: Lock },
                      { id: 'loans' as const, label: 'Loans', icon: Users },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setRedeemAction(id);
                        setRedeemPositionId(null);
                        setRedeemAmount('');
                      }}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        redeemAction === id
                          ? 'bg-zinc-200 dark:bg-zinc-700 text-black dark:text-white border-zinc-300 dark:border-zinc-600'
                          : 'bg-white dark:bg-black/30 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>

                {redeemAction === 'burn' && (
                  <div className="space-y-3">
                    <div className="bg-white dark:bg-black/30 rounded-lg p-3 border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Amount to burn</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">Available: {MOCK_CLRUSD_BALANCE.toLocaleString()} CLRUSD</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={redeemAmount}
                          onChange={(e) => setRedeemAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          className="flex-1 bg-transparent text-base font-medium outline-none text-black dark:text-white"
                        />
                        <span className="text-zinc-500 dark:text-zinc-400 text-sm">CLRUSD</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRedeemAmount(String(MOCK_CLRUSD_BALANCE))}
                        className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1"
                      >
                        MAX
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800/30">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">You receive</span>
                      <span className="font-medium text-black dark:text-white text-sm">
                        {redeemAmount ? `~${(parseFloat(redeemAmount) || 0).toLocaleString()} USDC` : '—'}
                      </span>
                    </div>
                    <Button
                      disabled={!redeemAmount || parseFloat(redeemAmount) <= 0}
                      className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-medium disabled:opacity-40"
                    >
                      Burn CLRUSD → USDC
                    </Button>
                  </div>
                )}

                {redeemAction === 'bonds' && (
                  <div className="space-y-3">
                    {redeemableBonds.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">No bonds to redeem.</p>
                    ) : (
                      <>
                        <div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Select bond</p>
                          <Select
                            value={redeemPositionId != null ? String(redeemPositionId) : ''}
                            onValueChange={(v) => setRedeemPositionId(v ? Number(v) : null)}
                          >
                            <SelectTrigger size="xs" className="w-full text-xs border-zinc-300 dark:border-zinc-700 rounded-lg pl-2 pr-3 py-2 h-9">
                              <SelectValue placeholder="Choose bond" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-[60]">
                              {redeemableBonds.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)} className="text-sm py-1.5">
                                  {p.symbol ? `${p.amount} ${p.symbol}` : `$${p.amount.toLocaleString()}`} • {p.detail}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedRedeemPosition && (
                          <div className="flex items-center justify-between py-2 px-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800/30">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">Redeem value</span>
                            <span className="font-medium text-black dark:text-white text-sm">
                              {selectedRedeemPosition.symbol ? `${selectedRedeemPosition.amount} ${selectedRedeemPosition.symbol}` : `$${selectedRedeemPosition.amount.toLocaleString()}`}
                            </span>
                          </div>
                        )}
                        <Button
                          disabled={!selectedRedeemPosition}
                          className="w-full h-10 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-medium disabled:opacity-40"
                        >
                          Redeem Bond
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {redeemAction === 'vault' && (
                  <div className="space-y-3">
                    {redeemableVaults.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">No vault positions to unlock.</p>
                    ) : (
                      <>
                        <div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Select vault</p>
                          <Select
                            value={redeemPositionId != null ? String(redeemPositionId) : ''}
                            onValueChange={(v) => {
                              setRedeemPositionId(v ? Number(v) : null);
                              const pos = redeemableVaults.find((p) => p.id === Number(v));
                              if (pos) setRedeemAmount(String(pos.amount));
                            }}
                          >
                            <SelectTrigger size="xs" className="w-full text-xs border-zinc-300 dark:border-zinc-700 rounded-lg pl-2 pr-3 py-2 h-9">
                              <SelectValue placeholder="Choose vault" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-[60]">
                              {redeemableVaults.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)} className="text-sm py-1.5">
                                  ${p.amount.toLocaleString()} CLRUSD • {p.detail}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedRedeemPosition && (
                          <>
                            <div className="bg-white dark:bg-black/30 rounded-lg p-3 border border-zinc-200 dark:border-zinc-800">
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Amount to unlock</p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={redeemAmount}
                                  onChange={(e) => setRedeemAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                  placeholder="0.00"
                                  className="flex-1 bg-transparent text-base font-medium outline-none text-black dark:text-white"
                                />
                                <span className="text-zinc-500 dark:text-zinc-400 text-sm">CLRUSD</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRedeemAmount(selectedRedeemPosition ? String(selectedRedeemPosition.amount) : '')}
                                className="text-xs text-purple-600 dark:text-purple-400 font-medium mt-1"
                              >
                                MAX
                              </button>
                            </div>
                            <Button
                              disabled={!redeemAmount || parseFloat(redeemAmount) <= 0}
                              className="w-full h-10 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-sm font-medium disabled:opacity-40"
                            >
                              Unlock from Vault
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {redeemAction === 'loans' && (
                  <div className="space-y-3">
                    {redeemableLoans.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">No loan positions to unlock.</p>
                    ) : (
                      <>
                        <div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Select position</p>
                          <Select
                            value={redeemPositionId != null ? String(redeemPositionId) : ''}
                            onValueChange={(v) => {
                              setRedeemPositionId(v ? Number(v) : null);
                              const pos = redeemableLoans.find((p) => p.id === Number(v));
                              if (pos) setRedeemAmount(String(pos.amount));
                            }}
                          >
                            <SelectTrigger size="xs" className="w-full text-xs border-zinc-300 dark:border-zinc-700 rounded-lg pl-2 pr-3 py-2 h-9">
                              <SelectValue placeholder="Choose loan stake" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-[60]">
                              {redeemableLoans.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)} className="text-sm py-1.5">
                                  ${p.amount.toLocaleString()} • {p.detail}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedRedeemPosition && (
                          <>
                            <div className="bg-white dark:bg-black/30 rounded-lg p-3 border border-zinc-200 dark:border-zinc-800">
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Amount to unlock</p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={redeemAmount}
                                  onChange={(e) => setRedeemAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                  placeholder="0.00"
                                  className="flex-1 bg-transparent text-base font-medium outline-none text-black dark:text-white"
                                />
                                <span className="text-zinc-500 dark:text-zinc-400 text-sm">CLRUSD</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRedeemAmount(selectedRedeemPosition ? String(selectedRedeemPosition.amount) : '')}
                                className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1"
                              >
                                MAX
                              </button>
                            </div>
                            <Button
                              disabled={!redeemAmount || parseFloat(redeemAmount) <= 0}
                              className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-sm font-medium disabled:opacity-40"
                            >
                              Unlock from Loan
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded overflow-hidden">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/50">
                <h3 className="text-base font-medium text-black dark:text-white">Active Positions</h3>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {displayedActivePositions.map((pos) => {
                  const isExpanded = expandedActivePositionIds.has(pos.id);
                  const estEarnings1y = (pos.amount * pos.apy) / 100;
                  return (
                    <div key={pos.id} className="transition-colors">
                      <button
                        type="button"
                        onClick={() => togglePositionExpanded(pos.id)}
                        className="w-full p-4 flex items-center justify-between hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors text-left cursor-pointer group"
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
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="font-medium text-sm text-green-600 dark:text-green-500">{pos.apy}% APY</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">earning</p>
                          </div>
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                            className="text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </motion.div>
                        </div>
                      </button>
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
                            <div className="px-4 pb-4 pt-0 space-y-2 border-t border-zinc-200 dark:border-zinc-800/50 mt-0 pt-3">
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-500 dark:text-zinc-400">Position type</span>
                                <span className="font-medium text-black dark:text-white">{pos.type}</span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-500 dark:text-zinc-400">APY</span>
                                <span className="font-medium text-green-600 dark:text-green-500">{pos.apy}%</span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-zinc-500 dark:text-zinc-400">Est. earnings (1y)</span>
                                <span className="font-medium text-black dark:text-white">
                                  {pos.symbol ? `+${estEarnings1y.toFixed(4)} ${pos.symbol}` : `+$${estEarnings1y.toFixed(2)}`}
                                </span>
                              </div>
                              <div className="pt-2">
                                <button
                                  type="button"
                                  className="w-full py-2 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700"
                                >
                                  View details
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
              {ACTIVE_POSITIONS.length > ACTIVE_POSITIONS_VISIBLE && (
                <div className="border-t border-zinc-200 dark:border-zinc-800/50">
                  <button
                    type="button"
                    onClick={() => setIsActivePositionsExpanded(!isActivePositionsExpanded)}
                    className="w-full flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors py-4 min-h-[52px]"
                  >
                    {isActivePositionsExpanded
                      ? `Show Less (${ACTIVE_POSITIONS.length} total)`
                      : `View All (${ACTIVE_POSITIONS.length} positions)`}
                  </button>
                </div>
              )}
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
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
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
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-medium disabled:opacity-40"
                >
                  Fund Loan
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* All Loans Modal (View All with sort & filter) */}
      <AnimatePresence>
        {loansModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLoansModalOpen(false)}
              className="fixed inset-0 bg-black/60 dark:bg-black/70 z-50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-[calc(100vw-2rem)] md:w-full md:max-w-lg max-h-[85vh] z-50 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col shadow-xl min-w-0"
            >
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 min-w-0">
                <h3 className="font-semibold text-black dark:text-white truncate">All Loans</h3>
                <button
                  type="button"
                  onClick={() => setLoansModalOpen(false)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors shrink-0"
                >
                  <X className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                </button>
              </div>

              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0 w-full min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 w-full min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                    <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Sort</span>
                    <Select value={loansSort} onValueChange={(v) => setLoansSort(v as typeof loansSort)}>
                      <SelectTrigger
                        size="xs"
                        className="min-w-0 max-w-[130px] w-[130px] shrink text-xs font-normal text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded pl-2 pr-3 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800 [&>svg]:ml-0.5"
                      >
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-[100]">
                        <SelectItem value="apr-desc" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">APR (high to low)</SelectItem>
                        <SelectItem value="amount-desc" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Amount (high to low)</SelectItem>
                        <SelectItem value="term-asc" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">Term (short first)</SelectItem>
                        <SelectItem value="funded-desc" className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">% Funded (high first)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                    <Filter className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Filter</span>
                    <Select value={loansFilterCollateral} onValueChange={setLoansFilterCollateral}>
                      <SelectTrigger
                        size="xs"
                        className="min-w-0 max-w-[100px] sm:max-w-[120px] w-[100px] sm:w-[120px] shrink text-xs font-normal text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded pl-2 pr-3 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800 [&>svg]:ml-0.5"
                      >
                        <SelectValue placeholder="Collateral" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-[100]">
                        {collateralOptions.map((opt) => (
                          <SelectItem key={opt} value={opt} className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={loansFilterTerm} onValueChange={setLoansFilterTerm}>
                      <SelectTrigger
                        size="xs"
                        className="min-w-0 w-[80px] sm:w-[96px] shrink text-xs font-normal text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded pl-2 pr-3 py-0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors bg-transparent dark:bg-transparent focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800 [&>svg]:ml-0.5"
                      >
                        <SelectValue placeholder="Term" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-lg z-[100]">
                        {termOptions.map((opt) => (
                          <SelectItem key={opt} value={opt} className="text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 cursor-pointer py-1.5">{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="p-4 overflow-y-auto overscroll-contain space-y-2 flex-1 min-h-0 min-w-0">
                {modalLoans.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">No loans match the current filters.</p>
                ) : (
                  modalLoans.map((loan) => {
                    const pct = (loan.funded / loan.amount) * 100;
                    return (
                      <button
                        key={loan.id}
                        type="button"
                        onClick={() => {
                          setSelectedLoan(loan);
                          setLoansModalOpen(false);
                        }}
                        className="w-full p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-black dark:text-white">${loan.amount.toLocaleString()}</span>
                          <span className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">{loan.apr}% APR</span>
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
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
