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
    <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 shadow-md rounded-b-xl">
      <nav className="container flex items-center justify-between py-4">
        <div className="flex items-center space-x-6">
          <span className="text-2xl font-bold tracking-tight text-blue-600">DeedNFT Protocol</span>
          <Link 
            to="/" 
            className={`font-medium transition-colors ${
              isActive("/") 
                ? "text-blue-600 underline" 
                : "hover:underline text-gray-700 dark:text-gray-200"
            }`}
          >
            Home
          </Link>
          <Link 
            to="/mint" 
            className={`font-medium transition-colors ${
              isActive("/mint") 
                ? "text-blue-600 underline" 
                : "hover:underline text-gray-700 dark:text-gray-200"
            }`}
          >
            Mint
          </Link>
          <Link 
            to="/page-one" 
            className={`font-medium transition-colors ${
              isActive("/page-one") 
                ? "text-blue-600 underline" 
                : "hover:underline text-gray-700 dark:text-gray-200"
            }`}
          >
            Page One
          </Link>
          <Link 
            to="/page-two" 
            className={`font-medium transition-colors ${
              isActive("/page-two") 
                ? "text-blue-600 underline" 
                : "hover:underline text-gray-700 dark:text-gray-200"
            }`}
          >
            Page Two
          </Link>
        </div>
        {/* Wallet Connect/Disconnect Button and Theme Toggle */}
        <div className="flex items-center space-x-2">
          <appkit-button />
          {children}
        </div>
      </nav>
    </header>
  );
};

export default Header;
