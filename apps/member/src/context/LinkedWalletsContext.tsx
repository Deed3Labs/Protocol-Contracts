import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLinkAccount, useUnlinkWallet, usePrivy } from '@privy-io/react-auth';
import { useAppKitAccount } from '@/lib/walletCompat';
import LinkedWalletsModal from '@/components/app-ui/LinkedWalletsModal';

export interface LinkedWallet {
  id: string; // 'smart' for the Clear wallet, else the lowercased address
  label: string;
  address: string;
  isPrimary: boolean; // the Clear smart wallet (primary, can't be unlinked)
  external: boolean; // a Privy-linked external wallet (MetaMask etc.)
}

interface LinkedWalletsValue {
  wallets: LinkedWallet[]; // [Clear smart wallet] + external linked wallets
  externalWallets: LinkedWallet[]; // external only
  primaryId: string;
  primary: LinkedWallet | undefined;
  smartWallet: string | undefined; // the Clear smart-wallet address (primary)
  linkWallet: () => void; // Privy connect + link an external wallet
  removeWallet: (id: string) => void; // unlink an external wallet (no-op for primary)
  openManager: () => void;
}

const Ctx = createContext<LinkedWalletsValue | null>(null);

/**
 * The user's wallets. The Clear smart wallet (Privy) is PRIMARY — it holds funds and is the fiat
 * on/off-ramp endpoint. External wallets are LINKED via Privy (user.linkedAccounts) for two things:
 * viewing their balances/txns and on-chain USDC/CLRUSD transfers to/from the Clear wallet. Login is
 * identity-only, so external wallets are never a login — only linked here. See [[clearpath-privy-migration]].
 */
export function useLinkedWallets(): LinkedWalletsValue {
  return (
    useContext(Ctx) ?? {
      wallets: [],
      externalWallets: [],
      primaryId: 'smart',
      primary: undefined,
      smartWallet: undefined,
      linkWallet: () => {},
      removeWallet: () => {},
      openManager: () => {},
    }
  );
}

const prettyClient = (t?: string) => {
  if (!t) return 'Wallet';
  const map: Record<string, string> = {
    metamask: 'MetaMask',
    rabby: 'Rabby',
    coinbase_wallet: 'Coinbase Wallet',
    rainbow: 'Rainbow',
    phantom: 'Phantom',
    wallet_connect: 'WalletConnect',
    zerion: 'Zerion',
  };
  return map[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

type RawLinked = { type?: string; address?: string; walletClientType?: string; chainType?: string };

export function LinkedWalletsProvider({ children }: { children: ReactNode }) {
  const { user } = usePrivy();
  const { address: smartWallet } = useAppKitAccount();
  const { linkWallet: privyLinkWallet } = useLinkAccount();
  const { unlink } = useUnlinkWallet();
  const [managerOpen, setManagerOpen] = useState(false);

  // External wallets linked to the Privy user (exclude the embedded/smart 'privy' wallet).
  const externalWallets: LinkedWallet[] = ((user?.linkedAccounts as RawLinked[] | undefined) ?? [])
    .filter((a) => a.type === 'wallet' && a.walletClientType !== 'privy' && (a.chainType ? a.chainType === 'ethereum' : true))
    .filter((a) => !!a.address && a.address.toLowerCase() !== smartWallet?.toLowerCase())
    .map((a) => ({
      id: (a.address ?? '').toLowerCase(),
      label: prettyClient(a.walletClientType),
      address: a.address ?? '',
      isPrimary: false,
      external: true,
    }));

  const primary: LinkedWallet | undefined = smartWallet
    ? { id: 'smart', label: 'Clear account', address: smartWallet, isPrimary: true, external: false }
    : undefined;

  const wallets: LinkedWallet[] = [...(primary ? [primary] : []), ...externalWallets];

  const removeWallet = (id: string) => {
    const w = externalWallets.find((x) => x.id === id);
    if (w?.address) void unlink({ address: w.address }).catch(() => {});
  };

  const value: LinkedWalletsValue = {
    wallets,
    externalWallets,
    primaryId: 'smart',
    primary,
    smartWallet,
    linkWallet: () => privyLinkWallet(),
    removeWallet,
    openManager: () => setManagerOpen(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <LinkedWalletsModal open={managerOpen} onOpenChange={setManagerOpen} />
    </Ctx.Provider>
  );
}
