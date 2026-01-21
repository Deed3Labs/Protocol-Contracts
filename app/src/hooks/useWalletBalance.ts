import { useState, useEffect, useMemo } from 'react';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { getNetworkByChainId, getRpcUrlForNetwork } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';
import { useTokenPrice } from './useTokenPrice';

interface WalletBalance {
  balance: string; // Formatted balance string
  balanceWei: bigint; // Raw balance in wei
  balanceUSD: number; // Balance in USD
  isLoading: boolean;
  error: string | null;
  currencySymbol: string; // Native currency symbol (ETH, etc.)
  currencyName: string; // Native currency name
}

/**
 * Hook to fetch the native token balance (ETH, BASE, etc.) of the connected wallet
 */
export function useWalletBalance(): WalletBalance {
  const { address, isConnected } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const [balance, setBalance] = useState<string>('0.00');
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch token price for USD conversion
  const { price: tokenPrice } = useTokenPrice();

  // Get network info for native currency
  const chainId = useMemo(() => {
    return caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  }, [caipNetworkId]);

  const networkConfig = useMemo(() => {
    return chainId ? getNetworkByChainId(chainId) : null;
  }, [chainId]);

  const currencySymbol = useMemo(() => {
    return networkConfig?.nativeCurrency.symbol || 'ETH';
  }, [networkConfig]);

  const currencyName = useMemo(() => {
    return networkConfig?.nativeCurrency.name || 'Ether';
  }, [networkConfig]);

  // Calculate USD balance
  const balanceUSD = useMemo(() => {
    const balanceNum = parseFloat(balance) || 0;
    return balanceNum * tokenPrice;
  }, [balance, tokenPrice]);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!isConnected || !address) {
        setBalance('0.00');
        setBalanceWei(0n);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      // Add a small delay for mobile wallet connections to ensure provider is ready
      // This is especially important after returning from MetaMask app on mobile
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        let provider: ethers.Provider;

        // For read operations, always use a standard ethers provider
        // Use mobile-safe provider helper that handles initialization delays
        try {
          // Try to get provider from window.ethereum (works with MetaMask on mobile)
          provider = await getEthereumProvider();
        } catch (providerError) {
          // Fallback to RPC provider using network config
          // This is useful when window.ethereum is not available (e.g., some mobile scenarios)
          if (!chainId) {
            throw new Error('No chain ID available');
          }
          
          const rpcUrl = getRpcUrlForNetwork(chainId);
          if (!rpcUrl) {
            throw new Error(`No RPC URL available for chain ${chainId}`);
          }
          
          provider = new ethers.JsonRpcProvider(rpcUrl);
        }

        const balance = await provider.getBalance(address);
        setBalanceWei(balance);
        
        // Format balance to readable string (4 decimal places)
        const formattedBalance = ethers.formatEther(balance);
        setBalance(parseFloat(formattedBalance).toFixed(4));
      } catch (err) {
        console.error('Error fetching wallet balance:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch balance');
        setBalance('0.00');
        setBalanceWei(0n);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalance();

    // Poll for balance updates every 10 seconds
    const interval = setInterval(fetchBalance, 10000);

    // Listen for mobile wallet return events (from AppKitProvider)
    const handleMobileWalletReturn = () => {
      console.log('Mobile wallet return detected, refreshing balance...');
      // Wait a bit longer for mobile wallet to fully initialize
      setTimeout(fetchBalance, 1000);
    };

    window.addEventListener('mobileWalletReturn', handleMobileWalletReturn);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mobileWalletReturn', handleMobileWalletReturn);
    };
  }, [address, isConnected, chainId]);

  return {
    balance,
    balanceWei,
    balanceUSD,
    isLoading,
    error,
    currencySymbol,
    currencyName
  };
}
