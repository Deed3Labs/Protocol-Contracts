import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  User, 
  Shield, 
  Moon, 
  Sun, 
  Bell, 
  Settings, 
  Copy, 
  ExternalLink,
  ChevronDown,
  MessageCircle,
  Activity,
  HelpCircle,
  BookOpen,
  Github,
  Twitter,
  Mail,
  CheckCircle,
  AlertCircle,
  Info,
  Archive,
  Trash2,
  Wallet
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAppKitAccount } from '@reown/appkit/react';

import { useNotifications, type Notification } from '@/context/NotificationContext';

interface UserMenuProps {
  hasAdminRole: boolean;
}



const UserMenu: React.FC<UserMenuProps> = ({ hasAdminRole }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'settings'>('profile');
  const [showArchive, setShowArchive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const { 
    notifications, 
    archivedNotifications, 
    unreadCount, 
    markAllAsRead, 
    archiveNotification, 
    archiveOldNotifications,
    clearArchive 
  } = useNotifications();

  const { address, isConnected, embeddedWalletInfo } = useAppKitAccount();

  // Auto-archive old notifications on mount
  useEffect(() => {
    archiveOldNotifications();
  }, [archiveOldNotifications]);

  // Theme management
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      html.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  const copyAddress = async () => {
    if (address) {
      try {
        await navigator.clipboard.writeText(address);
        console.log('Address copied to clipboard');
      } catch (err) {
        console.error('Failed to copy address:', err);
      }
    }
  };

  const handleConnect = async () => {
    try {
      // Trigger AppKit modal for connection
      const appkitButton = document.querySelector('appkit-button') as any;
      if (appkitButton && appkitButton.click) {
        appkitButton.click();
      } else {
        // Fallback: try to trigger connection programmatically
        console.log('Attempting to connect wallet...');
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
    }
  };



  const openWalletModal = () => {
    // Trigger the full AppKit wallet modal
    const appkitButton = document.querySelector('appkit-button') as any;
    if (appkitButton && appkitButton.click) {
      appkitButton.click();
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (!mounted) return null;

  return (
    <>
      {/* User Menu Button */}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-9 px-3 border-black/10 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <User className="w-3 h-3 text-white" />
            </div>
            <span className="hidden sm:block text-sm font-medium">
              {address ? formatAddress(address) : 'Connect'}
            </span>
            <ChevronDown className="w-3 h-3" />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 w-5 rounded-full p-0 text-xs">
                {unreadCount > 9 ? '9+' : unreadCount}
              </Badge>
            )}
          </div>
        </Button>
      </div>

      {/* User Menu Modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden mx-auto rounded-lg sm:rounded-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-left">User Menu</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col h-full">
            {/* User Profile Section */}
            <div className="space-y-4 p-4 sm:p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg mb-4">
              {/* Wallet Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {address ? formatAddress(address) : 'Not Connected'}
                    </p>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {isConnected ? 'Connected' : 'Disconnected'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex space-x-1">
                  {address && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyAddress}
                      className="h-8 w-8 p-0"
                      title="Copy address"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openWalletModal}
                    className="h-8 w-8 p-0"
                    title="Open wallet"
                  >
                    <Wallet className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Wallet Type Info */}
              {isConnected && embeddedWalletInfo && (
                <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Account Type:</span>
                    <Badge variant="outline" className="text-xs">
                      {embeddedWalletInfo.accountType || 'Smart Account'}
                    </Badge>
                  </div>
                  {embeddedWalletInfo.accountType === 'smartAccount' && (
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-gray-500 dark:text-gray-400">Deployed:</span>
                      <Badge variant="outline" className={`text-xs ${embeddedWalletInfo.isSmartAccountDeployed ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'}`}>
                        {embeddedWalletInfo.isSmartAccountDeployed ? 'Yes' : 'Pending'}
                      </Badge>
                    </div>
                  )}
                  {embeddedWalletInfo.authProvider && (
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-gray-500 dark:text-gray-400">Auth:</span>
                      <Badge variant="outline" className="text-xs">
                        {typeof embeddedWalletInfo.authProvider === 'string' ? embeddedWalletInfo.authProvider : 'Social'}
                      </Badge>
                    </div>
                  )}
                </div>
              )}

              {/* Connection Actions */}
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                {!isConnected ? (
                  <Button
                    onClick={handleConnect}
                    className="w-full"
                    size="sm"
                  >
                    <Wallet className="w-4 h-4 mr-2" />
                    Connect Wallet
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={openWalletModal}
                    className="w-full"
                    size="sm"
                  >
                    <Wallet className="w-4 h-4 mr-2" />
                    Open Wallet
                  </Button>
                )}
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex space-x-2 mb-6">
              <Button
                variant={activeTab === 'profile' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('profile')}
                className="flex-1 h-11"
              >
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
              <Button
                variant={activeTab === 'notifications' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('notifications')}
                className="flex-1 relative h-11"
              >
                <Bell className="w-4 h-4 mr-2" />
                Notifications
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 w-4 rounded-full p-0 text-xs">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
              <Button
                variant={activeTab === 'settings' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('settings')}
                className="flex-1 h-11"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'profile' && (
                <div className="space-y-4">
                  <Link to="/dashboard">
                    <Button variant="ghost" className="w-full justify-start h-11">
                      <Activity className="w-4 h-4 mr-3" />
                      Dashboard
                    </Button>
                  </Link>
                  <Link to="/profile">
                    <Button variant="ghost" className="w-full justify-start h-11">
                      <User className="w-4 h-4 mr-3" />
                      My Profile
                    </Button>
                  </Link>
                  <Link to="/explore">
                    <Button variant="ghost" className="w-full justify-start h-11">
                      <BookOpen className="w-4 h-4 mr-3" />
                      Explore T-Deeds
                    </Button>
                  </Link>
                  {hasAdminRole && (
                    <Link to="/admin">
                      <Button variant="ghost" className="w-full justify-start h-11">
                        <Shield className="w-4 h-4 mr-3" />
                        Admin Panel
                      </Button>
                    </Link>
                  )}
                  <Separator className="my-4" />
                  <Button variant="ghost" className="w-full justify-start h-11">
                    <HelpCircle className="w-4 h-4 mr-3" />
                    Help & Support
                  </Button>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="space-y-3 py-1">
                  <div className="flex items-center justify-between">
                    <div className="flex space-x-2">
                      <Button
                        variant={!showArchive ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setShowArchive(false)}
                        className="text-xs"
                      >
                        Active ({notifications.length})
                      </Button>
                      <Button
                        variant={showArchive ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setShowArchive(true)}
                        className="text-xs"
                      >
                        Archive ({archivedNotifications.length})
                      </Button>
                    </div>
                    {!showArchive && unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={markAllAsRead}
                        className="text-xs"
                      >
                        Mark all as read
                      </Button>
                    )}
                    {showArchive && archivedNotifications.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearArchive}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Clear Archive
                      </Button>
                    )}
                  </div>

                  {!showArchive && (
                    <>
                      {notifications.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                          <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No active notifications</p>
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`p-3 rounded-lg border transition-colors ${
                              notification.read
                                ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              {getNotificationIcon(notification.type)}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                  {notification.title}
                                </p>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                  {notification.message}
                                </p>
                                <div className="flex items-center justify-between mt-2">
                                  <span className="text-xs text-gray-500 dark:text-gray-500">
                                    {formatTimestamp(notification.timestamp)}
                                  </span>
                                  <div className="flex space-x-1">
                                    {notification.action && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => notification.action?.onClick()}
                                        className="h-6 px-2 text-xs"
                                      >
                                        {notification.action.label}
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => archiveNotification(notification.id)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      <Archive className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {showArchive && (
                    <>
                      {archivedNotifications.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                          <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No archived notifications</p>
                        </div>
                      ) : (
                        archivedNotifications.map((notification) => (
                          <div
                            key={notification.id}
                            className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-75"
                          >
                            <div className="flex items-start space-x-3">
                              {getNotificationIcon(notification.type)}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                  {notification.title}
                                </p>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                  {notification.message}
                                </p>
                                <div className="flex items-center justify-between mt-2">
                                  <span className="text-xs text-gray-500 dark:text-gray-500">
                                    {formatTimestamp(notification.timestamp)}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    Archived
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
                      Preferences
                    </p>
                    <Button
                      variant="ghost"
                      className="w-full justify-start h-11"
                      onClick={toggleTheme}
                    >
                      {isDark ? (
                        <Sun className="w-4 h-4 mr-3" />
                      ) : (
                        <Moon className="w-4 h-4 mr-3" />
                      )}
                      {isDark ? 'Light Mode' : 'Dark Mode'}
                    </Button>
                    <Button variant="ghost" className="w-full justify-start h-11">
                      <MessageCircle className="w-4 h-4 mr-3" />
                      Messaging Settings
                    </Button>
                    <Button variant="ghost" className="w-full justify-start h-11">
                      <Bell className="w-4 h-4 mr-3" />
                      Notification Preferences
                    </Button>
                  </div>
                  <Separator className="my-4" />
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
                      External Links
                    </p>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start h-11"
                      onClick={() => {
                        if (address) {
                          const network = 'base-sepolia'; // You could make this dynamic based on current network
                          const url = `https://${network}.etherscan.io/address/${address}`;
                          window.open(url, '_blank');
                        }
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-3" />
                      View on Etherscan
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start h-11"
                      onClick={() => window.open('https://github.com/Deed3Labs', '_blank')}
                    >
                      <Github className="w-4 h-4 mr-3" />
                      GitHub
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start h-11"
                      onClick={() => window.open('https://x.com/Deed3Labs', '_blank')}
                    >
                      <Twitter className="w-4 h-4 mr-3" />
                      Twitter
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start h-11"
                      onClick={() => window.open('mailto:support@deed3labs.com', '_blank')}
                    >
                      <Mail className="w-4 h-4 mr-3" />
                      Contact Support
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserMenu; 