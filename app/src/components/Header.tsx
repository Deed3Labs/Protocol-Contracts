import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Shield, Home, Plus, Search, BarChart3, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { ethers } from "ethers";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";

interface HeaderProps {
  children?: ReactNode;
}

const Header = ({ children }: HeaderProps) => {
  const location = useLocation();
  const { address, isConnected, embeddedWalletInfo } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider("eip155");
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  
  const [hasAdminRole, setHasAdminRole] = useState(false);

  // Helper function to handle AppKit read operations
  const executeAppKitCall = async (
    contractAddress: string,
    abi: any,
    functionName: string,
    params: any[]
  ) => {
    if (!walletProvider || !embeddedWalletInfo) {
      throw new Error("AppKit provider not available");
    }

    console.log(`Executing AppKit call: ${functionName}`, {
      contractAddress,
      params
    });

    const data = new ethers.Interface(abi).encodeFunctionData(functionName, params);
    
    const result = await (walletProvider as any).request({
      method: 'eth_call',
      params: [{
        to: contractAddress,
        data
      }, 'latest']
    });

    console.log("AppKit call result:", result);
    return result;
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  // Check if user has admin role
  useEffect(() => {
    const checkAdminRole = async () => {
      // Check if connected (either regular wallet or embedded wallet)
      const isWalletConnected = isConnected || (embeddedWalletInfo !== null);
      
      if (!isWalletConnected || !address || !chainId) {
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
        
        if (walletProvider && embeddedWalletInfo) {
          // Use AppKit calls for embedded wallets
          console.log('Header: Using AppKit calls for role checks');
          for (const [roleKey, roleValue] of Object.entries(ROLES)) {
            try {
              const result = await executeAppKitCall(
                deedNFTAddress,
                abi,
                'hasRole',
                [roleValue, address]
              );
              const hasRole = new ethers.Interface(abi).decodeFunctionResult('hasRole', result)[0];
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
            const ownerResult = await executeAppKitCall(
              deedNFTAddress,
              abi,
              'owner',
              []
            );
            const owner = new ethers.Interface(abi).decodeFunctionResult('owner', ownerResult)[0];
            console.log(`Header: Contract owner: ${owner}`);
            if (owner.toLowerCase() === address.toLowerCase()) {
              hasAnyAdminRole = true;
            }
          } catch (error) {
            console.log('Header: Contract does not have owner() function or error occurred:', error);
          }
        } else {
          // Use traditional ethers.js for MetaMask
          console.log('Header: Using MetaMask for role checks');
          if (!window.ethereum) return;
          const provider = new ethers.BrowserProvider(window.ethereum as any);
          const contract = new ethers.Contract(deedNFTAddress, abi, provider);
          
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
        }

        console.log('Header: Final admin role check for', address, '=', hasAnyAdminRole);
        setHasAdminRole(hasAnyAdminRole);
      } catch (error) {
        console.error('Error checking admin role:', error);
        setHasAdminRole(false);
      }
    };

    checkAdminRole();
  }, [isConnected, embeddedWalletInfo, address, chainId]);

  const navLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/explore", label: "Explore", icon: Search },
    { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { to: "/validation", label: "Validation", icon: ShieldCheck },
  ];

  // Debug logging
  console.log('Header: hasAdminRole =', hasAdminRole);
  console.log('Header: navLinks =', navLinks);
  console.log('Header: isConnected =', isConnected);
  console.log('Header: address =', address);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 w-full bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm border-b border-black/10 dark:border-white/10">
        <nav className="container flex items-center justify-between py-4">
          {/* Logo and Desktop Navigation */}
          <div className="flex items-center space-x-4 lg:space-x-8">
            <span className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              Deed Protocol
            </span>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-4 lg:space-x-6">
              {/* Home */}
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

              {/* Explore */}
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

              {/* Mint - 3rd position */}
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

              {/* Dashboard */}
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

              {/* Validation */}
              <Link 
                to="/validation"
                className={`font-medium transition-colors duration-200 ${
                  isActive("/validation") 
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white pb-1" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                Validation
              </Link>
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center space-x-2">
            <appkit-button />
            <Link to="/profile">
              <Button variant="outline" size="sm" className="h-9 px-3 border-black/10 dark:border-white/10">
                <User className="w-4 h-4 mr-1" />
                Profile
              </Button>
            </Link>
            {hasAdminRole && (
              <Link to="/admin">
                <Button variant="outline" size="sm" className="h-9 px-3 border-black/10 dark:border-white/10">
                  <Shield className="w-4 h-4 mr-1" />
                  Admin
                </Button>
              </Link>
            )}
            {children}
          </div>

          {/* Mobile Actions */}
          <div className="md:hidden flex items-center space-x-2">
            <appkit-button />
            <Link to="/profile">
              <Button variant="outline" size="icon" className="border-black/10 dark:border-white/10">
                <User className="w-4 h-4" />
              </Button>
            </Link>
            {hasAdminRole && (
              <Link to="/admin">
                <Button variant="outline" size="icon" className="border-black/10 dark:border-white/10">
                  <Shield className="w-4 h-4" />
                </Button>
              </Link>
            )}
            {children}
          </div>
        </nav>
      </header>

      {/* Spacer to prevent content from being hidden behind fixed header */}
      <div className="h-0.5 md:h-20"></div>

      {/* Mobile Bottom Tab Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0E0E0E]/95 backdrop-blur-sm border-t border-black/10 dark:border-white/10">
        <div className="flex items-center justify-around py-2">
          {/* Home */}
          <Link 
            to="/"
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-0 flex-1 ${
              isActive("/") 
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Home className="w-5 h-5 mb-1" />
            <span className="text-xs font-medium truncate">Home</span>
          </Link>

          {/* Explore */}
          <Link 
            to="/explore"
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-0 flex-1 ${
              isActive("/explore") 
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Search className="w-5 h-5 mb-1" />
            <span className="text-xs font-medium truncate">Explore</span>
          </Link>

          {/* Mint Button - 3rd position */}
          <Link 
            to="/mint"
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-0 flex-1 ${
              isActive("/mint") 
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Plus className="w-5 h-5 mb-1" />
            <span className="text-xs font-medium truncate">Mint</span>
          </Link>

          {/* Dashboard */}
          <Link 
            to="/dashboard"
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-0 flex-1 ${
              isActive("/dashboard") 
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <BarChart3 className="w-5 h-5 mb-1" />
            <span className="text-xs font-medium truncate">Dashboard</span>
          </Link>

          {/* Validation */}
          <Link 
            to="/validation"
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-0 flex-1 ${
              isActive("/validation") 
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800" 
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <ShieldCheck className="w-5 h-5 mb-1" />
            <span className="text-xs font-medium truncate">Validation</span>
          </Link>
        </div>
      </div>

      {/* Add bottom padding to prevent content from being hidden behind the bottom nav */}
      <div className="md:hidden h-20"></div>
    </>
  );
};

export default Header;
