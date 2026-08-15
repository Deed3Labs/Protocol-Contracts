import { type ReactNode } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import AppChrome from './AppChrome';
import HeaderActions from './HeaderActions';
import PullToRefresh from '@/components/app-ui/PullToRefresh';
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
import { useNotifications } from '@/hooks/useNotifications';
import { SETTINGS } from '@/data/clearPlaceholder';
import XMTPMessaging from '@/components/XMTPMessaging';

/**
 * The header cluster with live data behind it: the unread count comes from the
 * backend notification feed, the identity from the member profile.
 *
 * Fields the profile hook doesn't carry yet (member-since, region, the settings
 * figures) fall back to the placeholder record — the same merge blocker the rest
 * of the rebuild carries, and the one place it's visible in the chrome.
 */
function LiveHeaderActions() {
  const { unreadCount } = useNotifications();
  const member = useMemberProfile();

  return (
    <HeaderActions
      unread={unreadCount}
      profile={{
        ...SETTINGS.profile,
        name: member.name || SETTINGS.profile.name,
        initials: member.initials || SETTINGS.profile.initials,
        handle: member.handle || SETTINGS.profile.handle,
      }}
      accelerationActive={member.accelerated}
    />
  );
}

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
 * Sends brand-new members (status ONBOARDING) to the onboarding flow. Only redirects once we've
 * positively determined that status — while loading / on error / unknown it renders the app, so an
 * existing member is never trapped. Onboarding lives outside AppShell, so there's no redirect loop.
 */
function OnboardingGate({ children }: { children: ReactNode }) {
  const { memberStatus } = useMemberProfile();
  if (memberStatus === 'ONBOARDING') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/**
 * Member app shell: the provider stack, wrapped around the visual chrome in
 * AppChrome (top nav on desktop, floating tab bar on mobile — design spec §1).
 */
export default function AppShell() {
  return (
    // Bridge wraps KYC: verification state comes FROM Bridge, so KycModal can read useBridge().
    <BridgeProvider>
      <KycProvider>
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
        <AppChrome trailing={<LiveHeaderActions />}>
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
        </AppChrome>
        <XmtpModalHost />
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
      </KycProvider>
    </BridgeProvider>
  );
}
