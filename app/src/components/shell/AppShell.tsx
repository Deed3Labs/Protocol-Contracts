import { useEffect, useState } from 'react';
import { type ReactNode } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SideMenu from './SideMenu';
import TabBar from './TabBar';
import { KycProvider } from '@/context/KycContext';
import { BridgeProvider } from '@/context/BridgeContext';
import { ClearBalancesProvider } from '@/hooks/useClearBalances';
import { ClearTransactionsProvider } from '@/hooks/useClearTransactions';
import { MemberProfileProvider, useMemberProfile } from '@/hooks/useMemberProfile';
import { LinkedWalletsProvider } from '@/context/LinkedWalletsContext';
import { ExternalAccountsProvider } from '@/context/ExternalAccountsContext';
import { ContactsProvider } from '@/context/ContactsContext';
import { PayProvider } from '@/context/PayContext';
import { CreditProvider } from '@/context/CreditContext';
import { MoneyActionsProvider } from '@/context/MoneyActionsContext';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import XMTPMessaging from '@/components/XMTPMessaging';
import { cn } from '@/lib/utils';

/** Mounts the shared XMTP modal once for the redesign, driven by GlobalModals state. */
function XmtpModalHost() {
  const { xmtpModalOpen, setXmtpModalOpen, xmtpConversationId, xmtpComposeAddress } = useGlobalModals();
  return (
    <XMTPMessaging
      isOpen={xmtpModalOpen}
      onClose={() => setXmtpModalOpen(false)}
      initialConversationId={xmtpConversationId}
      initialComposeAddress={xmtpComposeAddress}
    />
  );
}

/**
 * Dashboard shell: a fixed, collapsible left Sidebar (desktop) with the main
 * column offset by its width and scrolling via the window (no sticky/flex sidebar).
 * Mobile uses the SideMenu drawer + floating TabBar. Collapse state is persisted.
 */
/**
 * Sends brand-new members (status ONBOARDING) to the onboarding flow. Only redirects once we've
 * positively determined that status — while loading / on error / unknown it renders the app, so an
 * existing member is never trapped. Onboarding lives outside AppShell, so there's no redirect loop.
 */
function OnboardingGate({ children }: { children: ReactNode }) {
  const { memberStatus } = useMemberProfile();
  if (memberStatus === 'ONBOARDING') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <KycProvider>
      <BridgeProvider>
      <MemberProfileProvider>
      <OnboardingGate>
      <ClearBalancesProvider>
      <LinkedWalletsProvider>
      <ClearTransactionsProvider>
      <ExternalAccountsProvider>
      <ContactsProvider>
      <PayProvider>
      <CreditProvider>
      <MoneyActionsProvider>
        <div className="min-h-screen bg-background">
        <Sidebar collapsed={collapsed} />
        <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

        <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
          <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} onMenuOpen={() => setMenuOpen(true)} />
          <main className="mx-auto w-full max-w-[1400px] px-5 pb-32 pt-6 lg:px-8 lg:pb-12">
            <Outlet />
          </main>
        </div>

          <TabBar />
          <XmtpModalHost />
        </div>
      </MoneyActionsProvider>
      </CreditProvider>
      </PayProvider>
      </ContactsProvider>
      </ExternalAccountsProvider>
      </ClearTransactionsProvider>
      </LinkedWalletsProvider>
      </ClearBalancesProvider>
      </OnboardingGate>
      </MemberProfileProvider>
      </BridgeProvider>
    </KycProvider>
  );
}
