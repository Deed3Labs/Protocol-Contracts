import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import { WagmiProvider, createConfig } from '@privy-io/wagmi';
import type { Config as WagmiCoreConfig } from '@wagmi/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http } from 'viem';
import { mainnet, base, sepolia, baseSepolia, arbitrum, optimism, polygon, gnosis } from 'viem/chains';
import { AppKitAuthProvider } from '@/hooks/useAppKitAuth';

/*
 * Privy provider stack (replaces Reown AppKit).
 *  - PrivyProvider: email/social + external-wallet login; auto-creates an embedded EOA, and (with
 *    Smart Wallets enabled in the Privy dashboard) a Kernel/ZeroDev smart wallet on top of it.
 *  - @privy-io/wagmi WagmiProvider/createConfig: drop-in wagmi so existing writeContract/signTypedData/
 *    readContract code keeps working; Privy drives the connector state (reconnectOnMount handled).
 *  - SmartWalletsProvider: exposes useSmartWallets().client.sendTransaction({ calls }) — batched,
 *    auto-sponsored via the per-chain paymaster URL registered in the Privy dashboard (our funded
 *    ZeroDev self-funded paymaster). This is what makes deposits/sends gasless.
 *
 * The component export keeps the name `AppKitProvider` and we keep a `wagmiAdapter` shim so main.tsx
 * and the lib/* files (sendCalls/autopay/aa/gaslessMoney/lifi) don't need to change.
 */

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
if (!appId) {
  // Don't hard-throw (keeps the bundle importable in CI/build); surface loudly at runtime instead.
  console.error('VITE_PRIVY_APP_ID is required — set it in your env (Privy dashboard → App settings).');
}

// Networks enabled for wallet connections + wagmi switchChain. Must include any chain LI.FI routes
// may require (Gnosis/Arbitrum/etc.). Clear itself operates on Base (ACTIVE_CHAIN_ID).
const supportedChains = [base, baseSepolia, mainnet, sepolia, arbitrum, optimism, polygon, gnosis];

const queryClient = new QueryClient();

const wagmiConfigInternal = createConfig({
  chains: [base, baseSepolia, mainnet, sepolia, arbitrum, optimism, polygon, gnosis],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [gnosis.id]: http(),
  },
});

// @wagmi/core actions in lib/* are typed against a slightly different Config (Privy bundles its own
// wagmi/viem types); cast to the base Config so they accept this (runtime-identical) instance.
export const wagmiConfig = wagmiConfigInternal as unknown as WagmiCoreConfig;
// Back-compat shim: lib/{sendCalls,autopay,aa,gaslessMoney,lifi}.ts read `wagmiAdapter.wagmiConfig`.
export const wagmiAdapter = { wagmiConfig };

const getCurrentTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
};

export function AppKitProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId ?? ''}
      config={{
        // Login = identity only (email / phone / social). External wallets are NOT a login — users link
        // them in-app (Privy linked accounts). The Privy smart wallet is the user's primary wallet.
        loginMethods: ['email', 'sms', 'google', 'apple', 'twitter', 'github', 'discord', 'farcaster'],
        // Email/social users get an embedded EOA; Smart Wallets (dashboard) layer a Kernel SA on top.
        // showWalletUIs:false → the embedded signer signs SILENTLY (no Privy confirm/approve popups).
        // Our own Review screen is the confirmation; smart-wallet sendTransaction defaults to this flag.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        defaultChain: base,
        supportedChains: [...supportedChains],
        appearance: {
          theme: getCurrentTheme(),
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfigInternal}>
          <SmartWalletsProvider>
            <AppKitAuthProvider>{children}</AppKitAuthProvider>
          </SmartWalletsProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
