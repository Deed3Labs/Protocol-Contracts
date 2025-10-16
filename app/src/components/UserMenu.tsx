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
  Twitter,
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
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-9 px-3 border-black/10 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-full"
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
          <DialogContent className="flex flex-col w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden mx-auto rounded-xl py-4 pb-0 px-0 border border-gray-200 dark:border-gray-700">
                    <DialogHeader className="px-6 pb-0">
            <div className="flex items-center justify-between">
                             <DialogTitle className="text-left text-lg font-semibold">Notifications</DialogTitle>
              <div className="scale-75 origin-right border border-black/10 dark:border-transparent rounded-full">
                <appkit-button />
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col h-full justify-start">
            {/* Mini Profile Section */}
            {isConnected && (
              <div className="px-6 pb-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
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
                    <Link to="/profile">
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
                              ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                              : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
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
                          className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-75"
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
              <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                 <div className="flex items-center space-x-3">
                   <Button variant="outline" className="h-8 w-8 p-0" onClick={toggleTheme}>
                     {isDark ? (
                       <Sun className="w-3 h-3" />
                     ) : (
                       <Moon className="w-3 h-3" />
                     )}
                   </Button>
                   <Button 
                     variant="outline" 
                     className="h-8 w-8 p-0"
                     onClick={() => {
                       if (address) {
                         const network = 'base-sepolia';
                         const url = `https://${network}.etherscan.io/address/${address}`;
                         window.open(url, '_blank');
                       }
                     }}
                   >
                     <ExternalLink className="w-3 h-3" />
                   </Button>
                   <Button variant="outline" className="h-8 w-8 p-0">
                     <HelpCircle className="w-3 h-3" />
                   </Button>
                   {hasAdminRole && (
                     <Link to="/admin">
                       <Button variant="outline" className="h-8 w-8 p-0">
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
                     onClick={() => window.open('https://github.com/Deed3Labs', '_blank')}
                     className="h-6 w-6 p-0"
                   >
                     <Github className="w-3 h-3" />
                   </Button>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => window.open('https://x.com/Deed3Labs', '_blank')}
                     className="h-6 w-6 p-0"
                   >
                     <Twitter className="w-3 h-3" />
                   </Button>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => window.open('mailto:support@deed3labs.com', '_blank')}
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