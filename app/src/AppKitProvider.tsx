import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, base, sepolia, baseSepolia } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { ReownAuthentication } from '@reown/appkit-siwx';
import React from 'react';

const queryClient = new QueryClient();
const projectId = '2a15f8a7329ae7eae3e6bbadc527457f';

// Determine the current environment and set the appropriate URL
const getCurrentUrl = () => {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;
    
    console.log('Current location:', {
      hostname,
      protocol,
      port,
      href: window.location.href
    });
    
    // For development, always use localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    }
    
    // For production domains, use HTTPS
    if (hostname === 'demo.deed3.io') {
      return 'https://demo.deed3.io';
    } else if (hostname === 'app.deed3.io') {
      return 'https://app.deed3.io';
    } else {
      // Fallback to production for any other environment
      return 'https://app.deed3.io';
    }
  }
  
  // For SSR or when window is not available, we need to detect the environment differently
  // Check if we're in a production build
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    // In production, default to app.deed3.io
    return 'https://app.deed3.io';
  }
  
  // For development builds, default to localhost
  return 'https://app.deed3.io';
};

const currentUrl = getCurrentUrl();
console.log('AppKit Configuration:', {
  projectId,
  currentUrl,
  hostname: typeof window !== 'undefined' ? window.location.hostname : 'server',
  protocol: typeof window !== 'undefined' ? window.location.protocol : 'server',
  port: typeof window !== 'undefined' ? window.location.port : 'server'
});

const metadata = {
  name: 'The Deed Protocol by Deed3Labs',
  description: 'Tokenize your real estate, vehicles, and more.',
  url: currentUrl,
  icons: ['https://avatars.githubusercontent.com/u/179229932']
};

// Only include supported networks
const supportedNetworks = [mainnet, base, sepolia, baseSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks: supportedNetworks,
  projectId,
  ssr: true
});

// Initialize AppKit only after component mounts to avoid SSR issues
const initializeAppKit = () => {
  const currentUrl = getCurrentUrl();
  console.log('Initializing AppKit with URL:', currentUrl);
  
  // Detect mobile environment
  const isMobile = typeof window !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 2)
  );
  
  const isIOS = typeof window !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = typeof window !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  
  console.log('Mobile detection:', {
    isMobile,
    isIOS,
    isSafari,
    userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'server',
    maxTouchPoints: typeof window !== 'undefined' ? navigator.maxTouchPoints : 'server'
  });
  
  createAppKit({
    adapters: [wagmiAdapter],
    networks: supportedNetworks as [typeof mainnet, ...typeof supportedNetworks],
    projectId,
    metadata: {
      ...metadata,
      url: currentUrl
    },
    features: {
      analytics: true,
      email: true,
      socials: ['google', 'x', 'github', 'discord', 'apple', 'facebook', 'farcaster'],
      emailShowWallets: true,
    },
    siwx: new ReownAuthentication(),
    allWallets: 'SHOW'
  });
};

export function AppKitProvider({ children }: { children: React.ReactNode }) {
  // Initialize AppKit after component mounts to avoid SSR issues
  React.useEffect(() => {
    initializeAppKit();
  }, []);

  // Add mobile-specific event listeners for better wallet connection handling
  React.useEffect(() => {
    // Handle mobile deep linking and wallet connection events
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('App became visible, checking for wallet connection state');
        // This helps with mobile wallet connections that return to the app
      }
    };

    const handleFocus = () => {
      console.log('App gained focus, checking wallet connection');
      // This helps with mobile wallet connections
    };

    // Add event listeners for mobile wallet connection handling
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Ensure AppKit modal icons load properly and handle mobile connections
  React.useEffect(() => {
    // Monitor for AppKit modal and ensure icons load
    const checkModal = () => {
      const modal = (window as any).appKitModal;
      if (modal) {
        console.log('AppKit modal found, ensuring icons load properly');
        
        // Override the open method to ensure icons are loaded and handle mobile
        const originalOpen = modal.open;
        if (originalOpen) {
          modal.open = function(...args: any[]) {
            console.log('AppKit modal opening, ensuring icons load');
            
            // Detect mobile environment
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
            
            console.log('Mobile detection in modal:', { isMobile, isIOS, isSafari });
            
            // Force icon preloading before opening
            const iconUrls = [
              'https://api.web3modal.com/v2/connector/metamask/icon',
              'https://api.web3modal.com/v2/connector/trust/icon',
              'https://api.web3modal.com/v2/connector/coinbase/icon',
              'https://api.web3modal.com/v2/connector/rainbow/icon',
              'https://api.web3modal.com/v2/connector/google/icon',
              'https://api.web3modal.com/v2/connector/apple/icon',
              'https://api.web3modal.com/v2/connector/facebook/icon',
              'https://api.web3modal.com/v2/connector/x/icon',
              'https://api.web3modal.com/v2/connector/github/icon',
              'https://api.web3modal.com/v2/connector/discord/icon',
              'https://api.web3modal.com/v2/connector/farcaster/icon'
            ];
            
            // Preload icons
            iconUrls.forEach(url => {
              const img = new Image();
              img.src = url;
            });
            
            // For mobile devices, add a small delay to ensure proper initialization
            if (isMobile) {
              console.log('Mobile device detected, adding delay for proper modal initialization');
              setTimeout(() => {
                return originalOpen.apply(this, args);
              }, 100);
            } else {
              // Call original open method immediately for desktop
              return originalOpen.apply(this, args);
            }
          };
        }
        
        // Also override the modal's wallet selection to handle mobile deep linking
        if (modal.selectWallet) {
          const originalSelectWallet = modal.selectWallet;
          modal.selectWallet = function(walletId: string, ...args: any[]) {
            console.log('Wallet selected:', walletId);
            
            // Detect mobile environment within this scope
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            // For MetaMask on mobile, ensure proper deep linking
            if (walletId === 'metamask' && isMobile) {
              console.log('MetaMask selected on mobile, ensuring deep link handling');
              
              // Check if MetaMask is installed
              const isMetaMaskInstalled = typeof window !== 'undefined' && 
                (window as any).ethereum?.isMetaMask;
              
              if (!isMetaMaskInstalled) {
                console.log('MetaMask not installed, will redirect to App Store');
              }
            }
            
            return originalSelectWallet.apply(this, [walletId, ...args]);
          };
        }
      } else {
        // Retry after a short delay
        setTimeout(checkModal, 500);
      }
    };
    
    checkModal();
  }, []);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
} 