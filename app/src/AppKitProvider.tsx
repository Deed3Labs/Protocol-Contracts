import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, base, sepolia, baseSepolia } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { ReownAuthentication } from '@reown/appkit-siwx';
import React from 'react';

const queryClient = new QueryClient();

// Get project ID from environment variable
const projectId = import.meta.env.VITE_APPKIT_PROJECT_ID;

// Validate that we have a project ID
if (!projectId) {
  throw new Error('VITE_APPKIT_PROJECT_ID is required. Please create a .env file with your AppKit project ID.');
}

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
      return import.meta.env.VITE_DEMO_URL || 'https://demo.deed3.io';
    } else if (hostname === 'app.deed3.io') {
      return import.meta.env.VITE_APP_URL || 'https://app.deed3.io';
    } else {
      // Fallback to production for any other environment
      return import.meta.env.VITE_APP_URL || 'https://app.deed3.io';
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

  // Handle deep links for mobile wallet connections
  React.useEffect(() => {
    const handleDeepLink = () => {
      // Check if we're returning from a mobile wallet
      const urlParams = new URLSearchParams(window.location.search);
      const walletReturn = urlParams.get('wallet');
      
      if (walletReturn) {
        console.log('Deep link return from wallet:', walletReturn);
        // Clear the URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    // Handle deep link on mount
    handleDeepLink();

    // Listen for URL changes (for SPA navigation)
    const handleUrlChange = () => {
      handleDeepLink();
    };

    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // Ensure AppKit modal icons load properly
  React.useEffect(() => {
    // Monitor for AppKit modal and ensure icons load
    const checkModal = () => {
      const modal = (window as any).appKitModal;
      if (modal) {
        console.log('AppKit modal found, ensuring icons load properly');
        
        // Override the open method to ensure icons are loaded
        const originalOpen = modal.open;
        if (originalOpen) {
          modal.open = function(...args: any[]) {
            console.log('AppKit modal opening, ensuring icons load');
            
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
            
            // Call original open method
            return originalOpen.apply(this, args);
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