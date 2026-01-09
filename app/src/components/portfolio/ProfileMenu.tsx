import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDisconnect } from 'wagmi';
import { 
  Bell, 
  Mail, 
  User, 
  Settings, 
  LogOut, 
  CreditCard
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
}

const ProfileMenu = ({ isOpen, onClose, user }: ProfileMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme: _theme } = useTheme();
  const [activeTab, setActiveTab] = useState<'notifications' | 'inbox'>('notifications');
  const { disconnect } = useDisconnect();

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const notifications = [
    { id: 1, title: 'Deposit Successful', time: '2m ago', read: false, type: 'success' },
    { id: 2, title: 'TSLA down 5%', time: '1h ago', read: true, type: 'alert' },
    { id: 3, title: 'New Feature: Income Hub', time: '2d ago', read: true, type: 'info' },
  ];

  const messages = [
    { id: 1, sender: 'Support Team', preview: 'Your ticket #1234 has been resolved...', time: '1d ago', read: false },
    { id: 2, sender: 'System', preview: 'Welcome to the new dashboard!', time: '3d ago', read: true },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute right-0 top-full mt-2 w-[85vw] sm:w-96 md:w-96 bg-white dark:bg-[#0e0e0e] rounded shadow-2xl border-[0.5px] border-zinc-200 dark:border-zinc-800 overflow-hidden z-50 ring-1 ring-black/5 dark:ring-white/10"
        >
          {/* Header / User Info */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/50">
            <div className="flex items-center gap-3">
              <div className="w-9.5 h-9.5 rounded bg-blue-600 flex items-center justify-center text-white font-medium shadow-md">
                {user?.name?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {user?.name || 'User'}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {user?.email || 'user@example.com'}
                </p>
              </div>
              <button className="text-xs bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors">
                Pro
              </button>
            </div>
          </div>

          {/* Quick Stats / Tabs */}
          <div className="flex border-b border-zinc-100 dark:border-zinc-800/50">
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex-1 py-3 text-sm font-normal text-center border-b-2 transition-colors relative ${
                activeTab === 'notifications'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Bell className="w-4 h-4" />
                <span>Notifications</span>
                <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">3</span>
              </div>
            </button>
            <div className="w-[1px] bg-zinc-200 dark:bg-zinc-800" />
            <button
              onClick={() => setActiveTab('inbox')}
              className={`flex-1 py-3 text-sm font-normal text-center border-b-2 transition-colors ${
                activeTab === 'inbox'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Mail className="w-4 h-4" />
                <span>Inbox</span>
              </div>
            </button>
          </div>

          {/* Tab Content */}
          <div className="max-h-64 overflow-y-auto">
            {activeTab === 'notifications' ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {notifications.map((item) => (
                  <div key={item.id} className={`p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex gap-3 ${!item.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                    <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${!item.read ? 'bg-blue-500' : 'bg-transparent'}`} />
                    <div className="flex-1">
                      <p className="text-sm text-zinc-800 dark:text-zinc-200">{item.title}</p>
                      <p className="text-xs text-zinc-500 mt-1">{item.time}</p>
                    </div>
                  </div>
                ))}
                <button className="w-full py-2 text-xs text-center text-blue-600 dark:text-blue-400 hover:underline">
                  View all notifications
                </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                 {messages.map((item) => (
                  <div key={item.id} className="p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex gap-3 cursor-pointer">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.sender}</p>
                        <span className="text-xs text-zinc-400">{item.time}</span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{item.preview}</p>
                    </div>
                  </div>
                ))}
                 <button className="w-full py-2 text-xs text-center text-blue-600 dark:text-blue-400 hover:underline">
                  Go to Inbox
                </button>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

          {/* Menu Items */}
          <div className="p-2 space-y-0.5">
            <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors group">
              <User className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100" />
              <span className="flex-1 text-left">Profile</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors group">
              <Settings className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100" />
              <span className="flex-1 text-left">Settings</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors group">
              <CreditCard className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100" />
              <span className="flex-1 text-left">Billing</span>
            </button>
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/30">
            <button 
              onClick={() => disconnect()}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="flex-1 text-left">Disconnect Wallet</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ProfileMenu;

