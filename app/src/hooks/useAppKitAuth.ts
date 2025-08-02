import { useCallback, useEffect, useState } from 'react';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { useAppKitSIWX } from '@reown/appkit-siwx/react';
import type { ReownAuthentication } from '@reown/appkit-siwx';

export interface AuthState {
  isConnected: boolean;
  isAuthenticated: boolean;
  address?: string;
  chainId?: number;
  user?: {
    id: string;
    email?: string;
    social?: {
      provider: string;
      id: string;
    };
  };
}

export function useAppKitAuth() {
  const { address, isConnected } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const siwx = useAppKitSIWX<ReownAuthentication>();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  const [authState, setAuthState] = useState<AuthState>({
    isConnected: false,
    isAuthenticated: false,
  });

  // Get the AppKit modal instance
  const getAppKitModal = useCallback(() => {
    if (typeof window !== 'undefined') {
      // Try to get the global AppKit instance
      const appKit = (window as any).AppKit || (window as any).appKit;
      
      if (appKit) {
        console.log('AppKit instance found:', appKit);
        return appKit;
      }
      
      // Try to get the modal directly
      const modal = (window as any).appKitModal || 
                   (window as any).appkitModal || 
                   (window as any).AppKitModal;
      
      if (modal) {
        console.log('AppKit modal found:', modal);
        return modal;
      }
      
      // Try to get from web components
      const appkitButton = document.querySelector('appkit-button');
      if (appkitButton && (appkitButton as any).appKit) {
        console.log('AppKit found in web component:', (appkitButton as any).appKit);
        return (appkitButton as any).appKit;
      }
      
      console.warn('AppKit modal not found');
      return null;
    }
    return null;
  }, []);

  // Open the AppKit modal for wallet connection
  const openModal = useCallback((view?: string) => {
    const appKit = getAppKitModal();
    if (appKit) {
      try {
        console.log('Opening AppKit modal with view:', view);
        
        // Try different methods to open modal
        if (appKit.open) {
          appKit.open(view ? { view } : undefined);
        } else if (appKit.modal && appKit.modal.open) {
          appKit.modal.open(view ? { view } : undefined);
        } else if (appKit.showModal) {
          appKit.showModal(view ? { view } : undefined);
        } else {
          throw new Error('No open method available on AppKit instance');
        }
      } catch (error) {
        console.error('Error opening modal:', error);
        throw error;
      }
    } else {
      console.error('AppKit not available');
      throw new Error('AppKit not available');
    }
  }, [getAppKitModal]);

  // Open modal for disconnection (don't directly disconnect)
  const disconnect = useCallback(async () => {
    try {
      const appKit = getAppKitModal();
      if (appKit) {
        // Open the modal instead of directly disconnecting
        console.log('Opening modal for disconnection...');
        
        if (appKit.open) {
          appKit.open();
        } else if (appKit.modal && appKit.modal.open) {
          appKit.modal.open();
        } else if (appKit.showModal) {
          appKit.showModal();
        } else {
          throw new Error('No open method available on AppKit instance');
        }
      } else {
        console.error('AppKit not available for disconnection');
        throw new Error('AppKit not available');
      }
    } catch (error) {
      console.error('Error opening disconnection modal:', error);
      throw error;
    }
  }, [getAppKitModal]);

  // Sign a message using the connected wallet
  const signMessage = useCallback(async (message: string) => {
    const appKit = getAppKitModal();
    console.log('Attempting to sign message with AppKit:', appKit);
    console.log('Current address:', address);
    console.log('Current connection status:', isConnected);
    
    if (appKit && address && isConnected) {
      try {
        console.log('Signing message:', message);
        
        // Try different methods to sign message
        let signature;
        
        // Method 1: Try direct signMessage method
        if (appKit.signMessage) {
          signature = await appKit.signMessage(message);
        }
        // Method 2: Try through the modal
        else if (appKit.modal && appKit.modal.signMessage) {
          signature = await appKit.modal.signMessage(message);
        }
        // Method 3: Try through the wallet
        else if (appKit.wallet && appKit.wallet.signMessage) {
          signature = await appKit.wallet.signMessage(message);
        }
        // Method 4: Try through the account
        else if (appKit.account && appKit.account.signMessage) {
          signature = await appKit.account.signMessage(message);
        }
        else {
          throw new Error('No signMessage method available on AppKit instance');
        }
        
        console.log('Message signed successfully:', signature);
        return signature;
      } catch (error) {
        console.error('Error signing message:', error);
        throw error;
      }
    } else {
      const errorMsg = !appKit ? 'AppKit not available' : 
                      !address ? 'No wallet address' : 
                      !isConnected ? 'Wallet not connected' : 'Unknown error';
      console.error('Cannot sign message:', errorMsg);
      throw new Error(`Cannot sign message: ${errorMsg}`);
    }
  }, [getAppKitModal, address, isConnected]);

  // Get current user information using SWIX session
  const getUser = useCallback(async () => {
    if (siwx) {
      try {
        const sessionAccount = await siwx.getSessionAccount();
        if (sessionAccount && 'appKitAccount' in sessionAccount) {
          const appKitAccount = (sessionAccount as any).appKitAccount;
          if (appKitAccount?.metadata) {
            const metadata = appKitAccount.metadata as any;
            return {
              id: appKitAccount.uuid,
              email: metadata.email,
              social: metadata.social,
            };
          }
        }
        return null;
      } catch (error) {
        console.error('Error getting user:', error);
        return null;
      }
    }
    return null;
  }, [siwx]);

  // Check if user is authenticated via SWIX
  const checkAuthentication = useCallback(async () => {
    if (siwx) {
      try {
        const sessionAccount = await siwx.getSessionAccount();
        const isAuthenticated = !!sessionAccount;
        const user = await getUser();
        
        setAuthState(prev => ({
          ...prev,
          isAuthenticated,
          user: user || undefined,
        }));
        
        return isAuthenticated;
      } catch (error) {
        console.error('Error checking authentication:', error);
        return false;
      }
    }
    return false;
  }, [siwx, getUser]);

  // Set session metadata
  const setSessionMetadata = useCallback(async (metadata: object) => {
    if (siwx) {
      try {
        await siwx.setSessionAccountMetadata(metadata);
      } catch (error) {
        console.error('Error setting session metadata:', error);
        throw error;
      }
    }
  }, [siwx]);

  // Update auth state when wallet connection changes
  useEffect(() => {
    setAuthState(prev => ({
      ...prev,
      isConnected,
      address,
      chainId,
    }));
  }, [isConnected, address, chainId]);

  // Check authentication status on mount and when wallet connects
  useEffect(() => {
    if (isConnected) {
      checkAuthentication();
    } else {
      setAuthState(prev => ({
        ...prev,
        isAuthenticated: false,
        user: undefined,
      }));
    }
  }, [isConnected, checkAuthentication]);

  return {
    ...authState,
    openModal,
    disconnect,
    signMessage,
    getUser,
    checkAuthentication,
    setSessionMetadata,
    getAppKitModal,
    siwx,
  };
} 