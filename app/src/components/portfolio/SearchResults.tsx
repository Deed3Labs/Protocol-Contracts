import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, TrendingUp, Newspaper, Calendar, FileText, ChevronRight } from 'lucide-react';

// Types
interface SearchResult {
  id: number;
  symbol?: string;
  name?: string;
  price?: number;
  change?: number;
  type?: string;
  source?: string;
  time?: string;
  image?: string;
  title?: string;
  author?: string;
  date?: string;
  timeEvent?: string;
  eventType?: string;
}

interface SearchResultsProps {
  query: string;
}

// Mock search function - in real app, this would be an API call
const performSearch = (query: string): Record<string, SearchResult[]> => {
  if (!query.trim()) return {};

  const lowerQuery = query.toLowerCase();
  const results: Record<string, SearchResult[]> = {
    'Equities': [],
    'ETFs & Indices': [],
    'Collectibles': [],
    'News & Articles': [],
    'Reports & Predictions': [],
    'Calls and Events': [],
  };

  // Mock data - Equities
  const equities = [
    { id: 1, symbol: 'TSLA', name: 'Tesla Inc.', price: 274.96, change: 5.2, type: 'Equity' },
    { id: 2, symbol: 'AAPL', name: 'Apple Inc.', price: 178.50, change: 1.3, type: 'Equity' },
    { id: 3, symbol: 'MSFT', name: 'Microsoft Corporation', price: 378.20, change: -0.8, type: 'Equity' },
    { id: 4, symbol: 'GOOGL', name: 'Alphabet Inc.', price: 142.30, change: 2.1, type: 'Equity' },
  ];
  equities.forEach(equity => {
    if (equity.symbol.toLowerCase().includes(lowerQuery) || equity.name.toLowerCase().includes(lowerQuery)) {
      results['Equities'].push(equity);
    }
  });

  // Mock data - ETFs & Indices
  const etfs = [
    { id: 5, symbol: 'SPY', name: 'SPDR S&P 500', price: 432.10, change: -0.5, type: 'ETF' },
    { id: 6, symbol: 'QQQ', name: 'Invesco QQQ Trust', price: 367.80, change: 1.2, type: 'ETF' },
    { id: 7, symbol: 'DIA', name: 'SPDR Dow Jones', price: 338.90, change: 0.3, type: 'ETF' },
  ];
  etfs.forEach(etf => {
    if (etf.symbol.toLowerCase().includes(lowerQuery) || etf.name.toLowerCase().includes(lowerQuery)) {
      results['ETFs & Indices'].push(etf);
    }
  });

  // Mock data - Collectibles
  const collectibles = [
    { id: 8, symbol: 'NFT-001', name: 'CryptoPunk #1234', price: 12.5, change: 8.3, type: 'Collectible' },
    { id: 9, symbol: 'ART-042', name: 'Digital Art Collection', price: 5.2, change: -2.1, type: 'Collectible' },
  ];
  collectibles.forEach(collectible => {
    if (collectible.symbol.toLowerCase().includes(lowerQuery) || collectible.name.toLowerCase().includes(lowerQuery)) {
      results['Collectibles'].push(collectible);
    }
  });

  // Mock data - News & Articles
  const news = [
    { id: 10, title: 'Tokenized Real Estate Market hits $10B Cap', source: 'DeFi Daily', time: '2h ago', image: 'bg-blue-100 dark:bg-blue-900' },
    { id: 11, title: 'Tesla Announces New Battery Tech', source: 'MarketWatch', time: '4h ago', image: 'bg-red-100 dark:bg-red-900' },
    { id: 12, title: 'Crypto Regulation Talks Heat Up', source: 'CoinDesk', time: '5h ago', image: 'bg-amber-100 dark:bg-amber-900' },
    { id: 13, title: 'Apple Reports Record Q4 Earnings', source: 'Bloomberg', time: '6h ago', image: 'bg-green-100 dark:bg-green-900' },
  ];
  news.forEach(article => {
    if (article.title.toLowerCase().includes(lowerQuery) || article.source.toLowerCase().includes(lowerQuery)) {
      results['News & Articles'].push(article);
    }
  });

  // Mock data - Reports & Predictions
  const reports = [
    { id: 14, title: 'Q4 2025 Market Outlook', author: 'ClearPath Research', date: 'Oct 15' },
    { id: 15, title: 'State of RWAs Report', author: 'DeFi Institute', date: 'Oct 10' },
    { id: 16, title: 'Tech Sector Analysis 2025', author: 'Tech Insights', date: 'Oct 8' },
  ];
  reports.forEach(report => {
    if (report.title.toLowerCase().includes(lowerQuery) || report.author.toLowerCase().includes(lowerQuery)) {
      results['Reports & Predictions'].push(report);
    }
  });

  // Mock data - Calls and Events
  const events = [
    { id: 17, title: 'Apple Earnings Call', date: 'Oct 28', timeEvent: '4:30 PM EST', eventType: 'Earnings' },
    { id: 18, title: 'Fed Interest Rate Decision', date: 'Nov 1', timeEvent: '2:00 PM EST', eventType: 'Economic' },
    { id: 19, title: 'Tesla Product Launch Event', date: 'Oct 30', timeEvent: '1:00 PM EST', eventType: 'Product' },
  ];
  events.forEach(event => {
    if (event.title.toLowerCase().includes(lowerQuery) || event.eventType?.toLowerCase().includes(lowerQuery)) {
      results['Calls and Events'].push(event);
    }
  });

  // Filter out empty categories
  Object.keys(results).forEach(key => {
    if (results[key].length === 0) {
      delete results[key];
    }
  });

  return results;
};

const categoryIcons: Record<string, any> = {
  'Equities': TrendingUp,
  'ETFs & Indices': TrendingUp,
  'Collectibles': FileText,
  'News & Articles': Newspaper,
  'Reports & Predictions': FileText,
  'Calls and Events': Calendar,
};

export default function SearchResults({ query }: SearchResultsProps) {
  const results = performSearch(query);
  const categories = Object.keys(results);

  if (categories.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="py-16 text-center"
      >
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">No results found for "{query}"</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {categories.map((category, categoryIndex) => {
        const Icon = categoryIcons[category] || FileText;
        const categoryResults = results[category];

        return (
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: categoryIndex * 0.1 }}
          >
            {/* Category Header */}
            <div className="flex items-center gap-2 mb-4">
              <Icon className="w-5 h-5 text-black dark:text-white" />
              <h3 className="text-xl font-light text-black dark:text-white">{category}</h3>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                ({categoryResults.length})
              </span>
            </div>

            {/* Results List */}
            <div className="space-y-2">
              <AnimatePresence>
                {categoryResults.map((result, index) => {
                  // Render based on category type
                  if (category === 'Equities' || category === 'ETFs & Indices' || category === 'Collectibles') {
                    return (
                      <motion.div
                        key={result.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        className="bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded p-4 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center shadow-sm text-xs font-bold">
                              {result.symbol?.[0] || '?'}
                            </div>
                            <div>
                              <h4 className="font-medium text-black dark:text-white">{result.symbol}</h4>
                              <p className="text-xs text-zinc-500">{result.name}</p>
                            </div>
                          </div>
                          {result.change !== undefined && (
                            <div className={`flex items-center text-sm font-medium ${result.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {result.change >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownLeft className="w-3 h-3 mr-0.5" />}
                              {Math.abs(result.change)}%
                            </div>
                          )}
                        </div>
                        <div className="flex justify-between items-end mt-4">
                          <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            {result.type || category}
                          </span>
                          {result.price !== undefined && (
                            <span className="text-lg font-medium text-black dark:text-white">
                              ${result.price.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    );
                  }

                  if (category === 'News & Articles') {
                    return (
                      <motion.div
                        key={result.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        className="flex gap-4 p-4 bg-white dark:bg-[#0e0e0e] border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors cursor-pointer"
                      >
                        <div className={`w-20 h-20 rounded-md shrink-0 ${result.image || 'bg-zinc-100 dark:bg-zinc-800'}`} />
                        <div className="flex flex-col justify-between py-0.5">
                          <h4 className="font-medium text-black dark:text-white line-clamp-2">{result.title}</h4>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span className="font-medium text-zinc-700 dark:text-zinc-300">{result.source}</span>
                            <span>•</span>
                            <span>{result.time}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  }

                  if (category === 'Reports & Predictions') {
                    return (
                      <motion.div
                        key={result.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        className="group flex items-center justify-between p-3 bg-white dark:bg-zinc-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 border border-zinc-100 dark:border-zinc-800 rounded-sm cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-black dark:text-white line-clamp-1">{result.title}</p>
                            <p className="text-xs text-zinc-500">{result.author} • {result.date}</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
                      </motion.div>
                    );
                  }

                  if (category === 'Calls and Events') {
                    return (
                      <motion.div
                        key={result.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        className="flex gap-3 items-start p-3 bg-white dark:bg-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800 rounded-sm cursor-pointer transition-colors"
                      >
                        <div className="w-12 h-12 rounded bg-white dark:bg-zinc-800 flex flex-col items-center justify-center border border-zinc-100 dark:border-zinc-700 shrink-0">
                          <span className="text-[10px] text-zinc-500 uppercase">{result.date?.split(' ')[0]}</span>
                          <span className="text-sm font-bold text-black dark:text-white">{result.date?.split(' ')[1]}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-black dark:text-white leading-tight mb-1">{result.title}</p>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span>{result.timeEvent}</span>
                            <span className="w-1 h-1 bg-zinc-400 rounded-full"></span>
                            <span>{result.eventType}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  }

                  return null;
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
