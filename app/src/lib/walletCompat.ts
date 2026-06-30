import { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';

/*
 * Privy-backed drop-in replacements for the Reown AppKit React hooks the app used everywhere. Lets the
 * ~40 call sites keep their exact shape — only the import path changes (from the old Reown AppKit
 * react entry) to '@/lib/walletCompat'. See [[clearpath-privy-migration]].
 *
 * KEY: for email/social (embedded) users, `address` is the SMART WALLET address (where funds live),
 * not the embedded EOA signer. For external wallets (MetaMask) it's their own EOA address.
 */

type AccountType = 'smartAccount' | 'eoa';

export function useAppKitAccount() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { address: wagmiAddress } = useAccount();

  const smartWalletAddress = (user?.smartWallet?.address ?? undefined) as `0x${string}` | undefined;

  // An EXTERNAL wallet (MetaMask etc.) is any connected wallet that ISN'T Privy's embedded one. Privy may
  // ALSO mint an embedded wallet for an external login, so we tell them apart via the wallet LIST, not
  // user.wallet (which can point at the embedded/smart wallet and leave `address` undefined → the login
  // screen never advances and the backend can't reclaim the member by the real MetaMask address).
  const externalWallet = wallets?.find((w) => w.walletClientType !== 'privy');
  const embeddedWallet = wallets?.find((w) => w.walletClientType === 'privy');
  const isEmbedded = !externalWallet;

  // External login → that wallet's OWN address (same across providers → reclaims the member, tier-2/3).
  // Email/social → the smart wallet address (tier 1, where funds live).
  const address = (
    isEmbedded
      ? (smartWalletAddress ?? embeddedWallet?.address ?? wagmiAddress ?? user?.wallet?.address)
      : (externalWallet?.address ?? wagmiAddress)
  ) as `0x${string}` | undefined;
  const isConnected = !!authenticated && !!address;
  const accountType: AccountType = isEmbedded && smartWalletAddress ? 'smartAccount' : 'eoa';

  // Best-effort fill of the fields Reown's embeddedWalletInfo carried (read by a few hooks/legacy pages).
  const u = user as { email?: { address?: string } | string; linkedAccounts?: Array<{ type?: string }> } | null | undefined;
  const email = typeof u?.email === 'string' ? u.email : u?.email?.address;
  const oauth = u?.linkedAccounts?.find((a) => typeof a.type === 'string' && a.type.endsWith('_oauth'));
  const authProvider = oauth ? (oauth.type as string).replace('_oauth', '') : email ? 'email' : undefined;

  return {
    address,
    isConnected,
    status: (!ready ? 'connecting' : isConnected ? 'connected' : 'disconnected') as
      | 'connecting'
      | 'connected'
      | 'disconnected',
    // Present only for embedded (Privy) users; external wallets get undefined (matches Reown).
    embeddedWalletInfo: isEmbedded
      ? {
          accountType,
          // Privy manages smart-wallet deployment (counterfactual; deploys on first tx) — treat as ready.
          isSmartAccountDeployed: accountType === 'smartAccount',
          authProvider,
          user: { email },
        }
      : undefined,
  } as const;
}

export function useAppKitNetwork() {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  return {
    chainId,
    caipNetwork: chainId ? { id: chainId, caipNetworkId: `eip155:${chainId}` as const } : undefined,
    caipNetworkId: chainId ? (`eip155:${chainId}` as const) : undefined,
    switchNetwork: async (network: number | { id?: number; chainId?: number }) => {
      const id = typeof network === 'number' ? network : (network?.id ?? network?.chainId);
      if (id) await switchChainAsync({ chainId: id });
    },
  } as const;
}

export function useAppKit() {
  const { login, logout } = usePrivy();
  return {
    open: (_opts?: { view?: 'Account' | 'Connect' | 'Networks' }) => login(),
    close: () => {},
    logout,
  } as const;
}

export function useDisconnect() {
  const { logout } = usePrivy();
  return { disconnect: async () => { await logout(); } } as const;
}

/**
 * Returns the active wallet's EIP-1193 provider (resolved from Privy's async getEthereumProvider into
 * state, so call sites can read it synchronously like the old AppKit hook). Mainly used by the tier-2
 * external-wallet money path + XMTP signer; tier-1 (embedded smart wallet) uses useSmartWallets instead.
 */
export function useAppKitProvider(_namespace?: string) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [walletProvider, setWalletProvider] = useState<unknown>(undefined);

  const active = wallets?.find((w) => w.address === user?.wallet?.address) ?? wallets?.[0];

  useEffect(() => {
    let cancelled = false;
    if (active?.getEthereumProvider) {
      active
        .getEthereumProvider()
        .then((p) => {
          if (!cancelled) setWalletProvider(p);
        })
        .catch(() => {
          if (!cancelled) setWalletProvider(undefined);
        });
    } else {
      setWalletProvider(undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { walletProvider } as const;
}
