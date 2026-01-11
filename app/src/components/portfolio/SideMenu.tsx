import { X, ChevronRight, User, Settings, Lock, HelpCircle, LogOut, Sun, Moon, FileText, CreditCard } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useDisconnect } from 'wagmi';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SideMenu = ({ isOpen, onClose, user }: { isOpen: boolean; onClose: () => void; user: any; totalValue: number }) => {
  const { theme, setTheme } = useTheme();
  const { disconnect } = useDisconnect();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // Sync with theme context and local storage
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDark(true);
    } else {
      setIsDark(false);
    }
  }, [theme]);

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    // 1. Update React state (Context)
    setTheme(newTheme);
    setIsDark(newTheme === 'dark');
    
    // 2. Force manual update of localStorage (redundant but safe)
    localStorage.setItem('theme', newTheme);
    
    // 3. Force manual class update on document (redundant but safe)
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // 4. Dispatch events for AppKit
    window.dispatchEvent(new Event('themechange'));
    window.dispatchEvent(new StorageEvent('storage', { 
      key: 'theme', 
      newValue: newTheme 
    }));
  };

  if (!isOpen || !mounted) return null;

  const menuItems = [
    {
      title: 'Account',
      items: [
        { icon: User, label: 'Personal Information' },
        { icon: Settings, label: 'Settings' },
        { icon: Lock, label: 'Security & Privacy' },
        { icon: FileText, label: 'Documents' },
      ]
    },
    {
      title: 'Transfers',
      items: [
        { icon: CreditCard, label: 'Bank Accounts' },
      ]
    },
    {
      title: 'Support',
      items: [
        { icon: HelpCircle, label: 'Help Center' },
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Menu Panel */}
      <div className="relative w-full max-w-[340px] bg-white dark:bg-[#0e0e0e] h-full p-6 flex flex-col animate-slide-in-left border-r border-zinc-200 dark:border-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between mb-8 md:mt-4">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100 font-medium text-lg">
                {user?.name?.[0] || 'U'}
             </div>
             <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">{user?.name || 'User'}</div>
                {/* <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors">View profile</button> */}
             </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 -mr-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-8">
           {menuItems.map((section) => (
             <div key={section.title}>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-3">{section.title}</h3>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <button 
                      key={item.label}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors group"
                    >
                       <div className="flex items-center gap-3">
                          <item.icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
                          <span className="text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 font-medium transition-colors">{item.label}</span>
                       </div>
                       <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors" />
                    </button>
                  ))}
                </div>
             </div>
           ))}

           {/* Theme Switcher */}
           <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-3">Appearance</h3>
              <div className="bg-zinc-100 dark:bg-zinc-900/50 p-1 rounded flex border border-zinc-200 dark:border-zinc-800">
                <button 
                  onClick={() => handleThemeChange('light')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-sm font-medium transition-all ${
                    !isDark 
                      ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-black/5' 
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <Sun className="w-4 h-4" />
                  <span>Light</span>
                </button>
                <button 
                  onClick={() => handleThemeChange('dark')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-sm font-medium transition-all ${
                    isDark 
                      ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10' 
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <Moon className="w-4 h-4" />
                  <span>Dark</span>
                </button>
              </div>
           </div>
        </div>

        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
        <button 
          onClick={() => {
            disconnect();
            onClose(); // Close the menu
            // Dispatch event to trigger splash screen
            window.dispatchEvent(new Event('wallet-disconnected'));
            // Navigate to login after a short delay
            setTimeout(() => {
              navigate('/login');
            }, 500);
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors text-red-600 dark:text-red-500 group"
        >
           <LogOut className="w-5 h-5" />
           <span className="font-medium">Disconnect Wallet</span>
        </button>
           <div className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
              Version 1.0.0
           </div>
        </div>
      </div>
    </div>
  );
};

export default SideMenu;
