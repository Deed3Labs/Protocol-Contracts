import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia, polygon, optimism, avalanche, bsc } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import React from 'react';

const queryClient = new QueryClient();
const projectId = '2a15f8a7329ae7eae3e6bbadc527457f';
const metadata = {
  name: 'DeedNFT Protocol',
  description: 'DeedNFT Protocol App',
  url: 'http://localhost:5173',
  icons: ['https://avatars.githubusercontent.com/u/179229932']
};

const evmNetworks = [mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia, polygon, optimism, avalanche, bsc];

const wagmiAdapter = new WagmiAdapter({
  networks: evmNetworks,
  projectId,
  ssr: true
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: evmNetworks as [typeof mainnet, ...typeof evmNetworks],
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