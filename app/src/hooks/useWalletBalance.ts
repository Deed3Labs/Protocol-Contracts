import { useState, useEffect, useMemo } from 'react';
import { useAppKitAccount, useAppKitProvider, useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { getNetworkByChainId, getRpcUrlForNetwork } from '@/config/networks';

interface WalletBalance {
  balance: string; // Formatted balance string
  balanceWei: bigint; // Raw balance in wei
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
  const { walletProvider } = useAppKitProvider("eip155");
  const { caipNetworkId } = useAppKitNetwork();
  const [balance, setBalance] = useState<string>('0.00');
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      try {
        let provider: ethers.Provider;

        // Try to use AppKit provider first
        if (walletProvider) {
          provider = walletProvider as unknown as ethers.Provider;
        } else if (window.ethereum) {
          provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
        } else {
          // Fallback to RPC provider using network config
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

    return () => clearInterval(interval);
  }, [address, isConnected, walletProvider, chainId]);

  return {
    balance,
    balanceWei,
    isLoading,
    error,
    currencySymbol,
    currencyName
  };
}
