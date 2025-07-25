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
    <header className="sticky top-0 z-30 w-full bg-card/80 dark:bg-background/80 backdrop-blur border-b border-border shadow-sm">
      <nav className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
        <div className="flex items-center space-x-6">
          <span className="text-xl font-bold tracking-tight text-primary">DeedNFT Protocol</span>
          <Link 
            to="/" 
            className={`font-medium transition-colors ${
              isActive("/") 
                ? "text-primary underline" 
                : "hover:underline"
            }`}
          >
            Home
          </Link>
          <Link 
            to="/mint" 
            className={`font-medium transition-colors ${
              isActive("/mint") 
                ? "text-primary underline" 
                : "hover:underline"
            }`}
          >
            Mint
          </Link>
          <Link 
            to="/page-one" 
            className={`font-medium transition-colors ${
              isActive("/page-one") 
                ? "text-primary underline" 
                : "hover:underline"
            }`}
          >
            Page One
          </Link>
          <Link 
            to="/page-two" 
            className={`font-medium transition-colors ${
              isActive("/page-two") 
                ? "text-primary underline" 
                : "hover:underline"
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
