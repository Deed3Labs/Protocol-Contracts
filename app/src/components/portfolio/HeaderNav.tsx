import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Search, Plus } from 'lucide-react';
import ProfileMenu from './ProfileMenu';
import ClearPathLogo from '../../assets/ClearPath-Logo.png';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import XMTPMessaging from '@/components/XMTPMessaging';
import { useState, useEffect } from 'react';
import SearchModal from './SearchModal';

interface HeaderNavProps {
  totalValue: number;
  isScrolledPast: boolean;
  onMenuOpen: () => void;
  onActionOpen: () => void;
  user: any;
  profileMenuOpen: boolean;
  setProfileMenuOpen: (open: boolean) => void;
}

export default function HeaderNav({
  totalValue,
  isScrolledPast,
  onMenuOpen,
  onActionOpen,
  user,
  profileMenuOpen,
  setProfileMenuOpen
}: HeaderNavProps) {
  const { isConnected, openModal } = useAppKitAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isXMTPModalOpen, setIsXMTPModalOpen] = useState(false);
  const [xmtpConversationId, setXmtpConversationId] = useState<string | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Filter categories for search
  const filterCategories = [
    'Technology',
    'Finance',
    'Healthcare',
    'Energy',
    'Real Estate',
    'Consumer',
    'Crypto & DeFi',
    'ESG',
    'Growth',
    'Value',
    'Dividend',
  ];

  const isActive = (path: string) => location.pathname === path;

  // Handle Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCategoryToggle = (category: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(category)) {
        return prev.filter(c => c !== category);
      } else {
        return [...prev, category];
      }
    });
  };

  const handleSearchModalClose = () => {
    setIsSearchModalOpen(false);
    // Optionally clear search on close
    // setSearchQuery('');
    // setSelectedCategories([]);
  };

  const handleOpenXMTP = (conversationId?: string) => {
    setXmtpConversationId(conversationId || null);
    setIsXMTPModalOpen(true);
    setProfileMenuOpen(false); // Close profile menu when opening XMTP
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 py-4 bg-white/80 dark:bg-[#0e0e0e]/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-900 md:border-none md:pt-6 transition-all duration-200">
        <div className="container mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50">
              <img src={ClearPathLogo} alt="ClearPath" className="w-full h-full object-cover" />
            </div>
            <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
            <motion.button 
              layout
              transition={{ layout: { duration: 0.2, type: "spring", bounce: 0 } }}
              onClick={onMenuOpen}
              className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 rounded px-3 py-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors overflow-hidden"
            >
              <Menu className="w-4 h-4 text-black dark:text-white shrink-0" />
              <motion.span layout="position" className="text-sm font-medium whitespace-nowrap">Menu</motion.span>
              <AnimatePresence>
                {(isScrolledPast) && (
                  <motion.span 
                    layout
                    key="header-portfolio-value"
                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                    animate={{ opacity: 1, width: "auto", marginLeft: 4 }}
                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="text-sm text-zinc-500 dark:text-zinc-400 border-l border-zinc-300 dark:border-zinc-700 pl-2 flex items-center whitespace-nowrap overflow-hidden"
                  >
                    ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[12px] ml-1">USD</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
          
          {/* Desktop Nav Links (Hidden on Mobile) */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-500 dark:text-zinc-400">
             <button 
               onClick={() => navigate('/')}
               className={`${isActive('/') ? 'text-black dark:text-white' : 'hover:text-black dark:hover:text-white'} transition-colors`}
             >
               Portfolio
             </button>
             <button 
               onClick={() => navigate('/markets')}
               className={`${isActive('/markets') ? 'text-black dark:text-white' : 'hover:text-black dark:hover:text-white'} transition-colors`}
             >
               Markets
             </button>
             <button className="hover:text-black dark:hover:text-white transition-colors">Earn</button>
             <button 
               onClick={() => navigate('/borrow')}
               className={`${isActive('/borrow') ? 'text-black dark:text-white' : 'hover:text-black dark:hover:text-white'} transition-colors`}
             >
               Borrow
             </button>
          </div>
  
          <div className="flex items-center gap-4">
             <motion.button 
               whileHover={{ scale: 1.05 }}
               whileTap={{ scale: 0.95 }}
               onClick={onActionOpen}
               className="hidden md:flex items-center justify-center w-8 h-8 bg-black dark:bg-white rounded text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm"
             >
               <Plus className="w-4 h-4" />
             </motion.button>
  
             <button 
               onClick={() => setIsSearchModalOpen(true)}
               className="hidden md:flex items-center gap-2 px-4 py-2 w-64 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-sm font-normal transition-colors justify-between cursor-pointer"
             >
               <div className="flex items-center gap-2">
                 <Search className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                 <span className="text-zinc-500 dark:text-zinc-400">Search</span>
               </div>
               <span className="text-zinc-500 dark:text-zinc-600 border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-xs">⌘K</span>
             </button>
             <button 
               onClick={() => setIsSearchModalOpen(true)}
               className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded transition-colors md:hidden"
             >
               <Search className="w-5 h-5 text-black dark:text-white" />
             </button>
             
             {/* Connect Wallet / Profile Menu */}
             {isConnected ? (
               <div className="relative">
                 <button 
                   onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                   className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded transition-colors"
                 >
                    <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-sm font-medium text-white">
                       {user?.name?.[0] || 'U'}
                    </div>
                 </button>
                 <ProfileMenu 
                   isOpen={profileMenuOpen} 
                   onClose={() => setProfileMenuOpen(false)} 
                   user={user}
                   onOpenXMTP={handleOpenXMTP}
                 />
               </div>
             ) : (
               <button 
                 onClick={() => openModal()}
                 className="bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm whitespace-nowrap"
               >
                 Login
               </button>
             )}
          </div>
        </div>
      </header>

      {/* XMTP Modal */}
      <XMTPMessaging 
        isOpen={isXMTPModalOpen} 
        onClose={() => setIsXMTPModalOpen(false)}
        initialConversationId={xmtpConversationId}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={handleSearchModalClose}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategories={selectedCategories}
        onCategoryToggle={handleCategoryToggle}
        filterCategories={filterCategories}
      />
    </>
  );
}

