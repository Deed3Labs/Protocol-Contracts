import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, base, sepolia, baseSepolia } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { ReownAuthentication } from '@reown/appkit-siwx';
import React from 'react';

const queryClient = new QueryClient();
const projectId = '2a15f8a7329ae7eae3e6bbadc527457f';
const metadata = {
  name: 'The Deed Protocol by Deed3Labs',
  description: 'Tokenize your real estate, vehicles, and more.',
  url: 'http://localhost:5173',
  icons: ['https://avatars.githubusercontent.com/u/179229932']
};

// Only include supported networks
const supportedNetworks = [mainnet, base, sepolia, baseSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks: supportedNetworks,
  projectId,
  ssr: true
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: supportedNetworks as [typeof mainnet, ...typeof supportedNetworks],
  projectId,
  metadata,
  features: {
    analytics: true,
    email: true,
    socials: ['google', 'x', 'github', 'discord', 'apple', 'facebook', 'farcaster'],
    emailShowWallets: true,
  },
  siwx: new ReownAuthentication(),
  allWallets: 'SHOW'
});

export function AppKitProvider({ children }: { children: React.ReactNode }) {
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