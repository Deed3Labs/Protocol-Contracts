import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { getMemberAccountCenter, type MemberAccountCenterResponse } from '@/utils/apiClient';

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

export interface ProfileMenuUser {
  name: string;
  email: string;
  address: string | null;
  membershipPlan: string | null;
  membershipStatus: string | null;
  levelLabel: string | null;
}

interface GlobalModalsContextType {
  // ActionModal
  actionModalOpen: boolean;
  setActionModalOpen: (open: boolean) => void;
  sendFundsModalOpen: boolean;
  setSendFundsModalOpen: (open: boolean) => void;
  
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
  profileMenuUser: ProfileMenuUser | null;
  
  // Helper functions
  openTradeModal: (type: 'buy' | 'sell' | 'swap', asset?: TradeModalAsset | null) => void;
  openSendFundsModal: () => void;
  openSearchModal: () => void;
  openXmtpModal: (conversationId?: string) => void;
  toggleProfileMenu: () => void;
}

const GlobalModalsContext = createContext<GlobalModalsContextType | null>(null);

function formatShortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatMembershipPlan(plan: MemberAccountCenterResponse['member']['membershipPlan']): string | null {
  if (!plan) return null;
  return plan === 'LIFETIME' ? 'Lifetime' : 'Yearly';
}

function formatMembershipStatus(status: MemberAccountCenterResponse['member']['membershipStatus']): string {
  return status
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatMemberLevel(status: MemberAccountCenterResponse['member']['status']): string {
  switch (status) {
    case 'VERIFIED':
      return 'Verified';
    case 'VERIFICATION_PENDING':
      return 'Review Pending';
    case 'VERIFICATION_ELIGIBLE':
      return 'Verification Ready';
    case 'BASIC_ACTIVE':
      return 'Basic';
    case 'RESTRICTED':
      return 'Restricted';
    case 'ONBOARDING':
    default:
      return 'Onboarding';
  }
}

export const GlobalModalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Get wallet address and AppKit auth for user derivation
  const { address } = useAppKitAccount();
  const { user: appKitUser, isAuthenticated } = useAppKitAuth();
  
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [sendFundsModalOpen, setSendFundsModalOpen] = useState(false);
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
  const [memberAccount, setMemberAccount] = useState<MemberAccountCenterResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      setMemberAccount(null);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const account = await getMemberAccountCenter();
      if (!cancelled) {
        setMemberAccount(account);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, address, appKitUser?.id]);
  
  // Derive user data globally from wallet address and AppKit auth
  const profileMenuUser = useMemo(() => {
    const email =
      memberAccount?.profile.privateProfile?.email?.trim()
      || appKitUser?.email
      || '';
    const displayName =
      memberAccount?.profile.publicProfile.displayName?.trim()
      || memberAccount?.profile.publicProfile.username?.trim()
      || (address ? formatShortAddress(address) : 'Username');

    return {
      name: displayName,
      email: email || 'No email added',
      address: address ?? memberAccount?.member.primaryWallet ?? null,
      membershipPlan: memberAccount ? formatMembershipPlan(memberAccount.member.membershipPlan) : null,
      membershipStatus: memberAccount ? formatMembershipStatus(memberAccount.member.membershipStatus) : null,
      levelLabel: memberAccount ? formatMemberLevel(memberAccount.member.status) : null,
    };
  }, [address, appKitUser?.email, memberAccount]);
  
  const openTradeModal = (type: 'buy' | 'sell' | 'swap', asset: TradeModalAsset | null = null) => {
    setTradeModalType(type);
    setTradeModalAsset(asset);
    setTradeModalOpen(true);
  };
  
  const openSearchModal = () => {
    setSearchModalOpen(true);
  };

  const openSendFundsModal = () => {
    setSendFundsModalOpen(true);
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
        sendFundsModalOpen,
        setSendFundsModalOpen,
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
        openTradeModal,
        openSendFundsModal,
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
