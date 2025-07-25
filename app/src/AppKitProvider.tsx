import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, base, sepolia, baseSepolia } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
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
    analytics: true
  }
});

export function AppKitProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
} 