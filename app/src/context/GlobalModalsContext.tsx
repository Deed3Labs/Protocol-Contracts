import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface TradeModalAsset {
  symbol: string;
  name: string;
  color: string;
  balance?: number;
  balanceUSD?: number;
  type?: 'token' | 'nft' | 'rwa';
  chainId?: number;
  chainName?: string;
}

interface GlobalModalsContextType {
  // ActionModal
  actionModalOpen: boolean;
  setActionModalOpen: (open: boolean) => void;
  
  // TradeModal
  tradeModalOpen: boolean;
  setTradeModalOpen: (open: boolean) => void;
  tradeModalType: 'buy' | 'sell' | 'swap';
  setTradeModalType: (type: 'buy' | 'sell' | 'swap') => void;
  tradeModalAsset: TradeModalAsset | null;
  setTradeModalAsset: (asset: TradeModalAsset | null) => void;
  
  // Helper functions
  openTradeModal: (type: 'buy' | 'sell' | 'swap', asset?: TradeModalAsset | null) => void;
}

const GlobalModalsContext = createContext<GlobalModalsContextType | null>(null);

export const GlobalModalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalType, setTradeModalType] = useState<'buy' | 'sell' | 'swap'>('buy');
  const [tradeModalAsset, setTradeModalAsset] = useState<TradeModalAsset | null>(null);
  
  const openTradeModal = (type: 'buy' | 'sell' | 'swap', asset: TradeModalAsset | null = null) => {
    setTradeModalType(type);
    setTradeModalAsset(asset);
    setTradeModalOpen(true);
  };
  
  return (
    <GlobalModalsContext.Provider
      value={{
        actionModalOpen,
        setActionModalOpen,
        tradeModalOpen,
        setTradeModalOpen,
        tradeModalType,
        setTradeModalType,
        tradeModalAsset,
        setTradeModalAsset,
        openTradeModal,
      }}
    >
      {children}
    </GlobalModalsContext.Provider>
  );
};

export const useGlobalModals = () => {
  const context = useContext(GlobalModalsContext);
  if (!context) {
    throw new Error('useGlobalModals must be used within a GlobalModalsProvider');
  }
  return context;
};
