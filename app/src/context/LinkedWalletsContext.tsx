import { createContext, useContext, useState, type ReactNode } from 'react';
import LinkedWalletsModal from '@/components/app-ui/LinkedWalletsModal';

export interface LinkedWallet {
  id: string;
  label: string;
  address: string;
}

interface LinkedWalletsValue {
  wallets: LinkedWallet[];
  primaryId: string;
  primary: LinkedWallet | undefined;
  addWallet: (label: string, address: string, makePrimary?: boolean) => string;
  setPrimary: (id: string) => void;
  removeWallet: (id: string) => void;
  openManager: () => void;
}

const Ctx = createContext<LinkedWalletsValue | null>(null);

/**
 * The user's linked (connected + signature-verified) wallets — the source of truth for the
 * Add-money destination and Withdraw source pickers, and managed via the LinkedWalletsModal.
 * In production the AppKit-connected wallet is auto-linked as primary; seeded with mock here.
 */
export function useLinkedWallets(): LinkedWalletsValue {
  return (
    useContext(Ctx) ?? {
      wallets: [],
      primaryId: '',
      primary: undefined,
      addWallet: () => '',
      setPrimary: () => {},
      removeWallet: () => {},
      openManager: () => {},
    }
  );
}

const SEED: LinkedWallet[] = [
  { id: 'w1', label: 'Main account', address: '0x12A4…9b3F' },
  { id: 'w2', label: 'Savings vault', address: '0x88cD…2e1A' },
];

export function LinkedWalletsProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<LinkedWallet[]>(SEED);
  const [primaryId, setPrimaryId] = useState('w1');
  const [managerOpen, setManagerOpen] = useState(false);

  const addWallet = (label: string, address: string, makePrimary = false) => {
    const id = `w${Date.now()}`;
    setWallets((ws) => [...ws, { id, label, address }]);
    if (makePrimary) setPrimaryId(id);
    return id;
  };
  const setPrimary = (id: string) => setPrimaryId(id);
  const removeWallet = (id: string) =>
    setWallets((ws) => {
      const next = ws.filter((w) => w.id !== id);
      if (id === primaryId && next[0]) setPrimaryId(next[0].id);
      return next;
    });

  const value: LinkedWalletsValue = {
    wallets,
    primaryId,
    primary: wallets.find((w) => w.id === primaryId) ?? wallets[0],
    addWallet,
    setPrimary,
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
