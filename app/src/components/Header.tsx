import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Header = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-background/80 backdrop-blur border-b border-gray-200 dark:border-muted shadow-sm">
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
      </nav>
    </header>
  );
};

export default Header;
