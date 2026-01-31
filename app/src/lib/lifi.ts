/**
 * Li.Fi SDK Configuration
 * Integrates Li.Fi SDK with Wagmi/AppKit for multichain swaps and bridges
 */

import { createConfig, EVM, config } from '@lifi/sdk';
import { getWalletClient, switchChain } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';

// Initialize Li.Fi SDK configuration
export const lifiConfig = createConfig({
  integrator: 'Deed3Labs',
  providers: [
    EVM({
      getWalletClient: async () => {
        const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig);
        if (!walletClient) {
          throw new Error('Wallet not connected');
        }
        return walletClient;
      },
      switchChain: async (chainId: number) => {
        const chain = await switchChain(wagmiAdapter.wagmiConfig, { chainId });
        const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig, { chainId: chain.id });
        if (!walletClient) {
          throw new Error('Failed to get wallet client after chain switch');
        }
        return walletClient;
      },
    }),
  ],
});

// Export the config for use in hooks
export { config as lifiSDKConfig };
