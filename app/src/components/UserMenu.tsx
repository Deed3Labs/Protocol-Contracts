import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  User, 
  Shield, 
  Moon, 
  Sun, 
  ExternalLink,
  ChevronDown,
  HelpCircle,
  Github,
  Mail,
  CheckCircle,
  AlertCircle,
  Info,
   RefreshCw,

} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { useAppKitAccount } from '@reown/appkit/react';


import { useNotifications } from '@/context/NotificationContext';
import { useDeedNFTData } from '@/hooks/useDeedNFTData';



interface UserMenuProps {
  hasAdminRole: boolean;
}

const UserMenu: React.FC<UserMenuProps> = ({ hasAdminRole }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const [showArchive, setShowArchive] = useState(false);
  const { 
    notifications, 
    archivedNotifications,
    unreadCount, 
    markAllAsRead,
    archiveNotification,
    clearArchive,
    refreshValidationNotifications
  } = useNotifications();

  const { address, isConnected } = useAppKitAccount();

  // Get DeedNFT data directly
  let userDeedNFTs: any[] = [];
  let getValidationStatus: any = null;
  
  try {
    const deedData = useDeedNFTData();
    userDeedNFTs = deedData.userDeedNFTs || [];
    getValidationStatus = deedData.getValidationStatus;
  } catch (error) {
    // DeedNFT data not available yet
  }

  






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



  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));

  // Check for validation notifications when data is available
  useEffect(() => {
    if (isConnected && address && userDeedNFTs.length > 0 && getValidationStatus) {
      console.log('🔍 UserMenu: Data available, triggering validation check for', userDeedNFTs.length, 'T-Deeds');
      refreshValidationNotifications();
    }
  }, [isConnected, address, userDeedNFTs.length, getValidationStatus, refreshValidationNotifications]);
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
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-8 px-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 rounded-md border border-black/10 dark:border-white/10 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700"
        >
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {address ? formatAddress(address) : 'Connect'}
            </span>
            <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400" />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 w-4 rounded-full p-0 text-xs flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </Badge>
            )}
          </div>
        </Button>
      </div>

      {/* User Menu Modal */}
              <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="flex flex-col w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden mx-auto rounded-xl py-4 pb-0 px-0 border border-black/10 dark:border-white/10 bg-white dark:bg-[#0e0e0e]">
                    <DialogHeader className="px-6 pb-0">
            <div className="flex items-center justify-between">
                             <DialogTitle className="text-left text-xl font-semibold">Notifications</DialogTitle>
              <div className="scale-75 origin-right rounded-full">
                <appkit-button />
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col h-full justify-start">
            {/* Mini Profile Section */}
            {isConnected && (
              <div className="px-6 pb-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#141414] rounded-lg border border-black/10 dark:border-white/10">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connected'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {notifications.length} notifications
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Link to="/profile" onClick={() => setIsOpen(false)}>
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                        Profile
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tabs */}
            <div className="px-6 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex space-x-2">
                  <Button
                    variant={!showArchive ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setShowArchive(false)}
                    className={`text-xs ${!showArchive ? "bg-black hover:bg-[#141414] text-white dark:hover:text-white text-white dark:bg-white dark:hover:bg-[#141414] dark:text-black" : "dark:hover:bg-[#141414]"}`}
                  >
                    Active ({notifications.length})
                  </Button>
                  <Button
                    variant={showArchive ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setShowArchive(true)}
                    className={`text-xs ${showArchive ? "bg-black hover:bg-[#141414] text-white dark:hover:text-white text-white dark:bg-white dark:hover:bg-[#141414] dark:text-black" : "dark:hover:bg-[#141414]"}`}
                  >
                    Archive ({archivedNotifications.length})
                  </Button>
                </div>
                <div className="flex items-center space-x-2">
                  {!showArchive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        console.log('🔄 Manual refresh triggered');
                        refreshValidationNotifications();
                      }}
                      className="text-xs"
                      title="Refresh validation notifications"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  )}
                  {!showArchive && unreadCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={markAllAsRead}
                      className="text-xs"
                    >
                      Mark all read
                    </Button>
                  )}
                </div>
                {showArchive && archivedNotifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearArchive}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Clear Archive
                  </Button>
                )}
              </div>

              {/* Notifications List */}
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {!showArchive && (
                  <>
                    {notifications.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No active notifications</p>
                      </div>
                    ) : (
                      notifications.map((notification) => (
                        <div
                          key={notification.id}
                          className={`p-4 rounded-lg border transition-colors ${
                            notification.read
                              ? 'bg-gray-50 dark:bg-gray-800/50 border-black/10 dark:border-white/10'
                              : 'bg-blue-50 dark:bg-blue-900/20 border-black/10 dark:border-white/10'
                          }`}
                        >
                          <div className="flex items-start space-x-3">
                            {notification.type === 'success' ? (
                              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            ) : notification.type === 'warning' ? (
                              <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            ) : notification.type === 'error' ? (
                              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            ) : (
                              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            )}
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => archiveNotification(notification.id)}
                                  className="h-6 px-2 text-xs"
                                >
                                  Archive
                                </Button>
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
                        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No archived notifications</p>
                      </div>
                    ) : (
                      archivedNotifications.map((notification) => (
                        <div
                          key={notification.id}
                          className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-black/10 dark:border-white/10 opacity-75"
                        >
                          <div className="flex items-start space-x-3">
                            {notification.type === 'success' ? (
                              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            ) : notification.type === 'warning' ? (
                              <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            ) : notification.type === 'error' ? (
                              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            ) : (
                              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            )}
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
            </div>



            {/* Settings Actions */}
            <div className="px-6 pb-4">
              <div className="flex items-center justify-between pt-2 border-t border-black/10 dark:border-white/10 pt-3">
                 <div className="flex items-center space-x-2">
                   <Button variant="outline" className="h-8 w-8 p-0 dark:bg-[#141414]" onClick={toggleTheme}>
                     {isDark ? (
                       <Sun className="w-3 h-3" />
                     ) : (
                       <Moon className="w-3 h-3" />
                     )}
                   </Button>
                   <Button 
                     variant="outline" 
                     className="h-8 w-8 p-0 dark:bg-[#141414]"
                     onClick={() => {
                       setIsOpen(false);
                       if (address) {
                         const network = 'base-sepolia';
                         const url = `https://${network}.etherscan.io/address/${address}`;
                         window.open(url, '_blank');
                       }
                     }}
                   >
                     <ExternalLink className="w-3 h-3" />
                   </Button>
                   <Button variant="outline" className="h-8 w-8 p-0 dark:bg-[#141414]">
                     <HelpCircle className="w-3 h-3" />
                   </Button>
                   {hasAdminRole && (
                     <Link to="/admin" onClick={() => setIsOpen(false)}>
                       <Button variant="outline" className="h-8 w-8 p-0 dark:bg-[#141414]">
                         <Shield className="w-3 h-3" />
                       </Button>
                     </Link>
                   )}
                 </div>
                 
                 {/* Social Links */}
                 <div className="flex items-center space-x-2">
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => {
                       setIsOpen(false);
                       window.open('https://github.com/Deed3Labs', '_blank');
                     }}
                     className="h-6 w-6 p-0"
                   >
                     <Github className="w-3 h-3" />
                   </Button>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => {
                       setIsOpen(false);
                       window.open('https://x.com/Deed3Labs', '_blank');
                     }}
                     className="h-6 w-6 p-0"
                   >
                     <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                       <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                     </svg>
                   </Button>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => {
                       setIsOpen(false);
                       window.open('mailto:support@deed3.io', '_blank');
                     }}
                     className="h-6 w-6 p-0"
                   >
                     <Mail className="w-3 h-3" />
                   </Button>
                 </div>
               </div>
             </div>

            
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserMenu; 