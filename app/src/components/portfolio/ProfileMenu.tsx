import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDisconnect } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, 
  Mail, 
  User, 
  Settings, 
  LogOut, 
  CreditCard,
  Loader2
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useXMTP } from '@/context/XMTPContext';
import { useNotifications } from '@/context/NotificationContext';
import { formatDistanceToNow } from 'date-fns';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onOpenXMTP: (conversationId?: string) => void;
}

const ProfileMenu = ({ isOpen, onClose, user, onOpenXMTP }: ProfileMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme: _theme } = useTheme();
  const [activeTab, setActiveTab] = useState<'notifications' | 'inbox'>('notifications');
  const { disconnect } = useDisconnect();
  const navigate = useNavigate();
  const { conversations, messages, isConnected, isLoading } = useXMTP();
  const { notifications, unreadCount, markAsRead } = useNotifications();

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

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getLatestMessage = (conversationId: string) => {
    const conversationMessages = messages[conversationId] || [];
    if (conversationMessages.length === 0) return null;
    return conversationMessages[conversationMessages.length - 1];
  };

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
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{unreadCount}</span>
                )}
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
                {isConnected && conversations.length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 rounded-full">{conversations.length}</span>
                )}
              </div>
            </button>
          </div>

          {/* Tab Content */}
          <div className="max-h-64 overflow-y-auto">
            {activeTab === 'notifications' ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm">No notifications</p>
                  </div>
                ) : (
                  <>
                    {notifications.slice(0, 10).map((item) => (
                      <div 
                        key={item.id} 
                        className={`p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex gap-3 cursor-pointer ${!item.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                        onClick={() => {
                          if (!item.read) {
                            markAsRead(item.id);
                          }
                          if (item.action?.onClick) {
                            item.action.onClick();
                            onClose();
                          }
                        }}
                      >
                        <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${!item.read ? 'bg-blue-500' : 'bg-transparent'}`} />
                        <div className="flex-1">
                          <p className="text-sm text-zinc-800 dark:text-zinc-200">{item.title}</p>
                          <p className="text-xs text-zinc-500 mt-1">{formatDistanceToNow(item.timestamp, { addSuffix: true })}</p>
                        </div>
                      </div>
                    ))}
                    {notifications.length > 10 && (
                      <button 
                        onClick={() => {
                          navigate('/notifications');
                          onClose();
                        }}
                        className="w-full py-2 text-xs text-center text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View all {notifications.length} notifications
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {!isConnected ? (
                  <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm mb-2">Connect your wallet to see messages</p>
                  </div>
                ) : isLoading ? (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : (
                  conversations.map((conversation) => {
                    const latestMsg = getLatestMessage(conversation.id);
                    return (
                      <div 
                        key={conversation.id} 
                        className="p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex gap-3 cursor-pointer"
                        onClick={() => {
                          onOpenXMTP(conversation.id);
                          onClose();
                        }}
                      >
                        <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-zinc-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline mb-0.5">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {(conversation as any).peerAddress ? formatAddress((conversation as any).peerAddress) : formatAddress(conversation.id)}
                            </p>
                            {latestMsg && (
                              <span className="text-xs text-zinc-400">
                                {formatTimestamp(latestMsg.sentAtNs ? new Date(Number(latestMsg.sentAtNs) / 1000000) : new Date())}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {typeof latestMsg?.content === 'string' ? latestMsg.content : (latestMsg ? 'Message' : 'New conversation')}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <button 
                  onClick={() => {
                    onOpenXMTP();
                    onClose();
                  }}
                  className="w-full py-2 text-xs text-center text-blue-600 dark:text-blue-400 hover:underline"
                >
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

