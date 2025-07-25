import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

interface HeaderProps {
  children?: ReactNode;
}

const Header = ({ children }: HeaderProps) => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <header className="sticky top-0 z-30 w-full bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm border-b border-black/10 dark:border-white/10">
      <nav className="container flex items-center justify-between py-4">
        <div className="flex items-center space-x-8">
          <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">DeedNFT Protocol</span>
          <div className="flex items-center space-x-6">
            <Link 
              to="/" 
              className={`font-medium transition-colors duration-200 ${
                isActive("/") 
                  ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Home
            </Link>
            <Link 
              to="/mint" 
              className={`font-medium transition-colors duration-200 ${
                isActive("/mint") 
                  ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Mint
            </Link>
            <Link 
              to="/explore" 
              className={`font-medium transition-colors duration-200 ${
                isActive("/explore") 
                  ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Explore
            </Link>
            <Link 
              to="/dashboard" 
              className={`font-medium transition-colors duration-200 ${
                isActive("/dashboard") 
                  ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Dashboard
            </Link>
          </div>
        </div>
        {/* Wallet Connect/Disconnect Button and Theme Toggle */}
        <div className="flex items-center space-x-3">
          <appkit-button />
          {children}
        </div>
      </nav>
    </header>
  );
};

export default Header;
