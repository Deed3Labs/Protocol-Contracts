import { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useXMTP } from '@/context/XMTPContext';
import type { Signer } from 'ethers';

export const useXMTPConnection = () => {
  const { connect, isConnected, disconnect } = useXMTP();
  const { address, isConnected: isWalletConnected } = useAccount();
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
      embeddedWalletInfo: !!embeddedWalletInfo
    });
    
    if (!activeAddress || !isActiveWalletConnected || isConnected || isConnecting) {
      console.log('XMTP Connection Hook: Connection conditions not met, skipping');
      return;
    }
    
    // Note: XMTP installation reuse is now handled in the XMTP context
    // The connect function will automatically check for and reuse existing installations
    
    setIsConnecting(true);
    try {
      let signer: Signer;

      if (embeddedWalletInfo) {
        // For AppKit embedded wallets (smart accounts)
        console.log('XMTP Connection Hook: Using AppKit embedded wallet');
        
        if (!walletProvider) {
          throw new Error('No AppKit wallet provider available');
        }

        // Use AppKit's wallet provider to create a signer
        signer = await (walletProvider as { getSigner(): Promise<Signer> }).getSigner();
        console.log('XMTP Connection Hook: AppKit signer created');
      } else {
        // For regular wallets (MetaMask, etc.)
        console.log('XMTP Connection Hook: Using regular wallet');
        
        if (!(window as { ethereum?: unknown }).ethereum) {
          throw new Error('No Ethereum provider available');
        }

        // Create ethers provider and signer
        const { BrowserProvider } = await import('ethers');
        const provider = new BrowserProvider((window as { ethereum: unknown }).ethereum as any);
        signer = await provider.getSigner();
        console.log('XMTP Connection Hook: Regular wallet signer created');
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