import { useState, useEffect } from 'react';
import { Search, ArrowUpRight, ArrowDownLeft, TrendingUp, Newspaper, Calendar, FileText, ChevronRight, SlidersHorizontal, Info } from 'lucide-react';
import SideMenu from './SideMenu';
import HeaderNav from './HeaderNav';
import MobileNav from './MobileNav';
import DepositModal from './DepositModal';
import WithdrawModal from './WithdrawModal';
import ActionModal from './ActionModal';

// Mock Data
const assetCategories = ['All', 'Equities', 'ETFs', 'Indices', 'Deeds/RWAs', 'Collectibles', 'Tokens'];

const trendingAssets = [
  { id: 1, symbol: 'TSLA', name: 'Tesla Inc.', price: 274.96, change: 5.2, type: 'Equity' },
  { id: 2, symbol: 'BTC', name: 'Bitcoin', price: 64230.50, change: 2.1, type: 'Token' },
  { id: 3, symbol: 'RWA-104', name: 'Miami Condo Fund', price: 104.20, change: 0.8, type: 'Deed/RWA' },
  { id: 4, symbol: 'SPY', name: 'SPDR S&P 500', price: 432.10, change: -0.5, type: 'ETF' },
];

const newsArticles = [
  { id: 1, title: 'Tokenized Real Estate Market hits $10B Cap', source: 'DeFi Daily', time: '2h ago', image: 'bg-blue-100 dark:bg-blue-900' },
  { id: 2, title: 'Tesla Announces New Battery Tech', source: 'MarketWatch', time: '4h ago', image: 'bg-red-100 dark:bg-red-900' },
  { id: 3, title: 'Crypto Regulation Talks Heat Up', source: 'CoinDesk', time: '5h ago', image: 'bg-amber-100 dark:bg-amber-900' },
];

const upcomingEvents = [
  { id: 1, title: 'Apple Earnings Call', date: 'Oct 28', time: '4:30 PM EST', type: 'Earnings' },
  { id: 2, title: 'Fed Interest Rate Decision', date: 'Nov 1', time: '2:00 PM EST', type: 'Economic' },
];

const reports = [
  { id: 1, title: 'Q4 2025 Market Outlook', author: 'ClearPath Research', date: 'Oct 15' },
  { id: 2, title: 'State of RWAs Report', author: 'DeFi Institute', date: 'Oct 10' },
];

export default function MarketsHome() {
  const [user] = useState<any>({ name: 'Isaiah Litt' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Mock values
  const totalValue = 13.76;
  const buyingPower = 13.76; // Cash available for trading

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
      
      {/* Modals */}
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
           
           {/* Left Column (Main Feed) */}
           <div className="md:col-span-8 space-y-8">
              
              {/* Buying Power Header */}
              <div>
                 <div className="flex items-center gap-2 mt-4 mb-2 text-zinc-500 dark:text-zinc-400">
                   <span className="text-sm font-medium">Buying Power</span>
                   <div className="group relative">
                      <Info className="h-4 w-4 cursor-help" />
                   </div>
                 </div>
                 <h1 className="text-[42px] font-light text-black dark:text-white tracking-tight flex items-baseline gap-2">
                   ${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   <span className="text-lg text-zinc-500 font-normal">USD</span>
                 </h1>
                 
                 <div className="mt-6 flex flex-wrap gap-3">
                    <button 
                      onClick={() => setDepositModalOpen(true)}
                      className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                      Increase Power
                    </button>
                    <button 
                      onClick={() => setWithdrawModalOpen(true)}
                      className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white px-6 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800"
                    >
                      Withdraw Funds
                    </button>
                 </div>
              </div>

              {/* Search & Filter Bar */}
              <div className="sticky top-18 z-30 bg-white/80 dark:bg-[#0e0e0e]/80 backdrop-blur-md py-4 -mx-4 px-4 md:mx-0 md:px-0 border-b border-zinc-100 dark:border-zinc-800/50">
                  <div className="flex gap-2 mb-4">
                     <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input 
                           type="text" 
                           placeholder="Search assets, symbols, news..." 
                           value={searchQuery}
                           onChange={(e) => setSearchQuery(e.target.value)}
                           className="w-full bg-zinc-100 dark:bg-zinc-900 border-none rounded py-3 pl-10 pr-4 text-sm focus:ring-1 focus:ring-black dark:focus:ring-white transition-all"
                        />
                     </div>
                     <button className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
                        <SlidersHorizontal className="w-5 h-5 text-black dark:text-white" />
                     </button>
                  </div>
                  
                  {/* Category Tabs */}
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                     {assetCategories.map(category => (
                        <button
                           key={category}
                           onClick={() => setSelectedCategory(category)}
                           className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                              selectedCategory === category 
                                 ? 'bg-black dark:bg-white text-white dark:text-black' 
                                 : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                           }`}
                        >
                           {category}
                        </button>
                     ))}
                  </div>
              </div>

              {/* Featured / Trending Assets */}
              <div>
                 <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-light text-black dark:text-white flex items-center gap-2">
                       <TrendingUp className="w-5 h-5" />
                       Trending
                    </h3>
                    <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline">View All</button>
                 </div>
                 
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {trendingAssets.map((asset) => (
                       <div key={asset.id} className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-4 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group">
                          <div className="flex justify-between items-start mb-2">
                             <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center shadow-sm text-xs font-bold">
                                   {asset.symbol[0]}
                                </div>
                                <div>
                                   <h4 className="font-medium text-black dark:text-white">{asset.symbol}</h4>
                                   <p className="text-xs text-zinc-500">{asset.name}</p>
                                </div>
                             </div>
                             <div className={`flex items-center text-sm font-medium ${asset.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {asset.change >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownLeft className="w-3 h-3 mr-0.5" />}
                                {Math.abs(asset.change)}%
                             </div>
                          </div>
                          <div className="flex justify-between items-end mt-4">
                             <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                {asset.type}
                             </span>
                             <span className="text-lg font-medium text-black dark:text-white">
                                ${asset.price.toLocaleString()}
                             </span>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>

              {/* News Section */}
              <div>
                 <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-light text-black dark:text-white flex items-center gap-2">
                       <Newspaper className="w-5 h-5" />
                       News & Articles
                    </h3>
                    <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline">View All</button>
                 </div>
                 
                 <div className="space-y-4">
                    {newsArticles.map((article) => (
                       <div key={article.id} className="flex gap-4 p-4 bg-white dark:bg-zinc-900/10 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors cursor-pointer">
                          <div className={`w-20 h-20 rounded-md shrink-0 ${article.image}`} />
                          <div className="flex flex-col justify-between py-0.5">
                             <h4 className="font-medium text-black dark:text-white line-clamp-2">{article.title}</h4>
                             <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <span className="font-medium text-zinc-700 dark:text-zinc-300">{article.source}</span>
                                <span>•</span>
                                <span>{article.time}</span>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>

           </div>

           {/* Right Column (Sidebar Widgets) */}
           <div className="md:col-span-4 space-y-8">
              
              {/* Calls & Events Widget */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-6">
                 <div className="flex items-center gap-2 mb-4 text-black dark:text-white font-medium">
                    <Calendar className="w-5 h-5" />
                    <h3>Calls & Events</h3>
                 </div>
                 <div className="space-y-4">
                    {upcomingEvents.map(event => (
                       <div key={event.id} className="flex gap-3 items-start">
                          <div className="w-12 h-12 rounded bg-white dark:bg-zinc-800 flex flex-col items-center justify-center border border-zinc-100 dark:border-zinc-700 shrink-0">
                             <span className="text-[10px] text-zinc-500 uppercase">{event.date.split(' ')[0]}</span>
                             <span className="text-sm font-bold text-black dark:text-white">{event.date.split(' ')[1]}</span>
                          </div>
                          <div>
                             <p className="text-sm font-medium text-black dark:text-white leading-tight mb-1">{event.title}</p>
                             <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <span>{event.time}</span>
                                <span className="w-1 h-1 bg-zinc-400 rounded-full"></span>
                                <span>{event.type}</span>
                             </div>
                          </div>
                       </div>
                    ))}
                    <button className="w-full mt-2 py-2 text-sm text-center text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white border border-zinc-200 dark:border-zinc-800 rounded-sm hover:bg-white dark:hover:bg-zinc-800 transition-all">
                       View Calendar
                    </button>
                 </div>
              </div>

              {/* Reports & Predictions Widget */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-6">
                 <div className="flex items-center gap-2 mb-4 text-black dark:text-white font-medium">
                    <FileText className="w-5 h-5" />
                    <h3>Reports & Predictions</h3>
                 </div>
                 <div className="space-y-3">
                    {reports.map(report => (
                       <div key={report.id} className="group flex items-center justify-between p-3 bg-white dark:bg-zinc-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 border border-zinc-100 dark:border-zinc-800 rounded-sm cursor-pointer transition-colors">
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                <FileText className="w-4 h-4" />
                             </div>
                             <div>
                                <p className="text-sm font-medium text-black dark:text-white line-clamp-1">{report.title}</p>
                                <p className="text-xs text-zinc-500">{report.author} • {report.date}</p>
                             </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
                       </div>
                    ))}
                    <button className="w-full mt-2 text-xs text-center text-blue-600 dark:text-blue-400 hover:underline">
                       Browse Research Library
                    </button>
                 </div>
              </div>
              
              {/* Promo / Ad Space */}
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-6 text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-4 opacity-10">
                    <TrendingUp className="w-24 h-24" />
                 </div>
                 <h3 className="text-lg font-bold mb-2 relative z-10">Pro Market Analysis</h3>
                 <p className="text-sm text-blue-100 mb-4 relative z-10">Get access to institutional-grade data and real-time signals.</p>
                 <button className="bg-white text-blue-700 px-4 py-2 rounded-full text-sm font-normal hover:bg-blue-50 transition-colors relative z-10">
                    Unlock Pro
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
