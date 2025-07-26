import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Menu, X, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount, useChainId } from 'wagmi';
import { ethers } from "ethers";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";

interface HeaderProps {
  children?: ReactNode;
}

const Header = ({ children }: HeaderProps) => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [hasAdminRole, setHasAdminRole] = useState(false);

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  // Check if user has admin role
  useEffect(() => {
    const checkAdminRole = async () => {
      if (!isConnected || !address || !chainId) {
        setHasAdminRole(false);
        return;
      }

      try {
        const deedNFTAddress = getContractAddressForNetwork(chainId);
        if (!deedNFTAddress) return;

        // Dynamic ABI loading with fallback (same as AdminPanel)
        let abi;
        try {
          const abiPath = getAbiPathForNetwork(chainId, 'DeedNFT');
          const abiModule = await import(abiPath);
          abi = JSON.parse(abiModule.default.abi);
        } catch (error) {
          console.error('Error loading DeedNFT ABI:', error);
          // Fallback to base-sepolia
          const fallbackModule = await import('@/contracts/base-sepolia/DeedNFT.json');
          abi = JSON.parse(fallbackModule.default.abi);
        }

        if (!window.ethereum) return;
        const provider = new ethers.BrowserProvider(window.ethereum as any);
        const contract = new ethers.Contract(deedNFTAddress, abi, provider);

        // Check for various admin roles (same as AdminPanel)
        const ROLES = {
          DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
          VALIDATOR_ROLE: "0x2172861495e7b85edac73e3cd5fbb42dd675baadf627720e687bcfdaca025096",
          MINTER_ROLE: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
          METADATA_ROLE: "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9f6df31a2a355e4bd87e",
          CRITERIA_MANAGER_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8c8",
          FEE_MANAGER_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8c9",
          ADMIN_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8ca",
          REGISTRY_ADMIN_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8cb"
        };

        // Check if user has any admin role
        let hasAnyAdminRole = false;
        console.log('Header: Starting role checks for address:', address);
        for (const [roleKey, roleValue] of Object.entries(ROLES)) {
          try {
            const hasRole = await contract.hasRole(roleValue, address);
            console.log(`Header: Role ${roleKey} check for ${address} = ${hasRole}`);
            if (hasRole) {
              console.log(`Header: Found admin role: ${roleKey}`);
              hasAnyAdminRole = true;
              break;
            }
          } catch (error) {
            console.log(`Header: Error checking role ${roleKey}:`, error);
          }
        }

        // Also check if user is the owner (for contracts that use Ownable)
        try {
          const owner = await contract.owner();
          console.log(`Header: Contract owner: ${owner}`);
          if (owner.toLowerCase() === address.toLowerCase()) {
            hasAnyAdminRole = true;
          }
        } catch (error) {
          console.log('Header: Contract does not have owner() function or error occurred:', error);
        }

        console.log('Header: Final admin role check for', address, '=', hasAnyAdminRole);
        setHasAdminRole(hasAnyAdminRole);
      } catch (error) {
        console.error('Error checking admin role:', error);
        setHasAdminRole(false);
      }
    };

    checkAdminRole();
  }, [isConnected, address, chainId]);

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/mint", label: "Mint" },
    { to: "/explore", label: "Explore" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/validation", label: "Validation" },
    ...(hasAdminRole ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];

  // Debug logging
  console.log('Header: hasAdminRole =', hasAdminRole);
  console.log('Header: navLinks =', navLinks);
  console.log('Header: isConnected =', isConnected);
  console.log('Header: address =', address);

  return (
    <header className="sticky top-0 z-30 w-full bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm border-b border-black/10 dark:border-white/10">
      <nav className="container flex items-center justify-between py-4">
        {/* Logo and Desktop Navigation */}
        <div className="flex items-center space-x-4 lg:space-x-8">
          <span className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Deed Protocol
          </span>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4 lg:space-x-6">
            {navLinks.map((link) => (
              <Link 
                key={link.to}
                to={link.to} 
                className={`font-medium transition-colors duration-200 flex items-center gap-1 ${
                  isActive(link.to) 
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {link.icon && <link.icon className="w-4 h-4" />}
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
                className={`block py-2 px-4 rounded-lg font-medium transition-colors duration-200 flex items-center gap-2 ${
                  isActive(link.to) 
                    ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {link.icon && <link.icon className="w-4 h-4" />}
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
