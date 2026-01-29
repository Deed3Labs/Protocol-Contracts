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
  
  // SearchModal
  searchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategories: string[];
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  
  // XMTPMessaging
  xmtpModalOpen: boolean;
  setXmtpModalOpen: (open: boolean) => void;
  xmtpConversationId: string | null;
  setXmtpConversationId: (id: string | null) => void;
  
  // ProfileMenu
  profileMenuOpen: boolean;
  setProfileMenuOpen: (open: boolean) => void;
  profileMenuUser: any;
  setProfileMenuUser: (user: any) => void;
  
  // Helper functions
  openTradeModal: (type: 'buy' | 'sell' | 'swap', asset?: TradeModalAsset | null) => void;
  openSearchModal: () => void;
  openXmtpModal: (conversationId?: string) => void;
  toggleProfileMenu: () => void;
}

const GlobalModalsContext = createContext<GlobalModalsContextType | null>(null);

export const GlobalModalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalType, setTradeModalType] = useState<'buy' | 'sell' | 'swap'>('buy');
  const [tradeModalAsset, setTradeModalAsset] = useState<TradeModalAsset | null>(null);
  
  // SearchModal state
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  
  // XMTPMessaging state
  const [xmtpModalOpen, setXmtpModalOpen] = useState(false);
  const [xmtpConversationId, setXmtpConversationId] = useState<string | null>(null);
  
  // ProfileMenu state
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuUser, setProfileMenuUser] = useState<any>(null);
  
  const openTradeModal = (type: 'buy' | 'sell' | 'swap', asset: TradeModalAsset | null = null) => {
    setTradeModalType(type);
    setTradeModalAsset(asset);
    setTradeModalOpen(true);
  };
  
  const openSearchModal = () => {
    setSearchModalOpen(true);
  };
  
  const openXmtpModal = (conversationId?: string) => {
    setXmtpConversationId(conversationId || null);
    setXmtpModalOpen(true);
  };
  
  const toggleProfileMenu = () => {
    setProfileMenuOpen(prev => !prev);
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
        searchModalOpen,
        setSearchModalOpen,
        searchQuery,
        setSearchQuery,
        selectedCategories,
        setSelectedCategories,
        xmtpModalOpen,
        setXmtpModalOpen,
        xmtpConversationId,
        setXmtpConversationId,
        profileMenuOpen,
        setProfileMenuOpen,
        profileMenuUser,
        setProfileMenuUser,
        openTradeModal,
        openSearchModal,
        openXmtpModal,
        toggleProfileMenu,
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
