import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { getMemberAccountCenter, type MemberAccountCenterResponse } from '@/utils/apiClient';
import { usePortfolio } from '@/context/PortfolioContext';
import { computeAccountLevelMetrics } from '@/utils/accountLevel';

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
  membershipLabel: string | null;
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
  xmtpComposeAddress: string | null;
  setXmtpComposeAddress: (address: string | null) => void;
  
  // ProfileMenu
  profileMenuOpen: boolean;
  setProfileMenuOpen: (open: boolean) => void;
  profileMenuUser: ProfileMenuUser | null;
  
  // Helper functions
  openTradeModal: (type: 'buy' | 'sell' | 'swap', asset?: TradeModalAsset | null) => void;
  openSendFundsModal: () => void;
  openSearchModal: () => void;
  openXmtpModal: (conversationId?: string, composeAddress?: string) => void;
  toggleProfileMenu: () => void;
}

const GlobalModalsContext = createContext<GlobalModalsContextType | null>(null);

function formatShortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatMembershipPlan(plan: MemberAccountCenterResponse['member']['membershipPlan']): string | null {
  if (!plan) return null;
  // Display tiers: base (YEARLY) → Standard, premium (LIFETIME) → Accelerated. Stored enum unchanged.
  return plan === 'LIFETIME' ? 'Accelerated' : 'Standard';
}

function buildMembershipLabel(
  levelLabel: string,
  levelNumber: number,
  membershipPlan: MemberAccountCenterResponse['member']['membershipPlan']
): string {
  const level = `${levelLabel} Lv.${levelNumber}`;
  const plan = formatMembershipPlan(membershipPlan);
  return plan ? `${level} • ${plan}` : level;
}

export const GlobalModalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Get wallet address and AppKit auth for user derivation
  const { address } = useAppKitAccount();
  const { user: appKitUser, isAuthenticated } = useAppKitAuth();
  const { bankAccounts } = usePortfolio();
  
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
  const [xmtpComposeAddress, setXmtpComposeAddress] = useState<string | null>(null);
  
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

    const levelMetrics = memberAccount
      ? computeAccountLevelMetrics({
          legalName: memberAccount.profile.privateProfile?.legalName || '',
          displayName:
            memberAccount.profile.publicProfile.displayName ||
            memberAccount.profile.publicProfile.username ||
            '',
          email: memberAccount.profile.privateProfile?.email || appKitUser?.email || '',
          phone: memberAccount.profile.privateProfile?.phone || '',
          location:
            memberAccount.profile.privateProfile?.cityRegion ||
            memberAccount.member.residencyCountry ||
            '',
          bio: memberAccount.profile.publicProfile.bio || '',
          walletCount: memberAccount.wallets.length,
          socialCount: memberAccount.socialAccounts.length,
          bankCount: bankAccounts.length,
          securityEnabledCount: [
            memberAccount.security.signatureLock,
            memberAccount.security.sessionReview,
            memberAccount.security.biometricAccess,
            memberAccount.security.socialDiscovery,
            memberAccount.security.transferAlerts,
          ].filter(Boolean).length,
          securityControlCount: 5,
          hasSavedProfile: Boolean(memberAccount.profile.publicProfile.updatedAt),
        })
      : null;

    return {
      name: displayName,
      email: email || 'No email added',
      membershipLabel: levelMetrics
        ? buildMembershipLabel(
            levelMetrics.levelLabel,
            levelMetrics.levelNumber,
            memberAccount?.member.membershipPlan ?? null
          )
        : null,
    };
  }, [address, appKitUser?.email, bankAccounts.length, memberAccount]);
  
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
  
  const openXmtpModal = (conversationId?: string, composeAddress?: string) => {
    setXmtpConversationId(conversationId || null);
    setXmtpComposeAddress(composeAddress || null);
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
        xmtpComposeAddress,
        setXmtpComposeAddress,
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
