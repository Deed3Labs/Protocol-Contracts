import { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useXMTP } from '@/context/XMTPContext';
import type { Signer } from 'ethers';

export const useXMTPConnection = () => {
  const { connect, isConnected, disconnect } = useXMTP();
  const { address, isConnected: isWalletConnected, connector } = useAccount();
  const { address: appkitAddress, isConnected: isAppKitConnected, embeddedWalletInfo } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const [isConnecting, setIsConnecting] = useState(false);
  const connectionAttempted = useRef(false);

  // Determine which wallet is active
  const activeAddress = appkitAddress || address;
  const isActiveWalletConnected = isAppKitConnected || isWalletConnected;

  // Track previous address to detect changes
  const prevAddressRef = useRef<string | undefined>(activeAddress);

  // Reset connection attempt when wallet disconnects or address changes
  useEffect(() => {
    const prevAddress = prevAddressRef.current;
    const currentAddress = activeAddress;

    // If address changed and we were connected, reset the connection
    if (prevAddress && currentAddress && prevAddress !== currentAddress && isConnected) {
      console.log('XMTP Connection Hook: Address changed, resetting XMTP connection', {
        prevAddress,
        currentAddress
      });
      connectionAttempted.current = false;
      disconnect().catch(console.error);
    }

    // If wallet disconnected, reset connection
    if (!isActiveWalletConnected && isConnected) {
      console.log('XMTP Connection Hook: Wallet disconnected, resetting XMTP connection');
      connectionAttempted.current = false;
      disconnect().catch(console.error);
    }

    // If wallet is not connected and we're not connected to XMTP, don't do anything
    if (!isActiveWalletConnected && !isConnected) {
      console.log('XMTP Connection Hook: Wallet not connected and XMTP not connected, skipping');
      return;
    }

    // Update the previous address reference
    prevAddressRef.current = currentAddress;
  }, [isActiveWalletConnected, activeAddress, isConnected]); // Removed disconnect from dependencies

  const handleConnect = async () => {
    console.log('XMTP Connection Hook: Starting connection...', {
      activeAddress,
      isActiveWalletConnected,
      isConnected,
      isConnecting,
      embeddedWalletInfo: !!embeddedWalletInfo,
      hasWalletProvider: !!walletProvider,
      hasConnector: !!connector
    });
    
    if (!activeAddress || !isActiveWalletConnected || isConnected || isConnecting) {
      console.log('XMTP Connection Hook: Connection conditions not met, skipping');
      return;
    }
    
    // Note: XMTP installation reuse is now handled in the XMTP context
    // The connect function will ALWAYS check for existing installations across browsers
    // and sync them to ensure users have access to all their past messages
    
    setIsConnecting(true);
    try {
      let signer: Signer;
      const { BrowserProvider } = await import('ethers');

      // 1. Prefer AppKit walletProvider when available (covers embedded wallets AND WalletConnect on mobile Safari).
      // On mobile Safari there is no window.ethereum; WalletConnect sessions use walletProvider from AppKit.
      if (walletProvider) {
        const hasGetSigner = typeof (walletProvider as { getSigner?: () => unknown }).getSigner === 'function';
        if (hasGetSigner) {
          console.log('XMTP Connection Hook: Using AppKit wallet provider (getSigner)');
          signer = await (walletProvider as { getSigner(): Promise<Signer> }).getSigner();
        } else {
          console.log('XMTP Connection Hook: Using AppKit wallet provider (BrowserProvider)');
          const provider = new BrowserProvider(walletProvider as import('ethers').Eip1193Provider);
          signer = await provider.getSigner();
        }
        console.log('XMTP Connection Hook: AppKit signer created');
      } else if (typeof window !== 'undefined' && (window as { ethereum?: unknown }).ethereum) {
        // 2. Browser extension (MetaMask, etc.) when not using WalletConnect
        console.log('XMTP Connection Hook: Using window.ethereum');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!(window as { ethereum?: unknown }).ethereum) {
          throw new Error('Ethereum provider not available after initialization delay');
        }
        const provider = new BrowserProvider((window as { ethereum: unknown }).ethereum as import('ethers').Eip1193Provider);
        signer = await provider.getSigner();
        console.log('XMTP Connection Hook: Regular wallet signer created');
      } else if (connector) {
        // 3. Fallback: wagmi connector (e.g. after mobile deeplink return when walletProvider may not be hydrated yet)
        console.log('XMTP Connection Hook: Using wagmi connector provider');
        const provider = await connector.getProvider();
        if (!provider) {
          throw new Error('No provider available from wallet connector. Try reconnecting or opening the app in your wallet browser.');
        }
        const ethersProvider = new BrowserProvider(provider as import('ethers').Eip1193Provider);
        signer = await ethersProvider.getSigner();
        console.log('XMTP Connection Hook: Connector signer created');
      } else {
        throw new Error('No Ethereum provider available. On mobile Safari, connect your wallet first and ensure you return to this tab after approving.');
      }
      
      console.log('XMTP Connection Hook: Calling XMTP connect...');
      await connect(signer);
      console.log('XMTP Connection Hook: Connection successful');
    } catch (err) {
      console.error('XMTP Connection Hook: Failed to connect to XMTP:', err);
      connectionAttempted.current = false; // Allow retry on error
      throw err;
    } finally {
      setIsConnecting(false);
      console.log('XMTP Connection Hook: Connection attempt finished');
    }
  };

  return {
    handleConnect,
    isConnecting,
    isConnected,
    isWalletConnected: isActiveWalletConnected,
    address: activeAddress,
    isEmbeddedWallet: !!embeddedWalletInfo
  };
}; 