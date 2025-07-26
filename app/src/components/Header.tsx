import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  children?: ReactNode;
}

const Header = ({ children }: HeaderProps) => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/mint", label: "Mint" },
    { to: "/explore", label: "Explore" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/validation", label: "Validation" },
  ];

  return (
    <header className="sticky top-0 z-30 w-full bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm border-b border-black/10 dark:border-white/10">
      <nav className="container flex items-center justify-between py-4">
        {/* Logo and Desktop Navigation */}
        <div className="flex items-center space-x-4 lg:space-x-8">
          <span className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            DeedNFT Protocol
          </span>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4 lg:space-x-6">
            {navLinks.map((link) => (
              <Link 
                key={link.to}
                to={link.to} 
                className={`font-medium transition-colors duration-200 ${
                  isActive(link.to) 
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center space-x-3">
          <appkit-button />
          {children}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center space-x-3">
          <appkit-button />
          {children}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMobileMenu}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            {isMobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </Button>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-black/10 dark:border-white/10 bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm">
          <div className="container py-4 space-y-3">
            {navLinks.map((link) => (
              <Link 
                key={link.to}
                to={link.to} 
                onClick={closeMobileMenu}
                className={`block py-2 px-4 rounded-lg font-medium transition-colors duration-200 ${
                  isActive(link.to) 
                    ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
